import React, { useState, useEffect } from 'react';
import { 
  Video, 
  Music, 
  Type, 
  Settings, 
  Play, 
  Download, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Image as ImageIcon,
  Type as FontIcon,
  Volume2,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface GenerationResult {
  success: boolean;
  videoUrl: string;
  fileName: string;
  error?: string;
}

export default function App() {
  const [script, setScript] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  
  // Advanced Config
  const [config, setConfig] = useState({
    fontSize: 9,
    fontColor: '#FFFFFF',
    fontBgColor: '#FFFF00',
    subtitleBottom: 60,
    sceneMatPath: '/Users/xm/Downloads/sucai',
    bgmPath: '/Users/xm/Downloads/sucai/music',
    bgmVolume: -3,
    watermarkPath: '/Users/xm/Downloads/水印',
    voiceType: 'zh-CN-XiaoxiaoNeural',
  });

  const [previewFiles, setPreviewFiles] = useState<{name: string, path: string}[]>([]);
  const [previewType, setPreviewType] = useState<'video' | 'audio' | 'image' | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [subtitles, setSubtitles] = useState<{text: string, start: string, end: string}[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const fetchFiles = async (path: string, type: 'video' | 'audio' | 'image') => {
    try {
      const response = await fetch('/api/list-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirPath: path, type }),
      });
      const data = await response.json();
      if (data.files) {
        setPreviewFiles(data.files.map((f: string) => ({ name: f, path: `${path}/${f}` })));
        setPreviewType(type);
        setShowPreviewModal(true);
      }
    } catch (err) {
      console.error('Failed to fetch files', err);
    }
  };

  const handleGenerate = async () => {
    if (!script.trim()) return;
    
    setIsGenerating(true);
    setResult(null);
    setCurrentStep(1);

    // Simulate progress steps
    const stepInterval = setInterval(() => {
      setCurrentStep(prev => {
        if (prev < 4) return prev + 1;
        return prev;
      });
    }, 3000);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script,
          ...config,
          subtitlePosition: { bottom: config.subtitleBottom, align: 'center' }
        }),
      });

      const data = await response.json();
      clearInterval(stepInterval);

      if (data.success) {
        setCurrentStep(5);
        setResult(data);
        // Simulate ASR subtitles and Audio for preview
        setAudioUrl(data.videoUrl); // Using video URL as proxy for audio for demo
        setSubtitles(
          script.split(/[，。！？\n]/).filter(s => s.trim()).map((s, i) => ({
            text: s.trim(),
            start: `00:0${i * 2}`,
            end: `00:0${(i * 2) + 2}`
          }))
        );
      } else {
        setCurrentStep(0);
        setResult({ success: false, error: data.error, videoUrl: '', fileName: '' });
      }
    } catch (err) {
      clearInterval(stepInterval);
      setCurrentStep(0);
      setResult({ success: false, error: '连接服务器失败', videoUrl: '', fileName: '' });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
      {/* Header */}
      <header className="border-b border-[#141414] p-6 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#141414] rounded-full flex items-center justify-center text-[#E4E3E0]">
            <Video size={20} />
          </div>
          <h1 className="text-xl font-bold tracking-tight uppercase italic font-serif">视频生成工作流</h1>
        </div>
        <div className="text-[11px] font-mono opacity-50 uppercase tracking-widest">
          v1.0.0 / 生产就绪
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Progress & Result */}
        <div className="lg:col-span-4 space-y-6">
          {/* Workflow Progress */}
          <section className="p-6 bg-[#141414] text-[#E4E3E0] rounded-2xl shadow-[4px_4px_0px_0px_rgba(20,20,20,0.2)]">
            <h3 className="text-xs font-mono uppercase tracking-widest mb-6">工作流进度</h3>
            <div className="space-y-4">
              {[
                "文案语义自动断句",
                "Edge-TTS 语音合成",
                "音画同步字幕生成",
                "视频合成 (含 BGM 和水印)",
                "输出至 /output 文件夹"
              ].map((step, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] transition-all duration-500 ${
                    currentStep > index + 1 
                      ? 'bg-emerald-500 border-emerald-500 text-white' 
                      : currentStep === index + 1 
                        ? 'bg-white border-white text-[#141414] animate-pulse shadow-[0_0_10px_rgba(255,255,255,0.5)]' 
                        : 'border-white/20 text-white/20'
                  }`}>
                    {currentStep > index + 1 ? '✓' : index + 1}
                  </div>
                  <div className={`text-[11px] font-mono transition-all duration-500 ${
                    currentStep >= index + 1 ? 'text-white opacity-100' : 'text-white/20'
                  }`}>
                    {step}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Status/Result */}
          <AnimatePresence mode="wait">
            {result && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className={`border border-[#141414] rounded-2xl overflow-hidden shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] ${
                  result.success ? 'bg-white' : 'bg-red-50'
                }`}
              >
                <div className={`p-4 flex items-center justify-between ${result.success ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
                  <div className="flex items-center gap-2">
                    {result.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                    <span className="text-xs font-mono uppercase tracking-wider">
                      {result.success ? '成功' : '错误'}
                    </span>
                  </div>
                  {result.success && (
                    <a 
                      href={result.videoUrl} 
                      download={result.fileName}
                      className="text-[10px] font-mono uppercase underline hover:opacity-80"
                    >
                      点击下载
                    </a>
                  )}
                </div>
                <div className="p-6">
                  {result.success ? (
                    <div className="space-y-4">
                      <video 
                        src={result.videoUrl} 
                        controls 
                        className="w-full rounded-xl border border-[#141414] bg-black aspect-video"
                      />
                      <div className="flex justify-between items-center text-xs font-mono">
                        <span className="opacity-50">文件: {result.fileName}</span>
                        <span className="opacity-50">状态: 已就绪</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-red-600 font-mono text-sm">{result.error}</p>
                  )}
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>

        {/* Right Column: Input & Config */}
        <div className="lg:col-span-8 space-y-6">
          <section className="bg-white border border-[#141414] rounded-2xl overflow-hidden shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="border-b border-[#141414] p-4 bg-[#141414] text-[#E4E3E0] flex items-center gap-2">
              <FileText size={16} />
              <span className="text-xs font-mono uppercase tracking-wider">文案输入</span>
            </div>
            <div className="p-6">
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="在此输入您的文案... 系统将自动进行语义断句并生成匹配的音频和字幕。"
                className="w-full h-48 p-4 text-lg font-serif border border-[#141414]/10 rounded-xl focus:outline-none focus:border-[#141414] transition-colors resize-none bg-[#F9F9F7]"
              />
              
              {/* ASR Subtitles & Audio Preview Section */}
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* ASR Subtitles */}
                <div className="space-y-3">
                  <label className="text-[10px] font-mono uppercase opacity-50 flex items-center gap-2">
                    <Type size={12} /> ASR 字幕预览 (可编辑)
                  </label>
                  <div className="h-40 overflow-y-auto border border-[#141414]/10 rounded-xl bg-[#F9F9F7] p-3 space-y-2">
                    {subtitles.length > 0 ? subtitles.map((sub, idx) => (
                      <div key={idx} className="flex gap-2 items-start group">
                        <span className="text-[9px] font-mono opacity-30 mt-1 shrink-0">{sub.start}</span>
                        <input 
                          type="text"
                          value={sub.text}
                          onChange={(e) => {
                            const newSubs = [...subtitles];
                            newSubs[idx].text = e.target.value;
                            setSubtitles(newSubs);
                          }}
                          className="w-full bg-transparent border-b border-transparent hover:border-[#141414]/20 focus:border-[#141414] focus:outline-none text-xs py-0.5"
                        />
                      </div>
                    )) : (
                      <div className="h-full flex items-center justify-center text-[10px] font-mono opacity-30 italic">
                        生成后在此预览并修改字幕
                      </div>
                    )}
                  </div>
                </div>

                {/* Audio Preview */}
                <div className="space-y-3">
                  <label className="text-[10px] font-mono uppercase opacity-50 flex items-center gap-2">
                    <Music size={12} /> 口播音频试听
                  </label>
                  <div className="h-40 border border-[#141414]/10 rounded-xl bg-[#F9F9F7] p-6 flex flex-col items-center justify-center gap-4">
                    {audioUrl ? (
                      <>
                        <div className="w-12 h-12 bg-[#141414] rounded-full flex items-center justify-center text-[#E4E3E0] shadow-lg">
                          <Volume2 size={24} />
                        </div>
                        <audio src={audioUrl} controls className="w-full h-8" />
                      </>
                    ) : (
                      <div className="text-center space-y-2 opacity-30">
                        <Music size={32} className="mx-auto" />
                        <p className="text-[10px] font-mono uppercase">等待生成音频</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-between items-center">
                <div className="flex gap-3">
                  <span className="text-[10px] font-mono opacity-50 uppercase">字符数: {script.length}</span>
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !script.trim()}
                  className={`px-8 py-3 rounded-full font-bold uppercase tracking-widest text-sm transition-all flex items-center gap-2 ${
                    isGenerating || !script.trim()
                      ? 'bg-[#141414]/10 text-[#141414]/30 cursor-not-allowed'
                      : 'bg-[#141414] text-[#E4E3E0] hover:scale-105 active:scale-95 shadow-lg'
                  }`}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      生成中...
                    </>
                  ) : (
                    <>
                      <Play size={16} fill="currentColor" />
                      立即生成视频
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>

          <section className="bg-white border border-[#141414] rounded-2xl overflow-hidden shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="border-b border-[#141414] p-4 bg-[#141414] text-[#E4E3E0] flex items-center gap-2">
              <Settings size={16} />
              <span className="text-xs font-mono uppercase tracking-wider">配置参数</span>
            </div>
            <div className="p-6 space-y-6">
              {/* Subtitle Config */}
              <div className="space-y-3">
                <label className="text-[10px] font-mono uppercase opacity-50 flex items-center gap-2">
                  <FontIcon size={12} /> 字幕样式
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono">字号</span>
                    <input 
                      type="number" 
                      value={config.fontSize}
                      onChange={(e) => setConfig({...config, fontSize: parseInt(e.target.value)})}
                      className="w-full p-2 border border-[#141414]/10 rounded-lg text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono">底部边距 (px)</span>
                    <input 
                      type="number" 
                      value={config.subtitleBottom}
                      onChange={(e) => setConfig({...config, subtitleBottom: parseInt(e.target.value)})}
                      className="w-full p-2 border border-[#141414]/10 rounded-lg text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono">文字颜色</span>
                    <input 
                      type="color" 
                      value={config.fontColor}
                      onChange={(e) => setConfig({...config, fontColor: e.target.value})}
                      className="w-full h-10 p-1 border border-[#141414]/10 rounded-lg"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono">背景颜色</span>
                    <input 
                      type="color" 
                      value={config.fontBgColor}
                      onChange={(e) => setConfig({...config, fontBgColor: e.target.value})}
                      className="w-full h-10 p-1 border border-[#141414]/10 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              {/* Assets Config */}
              <div className="space-y-3">
                <label className="text-[10px] font-mono uppercase opacity-50 flex items-center gap-2">
                  <ImageIcon size={12} /> 素材路径
                </label>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-mono">分镜素材路径</span>
                      <button 
                        onClick={() => fetchFiles(config.sceneMatPath, 'video')}
                        className="text-[10px] font-mono text-blue-600 hover:underline"
                      >
                        预览素材
                      </button>
                    </div>
                    <input 
                      type="text" 
                      value={config.sceneMatPath}
                      onChange={(e) => setConfig({...config, sceneMatPath: e.target.value})}
                      className="w-full p-2 border border-[#141414]/10 rounded-lg text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-mono">背景音乐路径</span>
                      <button 
                        onClick={() => fetchFiles(config.bgmPath, 'audio')}
                        className="text-[10px] font-mono text-blue-600 hover:underline"
                      >
                        试听音乐
                      </button>
                    </div>
                    <input 
                      type="text" 
                      value={config.bgmPath}
                      onChange={(e) => setConfig({...config, bgmPath: e.target.value})}
                      className="w-full p-2 border border-[#141414]/10 rounded-lg text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-mono">水印路径</span>
                      <button 
                        onClick={() => fetchFiles(config.watermarkPath, 'image')}
                        className="text-[10px] font-mono text-blue-600 hover:underline"
                      >
                        查看水印
                      </button>
                    </div>
                    <input 
                      type="text" 
                      value={config.watermarkPath}
                      onChange={(e) => setConfig({...config, watermarkPath: e.target.value})}
                      className="w-full p-2 border border-[#141414]/10 rounded-lg text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Audio Config */}
              <div className="space-y-3">
                <label className="text-[10px] font-mono uppercase opacity-50 flex items-center gap-2">
                  <Volume2 size={12} /> 音频设置
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono">BGM 音量 (dB)</span>
                    <input 
                      type="number" 
                      value={config.bgmVolume}
                      onChange={(e) => setConfig({...config, bgmVolume: parseInt(e.target.value)})}
                      className="w-full p-2 border border-[#141414]/10 rounded-lg text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono">音色选择</span>
                    <select
                      value={config.voiceType}
                      onChange={(e) => setConfig({...config, voiceType: e.target.value})}
                      className="w-full p-2 border border-[#141414]/10 rounded-lg text-sm bg-white"
                    >
                      <option value="zh-CN-XiaoxiaoNeural">女声 (晓晓)</option>
                      <option value="zh-CN-YunxiNeural">男声 (云希)</option>
                      <option value="zh-CN-XiaoyiNeural">女声 (晓伊)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Preview Modal */}
      <AnimatePresence>
        {showPreviewModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white w-full max-w-4xl rounded-3xl overflow-hidden shadow-2xl border border-[#141414]"
            >
              <div className="p-4 bg-[#141414] text-[#E4E3E0] flex justify-between items-center">
                <span className="text-xs font-mono uppercase tracking-wider">
                  素材预览 - {previewType === 'video' ? '分镜视频' : previewType === 'audio' ? '背景音乐' : '水印图片'}
                </span>
                <button 
                  onClick={() => {
                    setShowPreviewModal(false);
                    setSelectedPreview(null);
                  }}
                  className="hover:opacity-70"
                >
                  关闭
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 h-[600px]">
                {/* File List */}
                <div className="border-r border-[#141414]/10 overflow-y-auto p-4 space-y-2 bg-[#F9F9F7]">
                  {previewFiles.length > 0 ? previewFiles.map((file) => (
                    <button
                      key={file.path}
                      onClick={() => setSelectedPreview(file.path)}
                      className={`w-full text-left p-3 rounded-xl text-xs font-mono truncate transition-colors ${
                        selectedPreview === file.path ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/5'
                      }`}
                    >
                      {file.name}
                    </button>
                  )) : (
                    <div className="text-center py-10 opacity-50 text-xs font-mono">未找到素材</div>
                  )}
                </div>
                {/* Preview Area */}
                <div className="md:col-span-2 p-8 flex items-center justify-center bg-zinc-100">
                  {selectedPreview ? (
                    <div className="w-full space-y-4">
                      {previewType === 'video' && (
                        <video 
                          key={selectedPreview}
                          src={`/api/file-proxy?path=${encodeURIComponent(selectedPreview)}`} 
                          controls 
                          className="w-full rounded-2xl shadow-lg bg-black aspect-video"
                        />
                      )}
                      {previewType === 'audio' && (
                        <div className="bg-white p-8 rounded-2xl shadow-lg border border-[#141414]/5 w-full">
                          <div className="flex items-center gap-4 mb-4">
                            <div className="w-12 h-12 bg-[#141414] rounded-full flex items-center justify-center text-[#E4E3E0]">
                              <Music size={24} />
                            </div>
                            <div>
                              <div className="text-sm font-bold truncate max-w-[300px]">{selectedPreview.split('/').pop()}</div>
                              <div className="text-[10px] font-mono opacity-50 uppercase">Audio Track</div>
                            </div>
                          </div>
                          <audio 
                            key={selectedPreview}
                            src={`/api/file-proxy?path=${encodeURIComponent(selectedPreview)}`} 
                            controls 
                            className="w-full"
                          />
                        </div>
                      )}
                      {previewType === 'image' && (
                        <div className="relative group">
                          <img 
                            key={selectedPreview}
                            src={`/api/file-proxy?path=${encodeURIComponent(selectedPreview)}`} 
                            alt="Watermark Preview"
                            className="max-w-full max-h-[400px] rounded-xl shadow-lg border border-[#141414]/10"
                            referrerPolicy="no-referrer"
                          />
                          <div className="absolute inset-0 border-2 border-dashed border-blue-500/30 rounded-xl pointer-events-none"></div>
                        </div>
                      )}
                      <div className="text-[10px] font-mono opacity-50 break-all text-center">
                        路径: {selectedPreview}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center space-y-4 opacity-30">
                      <div className="w-20 h-20 border-2 border-dashed border-[#141414] rounded-full flex items-center justify-center mx-auto">
                        {previewType === 'video' ? <Video size={32} /> : previewType === 'audio' ? <Music size={32} /> : <ImageIcon size={32} />}
                      </div>
                      <p className="text-xs font-mono uppercase tracking-widest">请选择一个文件进行预览</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="mt-12 border-t border-[#141414] p-8 text-center">
        <p className="text-[10px] font-mono uppercase opacity-30 tracking-[0.2em]">
          自动化视频生产系统 &copy; 2026
        </p>
      </footer>
    </div>
  );
}
