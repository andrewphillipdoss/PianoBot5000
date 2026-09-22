"""Chord detection (Chordino, via the Vamp plugin host) + left-hand
triad voicing.

Install (two parts -- Chordino is a Vamp plugin, not a pip package):
  1. pip install "pianobot5000[chords]"   (installs the `vamp` python host bindings)
  2. Install the NNLS Chroma Vamp plugin (which provides "Chordino") system-wide:
       https://www.vamp-plugins.org/download.html#nnls-chroma
     - Linux: drop the .so into ~/vamp or /usr/local/lib/vamp
     - macOS: drop the .dylib bundle into ~/Library/Audio/Plug-Ins/Vamp
     - Windows: drop the .dll into %ProgramFiles%\\Vamp Plugins
     Verify with: python -c "import vamp; print(vamp.list_plugins())"
     and look for "nnls-chroma:chordino" in the output.
"""

from __future__ import annotations

import re
from pathlib import Path

from .types import Beat, ChordEvent, NoteEvent

_PLUGIN_KEY = "nnls-chroma:chordino"
_OUTPUT = "simplechord"

_PITCH_CLASSES = {
    "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "Fb": 4,
    "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10,
    "Bb": 10, "B": 11, "Cb": 11,
}

# Harte quality prefixes -> triad quality bucket. Extensions (7, 9, ...)
# are ignored here since we only need a *triad* for the left hand.
_QUALITY_MAP = {
    "maj": "maj", "": "maj", "1": "maj", "5": "maj",
    "min": "min", "m": "min",
    "dim": "dim",
    "aug": "aug",
}

# Triad intervals in semitones above the root.
_TRIAD_INTERVALS = {
    "maj": (0, 4, 7),
    "min": (0, 3, 7),
    "dim": (0, 3, 6),
    "aug": (0, 4, 8),
}

_LABEL_RE = re.compile(r"^(?P<root>[A-Ga-g][#b]?)(:(?P<quality>[a-zA-Z0-9]*))?")


class ChordinoUnavailable(RuntimeError):
    pass


def extract_chords(audio_path: Path, sample_rate: int | None = None) -> list[ChordEvent]:
    """Run Chordino on a (mono, harmonic-content) audio file.

    Typically called on a bass+other mix (see pipeline.py) rather than
    the full mix, so drums/vocals don't confuse the chroma estimate.
    """
    try:
        import vamp
        import soundfile as sf
    except ImportError as exc:
        raise ChordinoUnavailable(
            "vamp is not installed. Run: pip install 'pianobot5000[chords]'"
        ) from exc

    audio, sr = sf.read(str(audio_path), always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)

    if _PLUGIN_KEY not in vamp.list_plugins():
        raise ChordinoUnavailable(
            "vamp host is installed but the Chordino plugin (nnls-chroma) "
            "was not found. See the install instructions at the top of "
            "pianobot/chords.py."
        )

    result = vamp.collect(audio, sr, _PLUGIN_KEY, output=_OUTPUT)
    events = result["list"]

    duration = len(audio) / sr
    chords: list[ChordEvent] = []
    for i, event in enumerate(events):
        start = float(event["timestamp"])
        end = float(events[i + 1]["timestamp"]) if i + 1 < len(events) else duration
        if end <= start:
            continue
        root_pc, quality = _parse_harte_label(str(event["label"]))
        if root_pc is None:
            continue
        chords.append(ChordEvent(root_pitch_class=root_pc, quality=quality, start=start, end=end))
    return chords


def _parse_harte_label(label: str) -> tuple[int | None, str]:
    label = label.strip()
    if label in ("N", "N/C", ""):
        return None, "N"
    match = _LABEL_RE.match(label)
    if not match:
        return None, "N"
    root_raw = match.group("root")
    root = root_raw[0].upper() + root_raw[1:]  # letter upper, accidental (#/b) case preserved
    quality_raw = (match.group("quality") or "").lower()
    root_pc = _PITCH_CLASSES.get(root)
    if root_pc is None:
        return None, "N"
    # Longest-prefix match against known quality buckets (e.g. "min7" -> "min").
    # Anything unmatched (7, sus4, hdim7, ...) defaults to "maj", which is a
    # reasonable simplification for a left-hand triad.
    quality = "maj"
    for prefix, bucket in sorted(_QUALITY_MAP.items(), key=lambda kv: -len(kv[0])):
        if prefix and quality_raw.startswith(prefix):
            quality = bucket
            break
    return root_pc, quality


def snap_chords_to_beats(chords: list[ChordEvent], beats: list[Beat]) -> list[ChordEvent]:
    """Snap chord boundaries onto the nearest detected beat, matching
    the diagram's "voice triads: snap to beats" box.
    """
    if not beats:
        return chords
    grid = [b.time for b in beats]
    snapped = []
    for chord in chords:
        start = min(grid, key=lambda t: abs(t - chord.start))
        end = min(grid, key=lambda t: abs(t - chord.end))
        if end <= start:
            continue
        snapped.append(ChordEvent(root_pitch_class=chord.root_pitch_class, quality=chord.quality,
                                   start=start, end=end, confidence=chord.confidence))
    return snapped


def voice_triads(chords: list[ChordEvent], base_octave: int = 3, velocity: int = 75) -> list[NoteEvent]:
    """Turn each chord into a close-position left-hand triad.

    base_octave=3 puts roots roughly in MIDI 48-59 (C3-B3), a typical
    left-hand register.
    """
    notes: list[NoteEvent] = []
    root_base = 12 * (base_octave + 1)  # MIDI note 0 = C-1
    for chord in chords:
        if chord.quality == "N":
            continue
        intervals = _TRIAD_INTERVALS.get(chord.quality, _TRIAD_INTERVALS["maj"])
        root_pitch = root_base + chord.root_pitch_class
        for interval in intervals:
            notes.append(NoteEvent(pitch=root_pitch + interval, start=chord.start, end=chord.end, velocity=velocity))
    return notes
