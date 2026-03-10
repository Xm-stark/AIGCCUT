import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs-extra";
import multer from "multer";
import cors from "cors";
import { MsEdgeTTS, OUTPUT_FORMAT } from "edge-tts-node";
import ffmpeg from "fluent-ffmpeg";
import { format } from "date-fns";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Ensure directories exist
  const UPLOADS_DIR = path.join(__dirname, "uploads");
  const OUTPUT_DIR = path.join(__dirname, "output");
  const TEMP_DIR = path.join(__dirname, "temp");
  await fs.ensureDir(UPLOADS_DIR);
  await fs.ensureDir(OUTPUT_DIR);
  await fs.ensureDir(TEMP_DIR);

  // Serve static files
  app.use("/output", express.static(OUTPUT_DIR));
  app.use("/uploads", express.static(UPLOADS_DIR));

  // File Browser API
  app.post("/api/list-files", async (req, res) => {
    const { dirPath, type } = req.body;
    try {
      if (!dirPath || !(await fs.pathExists(dirPath))) {
        return res.json({ files: [] });
      }
      const files = await fs.readdir(dirPath);
      const filtered = files.filter(f => {
        if (type === "video") return /\.(mp4|mov|avi|webm)$/i.test(f);
        if (type === "audio") return /\.(mp3|wav|aac|m4a|ogg)$/i.test(f);
        if (type === "image") return /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f);
        return true;
      });
      res.json({ files: filtered });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Proxy endpoint to serve files from arbitrary local paths
  app.get("/api/file-proxy", async (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath || !(await fs.pathExists(filePath))) {
      return res.status(404).send("File not found");
    }
    res.sendFile(filePath);
  });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/generate", async (req, res) => {
    const {
      script,
      fontSize = 9,
      fontColor = "#FFFFFF",
      fontBgColor = "#FFFF00",
      subtitlePosition = { bottom: 60, align: "center" },
      sceneMatPath, // Can be local path or uploaded file ID
      bgmPath,
      bgmVolume = -3,
      watermarkPath,
      outputFileName,
      voiceType = "zh-CN-XiaoxiaoNeural", // Default female voice
    } = req.body;

    if (!script) {
      return res.status(400).json({ error: "Script is required" });
    }

    try {
      const timestamp = format(new Date(), "M月d日");
      const sessionDir = path.join(TEMP_DIR, `session_${Date.now()}`);
      await fs.ensureDir(sessionDir);

      // 1. TTS Generation
      const tts = new MsEdgeTTS({ enableLogger: false });
      
      // Semantic segmentation
      const sentences = script.split(/[。！？；\n]/).filter(s => s.trim().length > 0);
      
      const audioPaths: string[] = [];
      const subtitleEntries: { start: number; end: number; text: string }[] = [];
      let currentTime = 0;

      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const audioPath = path.join(sessionDir, `sentence_${i}.mp3`);
        
        // Using the correct method for edge-tts-node
        await tts.setMetadata(voiceType, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        await new Promise((resolve, reject) => {
          const stream = tts.toStream(sentence);
          const writer = fs.createWriteStream(audioPath);
          stream.pipe(writer);
          writer.on("finish", resolve);
          writer.on("error", reject);
        });
        
        // Get duration (using ffmpeg to probe)
        const duration = await new Promise<number>((resolve) => {
          ffmpeg.ffprobe(audioPath, (err, metadata) => {
            resolve(metadata?.format?.duration || 0);
          });
        });

        audioPaths.push(audioPath);
        subtitleEntries.push({
          start: currentTime,
          end: currentTime + duration,
          text: sentence
        });
        currentTime += duration;
      }

      // Combine audio
      const combinedAudioPath = path.join(sessionDir, "combined_voice.mp3");
      const audioListPath = path.join(sessionDir, "audio_list.txt");
      const audioListContent = audioPaths.map(p => `file '${p}'`).join("\n");
      await fs.writeFile(audioListPath, audioListContent);

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(audioListPath)
          .inputOptions(["-f concat", "-safe 0"])
          .output(combinedAudioPath)
          .on("end", resolve)
          .on("error", reject)
          .run();
      });

      // 2. Generate Subtitles (SRT format)
      const srtPath = path.join(sessionDir, "subtitles.srt");
      const srtContent = subtitleEntries.map((entry, index) => {
        const formatTime = (seconds: number) => {
          const date = new Date(0);
          date.setSeconds(seconds);
          const ms = Math.floor((seconds % 1) * 1000);
          return date.toISOString().substr(11, 8) + "," + ms.toString().padStart(3, "0");
        };
        return `${index + 1}\n${formatTime(entry.start)} --> ${formatTime(entry.end)}\n${entry.text}\n`;
      }).join("\n");
      await fs.writeFile(srtPath, srtContent);

      // 3. Video Synthesis
      // For this demo, we'll assume sceneMatPath is a directory of videos or a single video
      // We'll pick a random video from the directory if it's a path
      let sourceVideo = "";
      if (sceneMatPath && await fs.pathExists(sceneMatPath)) {
        const stats = await fs.stat(sceneMatPath);
        if (stats.isDirectory()) {
          const files = await fs.readdir(sceneMatPath);
          const videos = files.filter(f => /\.(mp4|mov|avi)$/i.test(f));
          if (videos.length > 0) {
            sourceVideo = path.join(sceneMatPath, videos[Math.floor(Math.random() * videos.length)]);
          }
        } else {
          sourceVideo = sceneMatPath;
        }
      }

      // Fallback if no video found
      if (!sourceVideo) {
        // Use a placeholder or error
        return res.status(400).json({ error: "No source video found at " + sceneMatPath });
      }

      const finalOutputName = outputFileName || `${timestamp}(1).mp4`;
      const finalOutputPath = path.join(OUTPUT_DIR, finalOutputName);

      // FFmpeg command to combine everything
      // Subtitle styling: Alignment=2 (bottom center), MarginV=60
      // Font: size 9 is very small for video, but following request. 
      // Yellow background is tricky in SRT, usually done via ASS or filter.
      // We'll use the 'subtitles' filter with force_style.
      
      const subtitleFilter = `subtitles='${srtPath.replace(/\\/g, "/")}:force_style="FontSize=${fontSize},PrimaryColour=${fontColor.replace("#", "&H")},BackColour=${fontBgColor.replace("#", "&H")},Outline=0,BorderStyle=3,Alignment=2,MarginV=${subtitlePosition.bottom}"'`;

      let command = ffmpeg(sourceVideo)
        .input(combinedAudioPath)
        .complexFilter([
          // Loop video to match audio duration
          `[0:v]loop=loop=-1:size=2:start=0[vloop]`,
          `[vloop]scale=1280:720,setpts=PTS-STARTPTS[vscaled]`,
          `[vscaled]${subtitleFilter}[vsubs]`
        ])
        .map("[vsubs]")
        .map("1:a") // Use the combined voice audio
        .duration(currentTime);

      // Add BGM if provided
      if (bgmPath && await fs.pathExists(bgmPath)) {
        command = command.input(bgmPath).inputOptions(["-stream_loop -1"]);
        // Mix BGM with voice, BGM volume adjusted
        const bgmVol = Math.pow(10, bgmVolume / 20);
        command = command.complexFilter([
          `[0:v]loop=loop=-1:size=2:start=0[vloop]`,
          `[vloop]scale=1280:720,setpts=PTS-STARTPTS[vscaled]`,
          `[vscaled]${subtitleFilter}[vsubs]`,
          `[2:a]volume=${bgmVol}[bgm]`,
          `[1:a][bgm]amix=inputs=2:duration=first[aout]`
        ]).map("[vsubs]").map("[aout]");
      }

      // Add Watermark if provided
      if (watermarkPath && await fs.pathExists(watermarkPath)) {
        command = command.input(watermarkPath);
        // Overlay watermark at top right
        command = command.complexFilter([
          `[0:v]loop=loop=-1:size=2:start=0[vloop]`,
          `[vloop]scale=1280:720,setpts=PTS-STARTPTS[vscaled]`,
          `[vscaled]${subtitleFilter}[vsubs]`,
          `[vsubs][3:v]overlay=W-w-20:20[vwater]`,
          bgmPath ? `[2:a]volume=${Math.pow(10, bgmVolume / 20)}[bgm]` : "",
          bgmPath ? `[1:a][bgm]amix=inputs=2:duration=first[aout]` : "[1:a]copy[aout]"
        ].filter(Boolean).join(";")).map("[vwater]").map("[aout]");
      }

      await new Promise((resolve, reject) => {
        command
          .output(finalOutputPath)
          .on("start", (cmd) => console.log("FFmpeg started:", cmd))
          .on("end", resolve)
          .on("error", (err) => {
            console.error("FFmpeg error:", err);
            reject(err);
          })
          .run();
      });

      // Cleanup session dir
      await fs.remove(sessionDir);

      res.json({
        success: true,
        videoUrl: `/output/${finalOutputName}`,
        fileName: finalOutputName
      });

    } catch (error) {
      console.error("Generation failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
