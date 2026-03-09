#!/usr/bin/env python3
import asyncio
import json
import random
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple, Optional

import requests

# Local VectCutAPI client
sys.path.append(str(Path(__file__).parent / "vectcut-api" / "vectcut-api" / "scripts"))
from vectcut_client import VectCutClient  # type: ignore


BASE_URL = "http://localhost:9001"

TEXT = (
    "首付二十万在无锡拿下一套地铁口小两房，现在其实并不稀奇。"
    "很多人每天还在担心房价会不会涨，结果别人已经在捡漏。"
    "我朋友就是在南京选房师群里看到的房源，房东急着置换，价格直接比市场低了二十多万。"
    "这类房子平台上基本刷不到，多数都是急售房、工抵房，只在小圈子里流通。"
    "无锡选房师每天都会更新真实在降价的二手房源，群里还有很多正在看房的无锡朋友交流信息。"
    "如果你也想看看现在无锡有哪些捡漏房，可以点击视频下方添加无锡选房师就能进群。"
)

VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "+0%"
VOLUME = "+0%"

PHONE_DIR = Path(r"D:\混剪素材\手机录屏")
INDOOR_DIR = Path(r"D:\混剪素材\合肥好房")
AIGC_DIR = Path(r"D:\混剪素材\AIGC")

# Requested BGM path (may be missing)
BGM_DIR_PRIMARY = Path(r"D:\cutcup\cutcup-pipeline\assets\music")
# Fallbacks discovered in repo
BGM_DIR_FALLBACKS = [
    Path(r"D:\cutcup\cutcup-pipeline\remotion\public\media\music"),
    Path(r"D:\cutcup\cutcup-pipeline\create-pr\remotion\template\public\media\sucai\music"),
]

OUTPUT_DIR = Path(r"D:\cutcup\cutcup-pipeline\remotion\output\final")
WORK_DIR = Path(__file__).parent / "tmp_vectcut"

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi"}
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac"}

TRANSITION = "fade_in"
TRANSITION_DURATION = 0.5


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
        # If too long, split by comma-like punctuation
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


def pick_bgm() -> Optional[Path]:
    candidates = list_media(BGM_DIR_PRIMARY, AUDIO_EXTS)
    if not candidates:
        for fb in BGM_DIR_FALLBACKS:
            candidates = list_media(fb, AUDIO_EXTS)
            if candidates:
                return random.choice(candidates)
        return None
    return random.choice(candidates)


def format_timestamp(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int((t - int(t)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(items: List[SentenceItem], out_path: Path) -> None:
    lines = []
    for i, item in enumerate(items, start=1):
        lines.append(str(i))
        lines.append(f"{format_timestamp(item.start)} --> {format_timestamp(item.end)}")
        lines.append(item.text)
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
    client: VectCutClient,
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

    while current < total_duration - 0.05:
        remaining = total_duration - current
        cat_pool = categories[:]
        if last_cat and len(cat_pool) > 1:
            cat_pool = [c for c in cat_pool if c[0] != last_cat]

        cat, clips, speed = random.choice(cat_pool)
        clip = random.choice(clips)

        clip_duration = client.get_duration(str(clip))
        if not clip_duration or clip_duration <= 0:
            # Skip unreadable media
            continue

        max_timeline = clip_duration / speed
        target_len = min(remaining, max_timeline, random.uniform(4.0, 6.5))
        if remaining < 4.0:
            target_len = min(remaining, max_timeline)

        if target_len <= 0.1:
            break

        src_len = target_len * speed
        max_start = max(0.0, clip_duration - src_len)
        src_start = random.uniform(0.0, max_start) if max_start > 0 else 0.0
        src_end = src_start + src_len

        transition_duration = TRANSITION_DURATION if timeline else 0.0
        target_start = max(0.0, current - transition_duration)

        timeline.append(
            {
                "path": clip,
                "start": src_start,
                "end": src_end,
                "target_start": target_start,
                "speed": speed,
                "transition": TRANSITION if timeline else None,
                "transition_duration": transition_duration,
            }
        )

        current += target_len - transition_duration
        last_cat = cat

    return timeline


def main() -> int:
    ensure_dir(WORK_DIR)
    ensure_dir(OUTPUT_DIR)

    sentences = split_sentences(TEXT)
    if not sentences:
        print("No sentences to process.")
        return 1

    voice_path, subtitle_items = asyncio.run(generate_tts(sentences, WORK_DIR))
    srt_path = WORK_DIR / "subtitles.srt"
    write_srt(subtitle_items, srt_path)

    bgm_path = pick_bgm()

    phone_clips = list_media(PHONE_DIR, VIDEO_EXTS)
    indoor_clips = list_media(INDOOR_DIR, VIDEO_EXTS)
    aigc_clips = list_media(AIGC_DIR, VIDEO_EXTS)

    with VectCutClient(BASE_URL) as client:
        draft = client.create_draft(width=1080, height=1920)

        total_duration = subtitle_items[-1].end
        timeline = build_timeline(client, total_duration, phone_clips, indoor_clips, aigc_clips)

        for seg in timeline:
            ok = client.add_video(
                draft.draft_id,
                str(seg["path"]),
                start=seg["start"],
                end=seg["end"],
                target_start=seg["target_start"],
                speed=seg["speed"],
                volume=0.0,
                transition=seg["transition"],
                transition_duration=seg["transition_duration"],
            )
            if not ok:
                print(f"add_video failed: {seg['path']}")

        # Voiceover
        client.add_audio(
            draft.draft_id,
            str(voice_path),
            start=0,
            end=total_duration,
            target_start=0,
            volume=1.0,
            track_name="audio_voice",
        )

        # BGM (lower than voice)
        if bgm_path:
            client.add_audio(
                draft.draft_id,
                str(bgm_path),
                start=0,
                end=total_duration,
                target_start=0,
                volume=0.22,
                track_name="audio_bgm",
            )

        # Subtitles as styled text blocks
        for item in subtitle_items:
            client.add_text(
                draft.draft_id,
                item.text,
                start=item.start,
                end=item.end,
                font_size=60,
                font_color="#000000",
                background_color="#FFD700",
                background_alpha=1.0,
                background_round_radius=16,
                alignment_h="center",
                alignment_v="middle",
                pos_x=0,
                pos_y=0,
            )

        # Watermark
        client.add_text(
            draft.draft_id,
            "无锡选房师",
            start=0,
            end=total_duration,
            font_size=28,
            font_color="#FFFFFF",
            shadow_enabled=True,
            shadow_color="#000000",
            alignment_h="right",
            alignment_v="bottom",
            pos_x=0.42,
            pos_y=0.42,
        )

        result = client.save_draft(draft.draft_id)

        out_manifest = OUTPUT_DIR / "vectcut_manifest.json"
        out_manifest.write_text(
            json.dumps(
                {
                    "draft_id": draft.draft_id,
                    "draft_url": result.draft_url,
                    "voice_path": str(voice_path),
                    "srt_path": str(srt_path),
                    "bgm_path": str(bgm_path) if bgm_path else None,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        print(f"Draft URL: {result.draft_url}")
        print(f"Manifest: {out_manifest}")

        # Attempt export (if server supports)
        try:
            export_path = OUTPUT_DIR / "final.mp4"
            resp = requests.post(
                f"{BASE_URL}/export_draft_to_video",
                json={"draft_id": draft.draft_id, "output_path": str(export_path)},
                timeout=30,
            )
            if resp.ok:
                print(f"Export response: {resp.text}")
            else:
                print(f"Export failed: {resp.status_code} {resp.text}")
        except Exception as exc:
            print(f"Export call error: {exc}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
