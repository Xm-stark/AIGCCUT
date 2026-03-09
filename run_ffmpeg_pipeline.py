#!/usr/bin/env python3
import asyncio
import json
import random
import re
import string
import subprocess
import sys
import shutil
import os
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple


TEXT = (
    "无锡的打工人注意！"
    "你租的区域已经有人15万首付买房了！"
    "同样的地段，同样的二手房，有人抓住机会，省了十几万，从租房人变成房东。"
    "其实这些便宜的房子，一般不会在公开平台上看到，只有在我们无锡选房师的内部群里才会第一时间推送。"
    "我们每天在群里分享各区急售、降价的二手房信息和真实成交价，还会教你怎么看房、避哪些坑，帮你判断每套房的性价比和潜在问题。"
    "想不再为房价发愁，先来看看你错过的捡漏机会，左下角添加无锡选房师，先把底价摸清楚。"
)

VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "+0%"
VOLUME = "+0%"

PHONE_DIR = Path("/Users/xm/Downloads/sucai")
INDOOR_DIR = Path("/Users/xm/Downloads/sucai")
AIGC_DIR = Path("/Users/xm/Downloads/sucai")

# User-provided (assumed) music path
BGM_DIR = Path("/Users/xm/Downloads/sucai/music")

# User-provided watermark path; can be file or directory
WATERMARK_PATH = Path("/Users/xm/Downloads/水印.png")

OUTPUT_DIR = Path("/Users/xm/Downloads/自动化所需依赖/SKILL/AIGC混剪/output")
WORK_DIR = Path(__file__).parent / "tmp_ffmpeg"

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac"}

TARGET_W = 1080
TARGET_H = 1920
FPS = 30

# Allow overriding ffmpeg/ffprobe via env vars or system PATH
FFMPEG_ENV = os.environ.get("FFMPEG_PATH")
FFPROBE_ENV = os.environ.get("FFPROBE_PATH")
resolved_ffmpeg: Optional[str] = None
resolved_ffprobe: Optional[str] = None


def resolve_ffmpeg() -> Optional[str]:
    if FFMPEG_ENV:
        p = FFMPEG_ENV
        p_exp = os.path.expanduser(p)
        if os.path.exists(p_exp):
            return p_exp
        which_p = shutil.which(p)
        if which_p:
            return which_p
    which_ff = shutil.which("ffmpeg")
    if which_ff:
        return which_ff
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def resolve_ffprobe() -> Optional[str]:
    # If user provided an env value, prefer it (either absolute or name)
    if FFPROBE_ENV:
        p = FFPROBE_ENV
        # expand user and check
        p_exp = os.path.expanduser(p)
        if os.path.exists(p_exp):
            return p_exp
        which_p = shutil.which(p)
        if which_p:
            return which_p
    # fallback to PATH lookup
    which_ff = shutil.which("ffprobe")
    if which_ff:
        return which_ff
    return None


@dataclass
class SentenceItem:
    text: str
    start: float
    end: float


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def split_sentences(text: str) -> List[str]:
    text = re.sub(r"\s+", "", text.strip())
    if not text:
        return []
    parts = re.split(r"(?<=[。！？；])", text)
    sentences: List[str] = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if len(p) > 20:
            sub = re.split(r"(?<=[，、])", p)
            for s in sub:
                s = s.strip()
                if s:
                    sentences.append(s)
        else:
            sentences.append(p)
    return sentences


def list_media(dir_path: Path, exts: set) -> List[Path]:
    if not dir_path.exists():
        return []
    return [p for p in dir_path.rglob("*") if p.suffix.lower() in exts]


def pick_random_file(dir_path: Path, exts: set) -> Optional[Path]:
    files = list_media(dir_path, exts)
    if not files:
        return None
    return random.choice(files)


def pick_watermark(path: Path) -> Optional[Path]:
    if path.is_file():
        return path
    if path.is_dir():
        files = list_media(path, IMAGE_EXTS)
        if files:
            return files[0]
    return None


def ffprobe_duration(path: Path) -> Optional[float]:
    def duration_from_ffmpeg(path: Path) -> Optional[float]:
        try:
            global resolved_ffmpeg
            if not resolved_ffmpeg:
                resolved_ffmpeg = resolve_ffmpeg()
            if not resolved_ffmpeg:
                return None
            result = subprocess.run(
                [resolved_ffmpeg, "-i", str(path)],
                capture_output=True,
                text=True,
                timeout=8,
            )
            text = result.stderr or ""
            m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
            if not m:
                return None
            h = int(m.group(1))
            mnt = int(m.group(2))
            sec = float(m.group(3))
            return h * 3600 + mnt * 60 + sec
        except Exception:
            return None

    try:
        # Use resolved ffprobe path if available
        global resolved_ffprobe
        if not resolved_ffprobe:
            resolved = resolve_ffprobe()
            if not resolved:
                return duration_from_ffmpeg(path)
            resolved_ffprobe = resolved

        cmd = [resolved_ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=6,
        )
        data = json.loads(result.stdout)
        dur = float(data["format"]["duration"])
        return dur
    except Exception:
        return duration_from_ffmpeg(path)


def format_timestamp(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int((t - int(t)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def wrap_subtitle_text(text: str, max_chars: int = 13) -> str:
    text = re.sub(r"\s+", "", text.strip())
    if len(text) <= max_chars:
        return text

    punctuation = set("，。！？；、,.!?;:")
    lines: List[str] = []
    idx = 0

    while idx < len(text):
        remain = len(text) - idx
        if remain <= max_chars:
            lines.append(text[idx:])
            break

        chunk = text[idx:idx + max_chars]
        cut = -1
        for i in range(len(chunk) - 1, -1, -1):
            if chunk[i] in punctuation:
                cut = i + 1
                break

        if cut <= 0:
            cut = max_chars

        lines.append(text[idx:idx + cut])
        idx += cut

    return "\n".join(lines)


def strip_subtitle_punctuation(text: str) -> str:
    text = re.sub(r"\s+", "", text.strip())
    # Remove common Chinese/English punctuation marks from subtitle text.
    punctuation_chars = (
        string.punctuation
        + "，。！？；：、（）【】《》“”‘’「」『』—…·～"
        + "，。！？；：、（）【】《》“”‘’「」『』—…·～"
    )
    trans = str.maketrans("", "", punctuation_chars)
    return text.translate(trans)


def paginate_subtitle_items(items: List[SentenceItem], max_chars_per_page: int = 26) -> List[SentenceItem]:
    paged: List[SentenceItem] = []
    for item in items:
        clean_text = re.sub(r"\s+", "", item.text.strip())
        if not clean_text:
            continue
        if len(clean_text) <= max_chars_per_page:
            paged.append(item)
            continue

        chunks = [clean_text[i:i + max_chars_per_page] for i in range(0, len(clean_text), max_chars_per_page)]
        total_chars = sum(len(c) for c in chunks)
        seg_start = item.start
        duration = max(0.001, item.end - item.start)

        for idx, chunk in enumerate(chunks):
            if idx == len(chunks) - 1:
                seg_end = item.end
            else:
                ratio = len(chunk) / total_chars
                seg_end = seg_start + duration * ratio
            paged.append(SentenceItem(text=chunk, start=seg_start, end=seg_end))
            seg_start = seg_end

    return paged


def write_srt(items: List[SentenceItem], out_path: Path) -> None:
    lines = []
    for i, item in enumerate(items, start=1):
        lines.append(str(i))
        lines.append(f"{format_timestamp(item.start)} --> {format_timestamp(item.end)}")
        lines.append(wrap_subtitle_text(item.text, max_chars=13))
        lines.append("")
    out_path.write_text("\n".join(lines), encoding="utf-8")


async def generate_tts(sentences: List[str], out_dir: Path) -> Tuple[Path, List[SentenceItem]]:
    import edge_tts

    ensure_dir(out_dir)
    text = "".join(sentences)
    voice_path = out_dir / "voice.mp3"
    items: List[SentenceItem] = []

    communicate = edge_tts.Communicate(
        text=text,
        voice=VOICE,
        rate=RATE,
        volume=VOLUME,
        boundary="SentenceBoundary",
    )

    with open(voice_path, "wb") as f:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "SentenceBoundary":
                offset = chunk["offset"] / 10_000_000.0
                duration = chunk["duration"] / 10_000_000.0
                seg_text = chunk.get("text", "").strip()
                if seg_text:
                    items.append(SentenceItem(text=seg_text, start=offset, end=offset + duration))

    return voice_path, items


def select_indoor_clips(clips: List[Path]) -> List[Path]:
    prefer = [p for p in clips if ("客厅" in p.name or "餐厅" in p.name)]
    return prefer if prefer else clips


def build_timeline(
    total_duration: float,
    phone_clips: List[Path],
    indoor_clips: List[Path],
    aigc_clips: List[Path],
) -> List[dict]:
    if not phone_clips and not indoor_clips and not aigc_clips:
        raise ValueError("No video clips found in any category.")

    indoor_clips = select_indoor_clips(indoor_clips)

    categories = []
    if phone_clips:
        categories.append(("phone", phone_clips, 1.0))
    if indoor_clips:
        categories.append(("indoor", indoor_clips, 1.6))
    if aigc_clips:
        categories.append(("aigc", aigc_clips, 1.0))

    timeline = []
    current = 0.0
    last_cat = None

    min_seg = 5.0
    while current < total_duration - 0.05:
        remaining = total_duration - current
        cat_pool = categories[:]
        if last_cat and len(cat_pool) > 1:
            cat_pool = [c for c in cat_pool if c[0] != last_cat]

        cat, clips, speed = random.choice(cat_pool)
        clip = random.choice(clips)

        clip_duration = ffprobe_duration(clip)
        if not clip_duration or clip_duration <= 0:
            print(f"Skipping unreadable or zero-length clip: {clip}")
            continue

        max_timeline = clip_duration / speed
        target_len = min(remaining, max_timeline, random.uniform(5.0, 7.0))
        if remaining < min_seg:
            target_len = min(remaining, max_timeline)

        if target_len <= 0.1:
            break

        src_len = target_len * speed
        max_start = max(0.0, clip_duration - src_len)
        src_start = random.uniform(0.0, max_start) if max_start > 0 else 0.0
        src_end = src_start + src_len

        timeline.append(
            {
                "path": clip,
                "start": src_start,
                "end": src_end,
                "speed": speed,
                "category": cat,
                "target_len": target_len,
            }
        )

        current += target_len
        last_cat = cat

    return timeline


def run_ffmpeg(
    timeline: List[dict],
    voice_path: Path,
    srt_path: Path,
    bgm_path: Optional[Path],
    watermark_path: Optional[Path],
    output_path: Path,
) -> None:
    inputs = []
    for seg in timeline:
        inputs += ["-i", str(seg["path"])]

    inputs += ["-i", str(voice_path)]

    if bgm_path:
        inputs += ["-stream_loop", "-1", "-i", str(bgm_path)]

    if watermark_path:
        inputs += ["-i", str(watermark_path)]

    filter_parts = []
    v_labels = []
    for idx, seg in enumerate(timeline):
        label = f"v{idx}"
        speed = seg["speed"]
        start = seg["start"]
        end = seg["end"]
        filter_parts.append(
            f"[{idx}:v]trim=start={start}:end={end},setpts=(PTS-STARTPTS)/{speed},"
            f"scale={TARGET_W}:{TARGET_H}:force_original_aspect_ratio=increase:in_range=pc:out_range=tv,"
            f"crop={TARGET_W}:{TARGET_H},fps={FPS},setsar=1,format=yuv420p[{label}]"
        )
        v_labels.append(f"[{label}]")

    concat_label = "vcat"
    filter_parts.append(f"{''.join(v_labels)}concat=n={len(v_labels)}:v=1:a=0[{concat_label}]")
    # Pad tail frames to avoid tiny timeline rounding cuts against voice/subtitle end.
    padded_label = "vpad"
    filter_parts.append(f"[{concat_label}]tpad=stop_mode=clone:stop_duration=2[{padded_label}]")

    def ffmpeg_sub_path(path: Path) -> str:
        # ffmpeg subtitles filter on Windows needs colon escaped
        p = path.as_posix()
        if len(p) > 1 and p[1] == ":":
            p = p.replace(":", "\\:", 1)
        return p

    sub_style = (
        "Fontsize=9,"
        "PrimaryColour=&H00FFFFFF&,"
        "BackColour=&H0000FFFF&,"
        "BorderStyle=3,"
        "Outline=2,"
        "OutlineColour=&H00000000&,"
        "Shadow=0,"
        "Bold=-1,"
        "Alignment=2,"
        "MarginV=60"
    )
    srt_filter_path = ffmpeg_sub_path(srt_path)
    filter_parts.append(f"[{padded_label}]subtitles='{srt_filter_path}':force_style='{sub_style}'[vsub]")

    v_final = "vsub"
    if watermark_path:
        v_final = "vwm"
        # watermark input index is last
        wm_index = len(timeline) + 1  # voice is +0, bgm maybe +1
        if bgm_path:
            wm_index += 1
        filter_parts.append(f"[{wm_index}:v]scale=200:-1[wm]")
        filter_parts.append(f"[vsub][wm]overlay=30:30[{v_final}]")

    a_voice_index = len(timeline)
    if bgm_path:
        a_bgm_index = len(timeline) + 1
        # BGM lower than voice by 3 dB
        filter_parts.append(
            f"[{a_voice_index}:a]volume=1.0[avoice];"
            f"[{a_bgm_index}:a]volume=0.708[abgm];"
            f"[avoice][abgm]amix=inputs=2:duration=first:dropout_transition=2[aout]"
        )
        a_out = "[aout]"
    else:
        filter_parts.append(f"[{a_voice_index}:a]volume=1.0[aout]")
        a_out = "[aout]"

    filter_complex = ";".join(filter_parts)

    global resolved_ffmpeg
    if not resolved_ffmpeg:
        resolved_ffmpeg = resolve_ffmpeg()
    ffmpeg_bin = resolved_ffmpeg or "ffmpeg"

    cmd = [
        ffmpeg_bin,
        "-y",
        *inputs,
        "-filter_complex",
        filter_complex,
        "-map",
        f"[{v_final}]",
        "-map",
        a_out,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        str(output_path),
    ]

    subprocess.run(cmd, check=True)


def main() -> int:
    # Resolve ffmpeg early and fail fast with actionable message
    global resolved_ffmpeg
    resolved_ffmpeg = resolve_ffmpeg()
    if not resolved_ffmpeg:
        print("ffmpeg not found. Install ffmpeg or set FFMPEG_PATH environment variable to ffmpeg path.")
        return 2
    print(f"Using ffmpeg at: {resolved_ffmpeg}")

    ensure_dir(WORK_DIR)
    ensure_dir(OUTPUT_DIR)

    sentences = split_sentences(TEXT)
    if not sentences:
        print("No sentences to process.")
        return 1

    voice_path, subtitle_items = asyncio.run(generate_tts(sentences, WORK_DIR))
    # Back-check timing against actual audio duration and scale if needed
    voice_duration = ffprobe_duration(voice_path)
    if voice_duration and subtitle_items:
        last_end = subtitle_items[-1].end
        if last_end > 0 and abs(last_end - voice_duration) > 0.05:
            scale = voice_duration / last_end
            for item in subtitle_items:
                item.start *= scale
                item.end *= scale
        # Ensure non-overlap after scaling
        prev_end = 0.0
        for item in subtitle_items:
            if item.start < prev_end:
                shift = prev_end - item.start
                item.start += shift
                item.end += shift
            prev_end = item.end
        # Clamp last subtitle end to audio duration to avoid tail cut
        if subtitle_items[-1].end > voice_duration:
            subtitle_items[-1].end = max(subtitle_items[-1].start, voice_duration)
    # Requirement: remove punctuation only after audio generation, and keep subtitles punctuation-free.
    for item in subtitle_items:
        item.text = strip_subtitle_punctuation(item.text)
    # Requirement: when subtitle text exceeds 26 characters, split into multiple pages.
    subtitle_items = paginate_subtitle_items(subtitle_items, max_chars_per_page=26)
    srt_path = WORK_DIR / "subtitles.srt"
    write_srt(subtitle_items, srt_path)

    total_duration = subtitle_items[-1].end if subtitle_items else ffprobe_duration(voice_path) or 0
    if total_duration <= 0:
        print("Invalid voice duration.")
        return 1

    phone_clips = list_media(PHONE_DIR, VIDEO_EXTS)
    indoor_clips = list_media(INDOOR_DIR, VIDEO_EXTS)
    aigc_clips = list_media(AIGC_DIR, VIDEO_EXTS)
    print(f"Found media: phone={len(phone_clips)}, indoor={len(indoor_clips)}, aigc={len(aigc_clips)}")
    timeline = build_timeline(total_duration, phone_clips, indoor_clips, aigc_clips)

    bgm_path = pick_random_file(BGM_DIR, AUDIO_EXTS)
    watermark = pick_watermark(WATERMARK_PATH)
    print(f"Selected bgm: {bgm_path}")
    print(f"Selected watermark: {watermark}")

    # Output name: date + sequence, e.g., 3月9日（1）
    from datetime import datetime
    now = datetime.now()
    date_prefix = f"{now.month}月{now.day}日"
    seq = 1
    while True:
        name = f"{date_prefix}（{seq}）.mp4"
        candidate = OUTPUT_DIR / name
        if not candidate.exists():
            output_path = candidate
            break
        seq += 1
    run_ffmpeg(timeline, voice_path, srt_path, bgm_path, watermark, output_path)

    manifest = {
        "voice_path": str(voice_path),
        "srt_path": str(srt_path),
        "bgm_path": str(bgm_path) if bgm_path else None,
        "watermark": str(watermark) if watermark else None,
        "output": str(output_path),
    }
    (OUTPUT_DIR / "ffmpeg_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"Done: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())



