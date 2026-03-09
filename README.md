# AIGC 视频混剪工具

自动生成短视频的 Python 工具，支持：
- 文字转语音（edge-tts）
- 视频混剪
- 水印添加
- 背景音乐合成

## 安装依赖

```bash
pip install -r requirements.txt
```

## 系统要求

- Python 3.9+
- FFmpeg（系统需安装）

## 使用方法

### FFmpeg 管道
```bash
python run_ffmpeg_pipeline.py
```

### VectCut 管道
```bash
python run_vectcut_pipeline.py
```

## 配置

在脚本中修改以下路径：
- `PHONE_DIR` - 手机素材目录
- `INDOOR_DIR` - 室内素材目录
- `BGM_DIR` - 背景音乐目录
- `WATERMARK_PATH` - 水印路径
- `OUTPUT_DIR` - 输出目录

## 输出

生成的视频保存在 `output/` 目录

## License

MIT
