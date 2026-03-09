#!/usr/bin/env python3
import subprocess
from pathlib import Path

VIDEO_DIR = Path('/Users/xm/Downloads/sucai')
MUSIC_DIR = Path('/Users/xm/Downloads/sucai/music')
WATERMARK_DIR = Path('/Users/xm/Downloads/水印')

VIDEO_EXTS = {'.mp4','.mov','.mkv','.avi'}
AUDIO_EXTS = {'.mp3','.wav','.m4a','.aac'}
IMAGE_EXTS = {'.png','.jpg','.jpeg','.webp'}

def list_files(root: Path, exts):
    if not root.exists():
        return []
    return [p for p in root.rglob('*') if p.suffix.lower() in exts]

def ffprobe_duration(path: Path, timeout=6):
    cmd = [
        'ffprobe','-v','error','-analyzeduration','1000000','-probesize','500000',
        '-show_entries','format=duration','-of','json',str(path)
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if res.returncode != 0:
            return None, res.stderr.strip()
        return res.stdout.strip(), None
    except subprocess.TimeoutExpired:
        return None, 'timeout'
    except Exception as e:
        return None, str(e)

def main():
    vids = list_files(VIDEO_DIR, VIDEO_EXTS|IMAGE_EXTS)
    auds = list_files(MUSIC_DIR, AUDIO_EXTS)
    wms = list_files(WATERMARK_DIR, IMAGE_EXTS)

    print(f'Found video/image files: {len(vids)}')
    print(f'Found audio files: {len(auds)}')
    print(f'Found watermark image files: {len(wms)}')

    print('\nSample video/image files (up to 10):')
    for p in vids[:10]:
        print(p)

    print('\nSample audio files (up to 10):')
    for p in auds[:10]:
        print(p)

    print('\nTesting ffprobe on first 8 video/image files for duration:')
    for p in vids[:8]:
        out, err = ffprobe_duration(p, timeout=6)
        print('\n==', p)
        if out:
            print(out)
        else:
            print('ffprobe error:', err)

    print('\nTesting ffprobe on first 5 audio files for duration:')
    for p in auds[:5]:
        out, err = ffprobe_duration(p, timeout=6)
        print('\n==', p)
        if out:
            print(out)
        else:
            print('ffprobe error:', err)

if __name__ == '__main__':
    main()
