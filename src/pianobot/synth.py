"""Synthetic audio generation, for exercising the full CLI pipeline
(stems -> models -> MIDI) without needing a real song file.

The output is a toy "song": a sung-ish melody (voice-like sine +
vibrato, panned/leveled like lead vocal) over a chord pad and a kick
pulse, at a fixed, known tempo/chord progression -- so once the real
model stages are installed you can sanity-check their output against
ground truth instead of just checking "it didn't crash".
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

_A4 = 440.0


def _midi_to_hz(pitch: int) -> float:
    return _A4 * 2 ** ((pitch - 69) / 12)


def _tone(freq: float, duration: float, sr: int, vibrato: float = 0.0, amp: float = 0.3) -> np.ndarray:
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    vibrato_mod = 1.0 + vibrato * np.sin(2 * np.pi * 5.5 * t) if vibrato else 1.0
    wave = amp * np.sin(2 * np.pi * freq * vibrato_mod * t)
    envelope = np.minimum(1.0, np.minimum(t, duration - t) * 20 + 0.05)
    return wave * envelope


GROUND_TRUTH_TEMPO = 100.0
GROUND_TRUTH_MELODY = [60, 62, 64, 65, 64, 62, 60, 60]  # C4 D4 E4 F4 E4 D4 C4 C4, one per beat
GROUND_TRUTH_CHORDS = [(0, "maj"), (5, "maj"), (9, "min"), (7, "maj")]  # C, F, Am, G (2 beats each)


def generate_synthetic_song(path: Path, sr: int = 22050) -> Path:
    beat_dur = 60.0 / GROUND_TRUTH_TEMPO
    n_beats = len(GROUND_TRUTH_MELODY)
    duration = n_beats * beat_dur
    n_samples = int(sr * duration)

    mix = np.zeros(n_samples)

    # "Vocal" melody line (one note per beat).
    for i, pitch in enumerate(GROUND_TRUTH_MELODY):
        start = int(i * beat_dur * sr)
        tone = _tone(_midi_to_hz(pitch), beat_dur * 0.95, sr, vibrato=0.01, amp=0.35)
        mix[start:start + len(tone)] += tone

    # Chord pad (2 beats per chord), root + third + fifth an octave down.
    root_intervals = {"maj": (0, 4, 7), "min": (0, 3, 7)}
    for i, (root_pc, quality) in enumerate(GROUND_TRUTH_CHORDS):
        start = int(i * 2 * beat_dur * sr)
        chord_dur = 2 * beat_dur
        for interval in root_intervals[quality]:
            pitch = 48 + root_pc + interval
            tone = _tone(_midi_to_hz(pitch), chord_dur * 0.98, sr, amp=0.12)
            mix[start:start + len(tone)] += tone

    # Kick pulse on every beat, so beat trackers have something to grab onto.
    for i in range(n_beats):
        start = int(i * beat_dur * sr)
        click_len = int(sr * 0.05)
        click = 0.5 * np.exp(-np.linspace(0, 30, click_len)) * np.sin(2 * np.pi * 60 * np.linspace(0, 0.05, click_len))
        mix[start:start + click_len] += click

    mix = mix / max(1.0, np.abs(mix).max())
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), mix, sr)
    return path
