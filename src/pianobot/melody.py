"""Melody extraction (Basic Pitch on the vocal stem) + cleanup.

Install: pip install "pianobot5000[melody]"
Basic Pitch (Spotify) is CPU-friendly (small ONNX/TF model, no GPU
needed) and is the lightest of the four model stages -- a good one to
verify first.
"""

from __future__ import annotations

from pathlib import Path

from .types import Beat, NoteEvent


class BasicPitchUnavailable(RuntimeError):
    pass


def extract_melody_notes(vocals_path: Path) -> list[NoteEvent]:
    """Run Basic Pitch on a vocal stem, returning raw (possibly
    polyphonic/overlapping) note events. Use ``clean_melody`` to turn
    this into a single-line, quantized right-hand part.
    """
    try:
        from basic_pitch.inference import predict
        from basic_pitch import ICASSP_2022_MODEL_PATH
    except ImportError as exc:
        raise BasicPitchUnavailable(
            "basic-pitch is not installed. Run: pip install 'pianobot5000[melody]'"
        ) from exc

    _, _, note_events = predict(str(vocals_path), model_or_model_path=ICASSP_2022_MODEL_PATH)
    notes = [
        NoteEvent(pitch=int(pitch), start=float(start), end=float(end), velocity=_amp_to_velocity(amp))
        for start, end, pitch, amp, _pitch_bend in note_events
        if end > start
    ]
    notes.sort(key=lambda n: n.start)
    return notes


def clean_melody(notes: list[NoteEvent], beats: list[Beat], subdivisions_per_beat: int = 2) -> list[NoteEvent]:
    """Collapse to a single monophonic line and snap onsets/offsets to
    the beat grid, matching the diagram's "one note, quantized" box.
    """
    mono = _to_monophonic(notes)
    if not beats:
        return mono
    grid = _beat_grid(beats, subdivisions_per_beat)
    return _quantize(mono, grid)


def _amp_to_velocity(amplitude: float) -> int:
    return max(1, min(127, round(float(amplitude) * 127)))


def _to_monophonic(notes: list[NoteEvent]) -> list[NoteEvent]:
    """At any instant, keep only the loudest active note. Resolves
    Basic Pitch's occasional polyphonic/overlapping output down to a
    single melodic line, which is what a vocal line actually is.
    """
    ordered = sorted(notes, key=lambda n: (n.start, -n.velocity))
    result: list[NoteEvent] = []
    for note in ordered:
        start, end = note.start, note.end
        # Trim against any already-kept note it overlaps.
        for kept in reversed(result):
            if kept.end <= start:
                break
            if kept.velocity >= note.velocity:
                start = max(start, kept.end)
            else:
                kept.end = min(kept.end, note.start)
        if end - start > 1e-3:
            result.append(NoteEvent(pitch=note.pitch, start=start, end=end, velocity=note.velocity))
    result = [n for n in result if n.end > n.start]
    result.sort(key=lambda n: n.start)
    return result


def _beat_grid(beats: list[Beat], subdivisions_per_beat: int) -> list[float]:
    times = [b.time for b in beats]
    if subdivisions_per_beat <= 1 or len(times) < 2:
        return times
    grid: list[float] = []
    for a, b in zip(times, times[1:]):
        step = (b - a) / subdivisions_per_beat
        grid.extend(a + i * step for i in range(subdivisions_per_beat))
    grid.append(times[-1])
    return grid


def _snap(time: float, grid: list[float]) -> float:
    return min(grid, key=lambda g: abs(g - time))


def _quantize(notes: list[NoteEvent], grid: list[float]) -> list[NoteEvent]:
    quantized = []
    for note in notes:
        start = _snap(note.start, grid)
        end = _snap(note.end, grid)
        if end <= start:
            continue
        quantized.append(NoteEvent(pitch=note.pitch, start=start, end=end, velocity=note.velocity))
    return quantized
