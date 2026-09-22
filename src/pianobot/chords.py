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

Beginner note: "Vamp" is a plugin standard for audio-analysis tools
(think of it like how a photo editor can load third-party filter
plugins). Chordino is one such plugin that listens to audio and
guesses which chord is playing at each moment, labeling it in "Harte
notation" -- a text shorthand like "C:maj" (C major) or "A:min7"
(A minor 7th). This file calls Chordino, decodes those text labels
into our own ChordEvent objects, and then turns each chord into an
actual "triad" (a 3-note chord: root, third, and fifth) that a piano's
left hand could play.
"""

from __future__ import annotations

# `re` is Python's regular-expression module, for pattern-matching
# text. We use it once below, to pull the "root note" and "quality"
# apart from a Chordino label like "C#:min7".
import re
from pathlib import Path

from .types import Beat, ChordEvent, NoteEvent

_PLUGIN_KEY = "nnls-chroma:chordino"  # Chordino's identifier within the Vamp plugin system: "<plugin library>:<specific plugin>"
_OUTPUT = "simplechord"  # Chordino can produce several kinds of output; this one is its simple chord-label track

# Maps every note name Chordino might use (including enharmonic
# spellings -- e.g. C# and Db are the same physical note, just written
# two different ways) to a "pitch class" number from 0-11. This mirrors
# how a piano keyboard repeats every 12 keys/semitones: it doesn't
# matter which octave a C is in, it's still "pitch class 0."
_PITCH_CLASSES = {
    "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "Fb": 4,
    "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10,
    "Bb": 10, "B": 11, "Cb": 11,
}

# Harte quality prefixes -> triad quality bucket. Extensions (7, 9, ...)
# are ignored here since we only need a *triad* for the left hand.
#
# Chordino can report much more detailed chord qualities than we need
# (7ths, 9ths, suspensions, ...). Since our left hand is only ever
# going to play a plain 3-note triad, we simplify every possible label
# down to one of four buckets: "maj", "min", "dim", "aug".
_QUALITY_MAP = {
    "maj": "maj", "": "maj", "1": "maj", "5": "maj",
    "min": "min", "m": "min",
    "dim": "dim",
    "aug": "aug",
}

# Triad intervals in semitones above the root.
#
# A "semitone" is the smallest step on a piano (one key to the very
# next key, black or white). These tuples describe, for each chord
# quality, how many semitones above the root the 3rd and 5th notes of
# the triad sit. E.g. a C major triad (root=C) is C, E, G -- which are
# 0, 4, and 7 semitones above C.
_TRIAD_INTERVALS = {
    "maj": (0, 4, 7),
    "min": (0, 3, 7),
    "dim": (0, 3, 6),
    "aug": (0, 4, 8),
}

# A compiled regular expression that matches a Harte-style chord label
# and splits it into two named groups we can read out afterwards:
#   "root"    -- one note letter A-G (upper or lowercase), optionally
#                followed by a single # or b for sharp/flat
#   "quality" -- everything after an optional ":", e.g. "min7"
# `^` anchors the match to the very start of the string.
_LABEL_RE = re.compile(r"^(?P<root>[A-Ga-g][#b]?)(:(?P<quality>[a-zA-Z0-9]*))?")


class ChordinoUnavailable(RuntimeError):
    pass


def extract_chords(audio_path: Path, sample_rate: int | None = None) -> list[ChordEvent]:
    """Run Chordino on a (mono, harmonic-content) audio file.

    Typically called on a bass+other mix (see pipeline.py) rather than
    the full mix, so drums/vocals don't confuse the chroma estimate.

    ("Chroma" refers to the "pitch class" idea mentioned above --
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
    # wave) plus its sample rate (how many numbers-per-second it was
    # recorded at, e.g. 44100). `always_2d=False` means: if the file is
    # mono, give us a plain 1-D array instead of a 1-column 2-D one.
    audio, sr = sf.read(str(audio_path), always_2d=False)
    # `audio.ndim` is the number of dimensions/axes the array has. A
    # stereo file reads in as 2-D (samples x channels); we average the
    # channels together to get a single mono signal, since Chordino
    # expects one channel.
    if audio.ndim > 1:
        audio = audio.mean(axis=1)

    # `vamp.list_plugins()` returns every Vamp plugin the vamp host can
    # currently find installed on the system. If Chordino isn't in that
    # list, the system-level plugin install step (see the module
    # docstring above) hasn't been done yet.
    if _PLUGIN_KEY not in vamp.list_plugins():
        raise ChordinoUnavailable(
            "vamp host is installed but the Chordino plugin (nnls-chroma) "
            "was not found. See the install instructions at the top of "
            "pianobot/chords.py."
        )

    # Actually run the plugin: hand it our audio + sample rate, and ask
    # specifically for its "simplechord" output track.
    result = vamp.collect(audio, sr, _PLUGIN_KEY, output=_OUTPUT)
    # `result` is a dictionary; for this kind of labeled-event output,
    # Vamp puts the actual list of chord events under the "list" key.
    events = result["list"]

    # Total length of the audio in seconds (sample count / samples-per-second),
    # used below as the end time of the very last chord.
    duration = len(audio) / sr
    chords: list[ChordEvent] = []
    # `enumerate(events)` gives us both the index `i` (0, 1, 2, ...)
    # and each `event` as we loop, so we can peek at the *next* event
    # to figure out where the current one ends.
    for i, event in enumerate(events):
        start = float(event["timestamp"])
        # Chordino only tells us when each chord *starts*, not when it
        # ends -- so a chord's end time is simply the next chord's
        # start time. For the very last chord, there is no "next
        # event," so we use the audio's total duration instead.
        end = float(events[i + 1]["timestamp"]) if i + 1 < len(events) else duration
        if end <= start:
            # Skip any zero-or-negative-length chord segment (can
            # happen with back-to-back timestamps); nothing useful to
            # keep here.
            continue
        root_pc, quality = _parse_harte_label(str(event["label"]))
        if root_pc is None:
            # `_parse_harte_label` returns None for the root when the
            # label was "no chord" (silence/unclear) or unparseable --
            # either way, there's no chord to add here.
            continue
        chords.append(ChordEvent(root_pitch_class=root_pc, quality=quality, start=start, end=end))
    return chords


def _parse_harte_label(label: str) -> tuple[int | None, str]:
    """Break a Harte-style label like "C#:min7" into (pitch_class, simplified_quality)."""
    label = label.strip()  # remove any stray leading/trailing whitespace
    # "N" (and sometimes "N/C") is Harte notation for "no chord" --
    # e.g. a drum fill or silence with no clear harmony. We also treat
    # a blank label the same way, just in case.
    if label in ("N", "N/C", ""):
        return None, "N"
    match = _LABEL_RE.match(label)
    if not match:
        # The label didn't match our expected pattern at all (an
        # unexpected format) -- treat it as "no chord" rather than
        # crashing.
        return None, "N"
    # `match.group("root")` pulls out whatever text matched the "root"
    # named group in our regex, e.g. "C#" or "Bb".
    root_raw = match.group("root")
    # Uppercase just the note letter (first character) so "c#" and "C#"
    # both normalize the same way, but leave the accidental (# or b)
    # exactly as written -- flipping "b" (flat) to uppercase "B" would
    # make it look like the *note* B instead of a flat sign!
    root = root_raw[0].upper() + root_raw[1:]  # letter upper, accidental (#/b) case preserved
    quality_raw = (match.group("quality") or "").lower()
    root_pc = _PITCH_CLASSES.get(root)
    if root_pc is None:
        # Shouldn't normally happen given the regex, but guards
        # against an unrecognized root spelling just in case.
        return None, "N"
    # Longest-prefix match against known quality buckets (e.g. "min7" -> "min").
    # Anything unmatched (7, sus4, hdim7, ...) defaults to "maj", which is a
    # reasonable simplification for a left-hand triad.
    quality = "maj"  # default assumption if nothing more specific matches below
    # `sorted(..., key=lambda kv: -len(kv[0]))` sorts the (prefix, bucket)
    # pairs so the *longest* prefix strings come first. This matters
    # because e.g. "min7" starts with both "m" and "min" -- checking
    # the longer, more specific "min" first (before the shorter "m")
    # gives a more accurate match.
    for prefix, bucket in sorted(_QUALITY_MAP.items(), key=lambda kv: -len(kv[0])):
        # Skip the empty-string prefix entirely (it would match
        # everything via .startswith("")), and otherwise check if the
        # quality text begins with this prefix.
        if prefix and quality_raw.startswith(prefix):
            quality = bucket
            break  # stop at the first (longest) match
    return root_pc, quality


def snap_chords_to_beats(chords: list[ChordEvent], beats: list[Beat]) -> list[ChordEvent]:
    """Snap chord boundaries onto the nearest detected beat, matching
    the diagram's "voice triads: snap to beats" box.
    """
    if not beats:
        # No beat grid to snap onto -- just return the chords
        # unchanged rather than crashing.
        return chords
    grid = [b.time for b in beats]
    snapped = []
    for chord in chords:
        # For each chord's start/end time, find whichever beat time is
        # closest -- same idea as melody.py's `_snap` helper, just
        # written out inline here instead of shared, since this file's
        # grid is always plain beat times (no half-beat subdivisions).
        start = min(grid, key=lambda t: abs(t - chord.start))
        end = min(grid, key=lambda t: abs(t - chord.end))
        if end <= start:
            # Snapping both ends onto the same (or an out-of-order)
            # beat would leave a zero-or-negative-length chord --
            # drop it.
            continue
        snapped.append(ChordEvent(root_pitch_class=chord.root_pitch_class, quality=chord.quality,
                                   start=start, end=end, confidence=chord.confidence))
    return snapped


def voice_triads(chords: list[ChordEvent], base_octave: int = 3, velocity: int = 75) -> list[NoteEvent]:
    """Turn each chord into a close-position left-hand triad, choosing
    each triad's *inversion* to keep consecutive chords close together
    in pitch (basic voice leading) instead of always playing root
    position.

    base_octave=3 anchors new phrases/first chords roughly in MIDI
    48-59 (C3-B3), a typical left-hand register; later chords can drift
    a little above or below that as voice leading calls for it.

    ("Close position" means a triad's three notes are stacked as
    tightly as possible -- e.g. C-E-G, not C...E...G spread across
    octaves. "Inversion" is *which* of the triad's three notes is on
    the bottom: root position has the root on the bottom (C-E-G), 1st
    inversion has the third on the bottom (E-G-C), 2nd inversion has
    the fifth on the bottom (G-C-E) -- all three are "a C major triad,"
    just arranged differently. "Voice leading" is choosing, of those
    three equally-valid options, whichever one requires the smallest
    hand movement from the chord that came just before it.)
    """
    notes: list[NoteEvent] = []
    # MIDI note 0 is C in octave "-1" by convention, so MIDI note
    # 12 * (octave + 1) gives the C at the start of any given octave.
    # E.g. base_octave=3 -> 12 * 4 = 48, which is indeed C3 in MIDI numbering.
    root_base = 12 * (base_octave + 1)  # MIDI note 0 = C-1

    # Tracks the *average* pitch (in MIDI note numbers) of whichever
    # voicing we chose for the previous chord, so each new chord can
    # ask "which of my 3 possible inversions lands closest to that?"
    # None means "no previous chord yet" -- see below.
    prev_centroid: float | None = None

    for chord in chords:
        if chord.quality == "N":
            # "No chord" isn't an actual chord to voice -- skip it so
            # we don't add silent/nonsensical notes. We deliberately
            # leave prev_centroid untouched here, so voice leading
            # still looks across a brief silent gap to the last real
            # chord, instead of forgetting where the hand was.
            continue

        # Look up which semitone offsets make up this chord's triad;
        # fall back to a major triad's shape if we somehow got a
        # quality string we don't recognize (shouldn't normally happen,
        # since _parse_harte_label always returns one of our four
        # buckets, but this keeps the function safe either way).
        _root_offset, third_offset, fifth_offset = _TRIAD_INTERVALS.get(chord.quality, _TRIAD_INTERVALS["maj"])
        root_pc = chord.root_pitch_class
        third_pc = (root_pc + third_offset) % 12
        fifth_pc = (root_pc + fifth_offset) % 12

        # Build all three inversions as candidate voicings. Each is a
        # (bottom, middle, top) ordering of the same three pitch
        # classes; `_stack_close_position` turns that ordering into
        # actual ascending MIDI pitches, anchored near `root_base`.
        candidates = [
            _stack_close_position((root_pc, third_pc, fifth_pc), root_base),   # root position
            _stack_close_position((third_pc, fifth_pc, root_pc), root_base),   # 1st inversion
            _stack_close_position((fifth_pc, root_pc, third_pc), root_base),   # 2nd inversion
        ]

        if prev_centroid is None:
            # First chord of the sequence (or first after the very
            # start): there's nothing to lead smoothly *from* yet, so
            # there's no meaningful "closest" choice -- root position
            # is the unremarkable, obvious default.
            chosen = candidates[0]
        else:
            # Every other chord: pick whichever of the 3 inversions'
            # average pitch sits nearest to the previous chord's
            # average pitch. This is a deliberately simple
            # approximation of "real" voice leading (which would
            # compare each candidate's notes one-by-one against the
            # previous chord's notes) -- comparing just the averages
            # is much less code and is usually good enough. A fuller
            # version would compare each candidate's notes one-by-one
            # against the previous chord's notes instead of just their
            # averages -- worth it only if this ever turns out to pick
            # an audibly bad voicing in practice.
            chosen = min(candidates, key=lambda pitches: abs(_centroid(pitches) - prev_centroid))

        prev_centroid = _centroid(chosen)
        for pitch in chosen:
            notes.append(NoteEvent(pitch=pitch, start=chord.start, end=chord.end, velocity=velocity))
    return notes


def _stack_close_position(pitch_classes: tuple[int, int, int], anchor: int) -> list[int]:
    """Turn 3 pitch classes (0-11 each) into 3 real, ascending MIDI
    pitches -- e.g. pitch classes (4, 7, 0) [E, G, C] anchored near
    MIDI 48 becomes [52, 55, 60] (E3, G3, C4): the smallest possible
    upward stack starting from an E near that anchor.

    `anchor` only has to be *near* the first pitch class's target
    octave -- the first note is placed at whichever MIDI pitch nearest
    `anchor` has that pitch class, and each following note is placed
    at the nearest higher pitch (at most 11 semitones above the one
    before it) that matches the next required pitch class. The result
    is always a tight, "close position" stack, never spread out.
    """
    # Move `anchor` down (or up) onto the exact pitch class we need for
    # the bottom note, without changing which octave it's roughly in.
    bottom = anchor - (anchor % 12) + pitch_classes[0]
    stack = [bottom]
    for pitch_class in pitch_classes[1:]:
        previous = stack[-1]
        # Walk upward one semitone at a time from the last note we
        # placed until we land on a pitch matching the next pitch
        # class -- this always takes at most 11 steps, since pitch
        # classes repeat every 12 semitones.
        candidate = previous + 1
        while candidate % 12 != pitch_class:
            candidate += 1
        stack.append(candidate)
    return stack


def _centroid(pitches: list[int]) -> float:
    """The average of a list of MIDI pitches -- a cheap stand-in for
    "roughly where in pitch-space this voicing sits," used to compare
    candidate voicings against each other in `voice_triads`.
    """
    return sum(pitches) / len(pitches)
