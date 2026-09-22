"""Stem separation via Demucs.

Install: pip install "pianobot5000[stems]"
Demucs pulls in torch and downloads model weights (~80-300MB) on first
run; CPU inference works but is slow (a few minutes per song). A GPU
laptop will be much faster.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from .types import StemSet

_MODEL = "htdemucs"  # 4-stem: vocals, drums, bass, other
_STEM_NAMES = ("vocals", "drums", "bass", "other")


class DemucsUnavailable(RuntimeError):
    pass


def separate_stems(audio_path: Path, work_dir: Path) -> StemSet:
    """Run Demucs on ``audio_path``, writing stems under ``work_dir``.

    Returns a StemSet pointing at the separated .wav files. Idempotent:
    if the expected outputs already exist under work_dir, reuses them.
    """
    audio_path = Path(audio_path)
    work_dir = Path(work_dir)
    out_dir = work_dir / "demucs" / _MODEL / audio_path.stem

    if not all((out_dir / f"{name}.wav").exists() for name in _STEM_NAMES):
        _run_demucs(audio_path, work_dir / "demucs")

    return StemSet(
        original=audio_path,
        vocals=out_dir / "vocals.wav",
        drums=out_dir / "drums.wav",
        bass=out_dir / "bass.wav",
        other=out_dir / "other.wav",
    )


def _run_demucs(audio_path: Path, out_root: Path) -> None:
    try:
        import demucs.separate  # noqa: F401
    except ImportError as exc:
        raise DemucsUnavailable(
            "demucs is not installed. Run: pip install 'pianobot5000[stems]'"
        ) from exc

    out_root.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        "-m",
        "demucs.separate",
        "-n",
        _MODEL,
        "-o",
        str(out_root),
        str(audio_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"demucs failed (exit {result.returncode}):\n{result.stderr[-4000:]}"
        )


def is_available() -> bool:
    return shutil.which("ffmpeg") is not None and _has_module("demucs")


def _has_module(name: str) -> bool:
    try:
        __import__(name)
        return True
    except ImportError:
        return False
