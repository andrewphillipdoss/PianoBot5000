"""Chord detection via Chordino (the Vamp plugin host).

Install (two parts -- Chordino is a Vamp plugin, not a pip package):
  1. pip install "pianobot5000[chords]"   (installs the `vamp` python host bindings)
  2. Install the NNLS Chroma Vamp plugin (which provides "Chordino") system-wide:
       https://www.vamp-plugins.org/download.html#nnls-chroma
     - Linux: drop the .so into ~/vamp or /usr/local/lib/vamp
     - macOS: drop the .dylib bundle into ~/Library/Audio/Plug-Ins/Vamp
     - Windows: drop the .dll into %ProgramFiles%\\Vamp Plugins
     Verify with: python -c "import vamp; print(vamp.list_plugins())"
     and look for "nnls-chroma:chordino" in the output.

Beginner note: "Vamp" is a plugin standard for audio-analysis tools
(think of it like how a photo editor can load third-party filter
plugins). Chordino is one such plugin that listens to audio and
guesses which chord is playing at each moment, labeling it in "Harte
notation" -- a text shorthand like "C:maj" (C major) or "A:min7"
(A minor 7th). This file calls Chordino and decodes those text labels
into our own ChordEvent objects (see ``pianobot.theory.parse_harte_label``);
turning a chord into an actual playable triad is shared logic that
lives in ``pianobot.theory.voice_triads`` now, since the chart-based
path needs the exact same voicing/voice-leading behavior.
"""

from __future__ import annotations

from pathlib import Path

from ..theory import parse_harte_label
from ..types import Beat, ChordEvent

_PLUGIN_KEY = "nnls-chroma:chordino"  # Chordino's identifier within the Vamp plugin system: "<plugin library>:<specific plugin>"
_OUTPUT = "simplechord"  # Chordino can produce several kinds of output; this one is its simple chord-label track


class ChordinoUnavailable(RuntimeError):
    pass


def extract_chords(audio_path: Path, sample_rate: int | None = None) -> list[ChordEvent]:
    """Run Chordino on a (mono, harmonic-content) audio file.

    Typically called on a bass+other mix (see pipeline.py) rather than
    the full mix, so drums/vocals don't confuse the chroma estimate.

    ("Chroma" refers to the "pitch class" idea mentioned in theory.py --
    Chordino's underlying algorithm works by measuring how much energy
    is present at each of the 12 pitch classes over time, then pattern-
    matching that against known chord shapes.)
    """
    try:
        import vamp  # the Python bindings that let us call Vamp plugins (like Chordino) from Python
        import soundfile as sf  # a library for reading/writing audio files
    except ImportError as exc:
        raise ChordinoUnavailable(
            "vamp is not installed. Run: pip install 'pianobot5000[chords]'"
        ) from exc

    # Read the audio file into a NumPy array of numbers (the raw sound
    # wave) plus its sample rate. `always_2d=False` means: if the file
    # is mono, give us a plain 1-D array instead of a 1-column 2-D one.
    audio, sr = sf.read(str(audio_path), always_2d=False)
    if audio.ndim > 1:
        # Stereo reads in as 2-D (samples x channels); average the
        # channels together since Chordino expects one channel.
        audio = audio.mean(axis=1)

    if _PLUGIN_KEY not in vamp.list_plugins():
        raise ChordinoUnavailable(
            "vamp host is installed but the Chordino plugin (nnls-chroma) "
            "was not found. See the install instructions at the top of "
            "pianobot/transcribe/chords.py."
        )

    result = vamp.collect(audio, sr, _PLUGIN_KEY, output=_OUTPUT)
    events = result["list"]

    duration = len(audio) / sr
    chords: list[ChordEvent] = []
    for i, event in enumerate(events):
        start = float(event["timestamp"])
        # Chordino only tells us when each chord *starts*, not when it
        # ends -- so a chord's end time is simply the next chord's
        # start time. For the very last chord, there is no "next
        # event," so we use the audio's total duration instead.
        end = float(events[i + 1]["timestamp"]) if i + 1 < len(events) else duration
        if end <= start:
            continue
        root_pc, quality = parse_harte_label(str(event["label"]))
        if root_pc is None:
            continue
        chords.append(ChordEvent(root_pitch_class=root_pc, quality=quality, start=start, end=end))
    return chords


def snap_chords_to_beats(chords: list[ChordEvent], beats: list[Beat]) -> list[ChordEvent]:
    """Snap chord boundaries onto the nearest detected beat."""
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
