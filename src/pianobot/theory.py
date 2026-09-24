"""Shared music-theory logic: chord-symbol parsing, triad voicing, and
transposition. No audio/model dependency at all -- everything here is
plain functions over plain data (pitch classes, chord qualities, MIDI
note numbers), so both the chart-based path (charts/) and the audio
transcription path (transcribe/) can share exactly the same voicing and
voice-leading behavior instead of two subtly different copies of it.

Beginner note: a "pitch class" is which of the 12 notes something is
(0=C, 1=C#, 2=D, ... 11=B), ignoring which octave it's in -- a piano
keyboard repeats the same 12 keys over and over, so "C" means the same
thing whether it's C3 or C5. A MIDI *pitch* (used elsewhere, e.g.
NoteEvent.pitch) is a specific key on a specific octave (60 = middle
C); a pitch class is just `pitch % 12`.
"""

from __future__ import annotations

import re

from .types import ChordEvent, NoteEvent

# Every note name we might need to parse (including enharmonic
# spellings -- e.g. C# and Db are the same physical note, just written
# two different ways) mapped to a pitch class 0-11.
PITCH_CLASSES = {
    "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "Fb": 4,
    "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10,
    "Bb": 10, "B": 11, "Cb": 11,
}

# The reverse mapping, used when we need to *print* a pitch class or
# MIDI pitch as a name -- always spelled with sharps, since picking the
# "musically correct" spelling (Bb vs A#) would need key-signature
# context we don't track. MIDI pitch % 12 indexes into this list.
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Triad intervals in semitones above the root -- how many semitones
# above the root the 3rd and 5th of each chord quality's triad sit.
TRIAD_INTERVALS = {
    "maj": (0, 4, 7),
    "min": (0, 3, 7),
    "dim": (0, 3, 6),
    "aug": (0, 4, 8),
}

# Harte-style quality prefixes (colon notation, e.g. "min7") -> triad bucket.
_HARTE_QUALITY_MAP = {
    "maj": "maj", "": "maj", "1": "maj", "5": "maj",
    "min": "min", "m": "min",
    "dim": "dim",
    "aug": "aug",
}

_HARTE_LABEL_RE = re.compile(r"^(?P<root>[A-Ga-g][#b]?)(:(?P<quality>[a-zA-Z0-9]*))?")

# Plain chord-symbol shorthand, e.g. "Cm7", "Ebmaj7", "F#dim", "G+" --
# the way a hand-written lead sheet actually writes chords, as opposed
# to Chordino's colon-based Harte notation ("C:min7"). We only need to
# pull out the root and bucket the quality down to a plain triad.
_SYMBOL_RE = re.compile(r"^(?P<root>[A-Ga-g][#b]?)(?P<rest>.*)$")


def parse_harte_label(label: str) -> tuple[int | None, str]:
    """Break a Harte-style label like "C#:min7" into (pitch_class, simplified_quality).

    Returns (None, "N") for "no chord" ("N", "N/C", or blank) or
    anything unparseable.
    """
    label = label.strip()
    if label in ("N", "N/C", ""):
        return None, "N"
    match = _HARTE_LABEL_RE.match(label)
    if not match:
        return None, "N"
    root_raw = match.group("root")
    # Uppercase just the note letter, leaving the accidental (#/b) case
    # exactly as written -- flipping "b" (flat) to uppercase would make
    # it look like the note B instead of a flat sign.
    root = root_raw[0].upper() + root_raw[1:]
    quality_raw = (match.group("quality") or "").lower()
    root_pc = PITCH_CLASSES.get(root)
    if root_pc is None:
        return None, "N"
    quality = "maj"
    for prefix, bucket in sorted(_HARTE_QUALITY_MAP.items(), key=lambda kv: -len(kv[0])):
        if prefix and quality_raw.startswith(prefix):
            quality = bucket
            break
    return root_pc, quality


def parse_chord_symbol(symbol: str) -> tuple[int, str]:
    """Parse a plain lead-sheet chord symbol like "Cm7", "Ebmaj7", "F#dim",
    "G+", "Bbsus4" into (root_pitch_class, simplified_triad_quality).

    Unlike ``parse_harte_label``, there's no "no chord" case here --
    every chart chord slot names an actual chord. Raises ValueError on
    a symbol that doesn't even start with a recognizable note name.
    """
    symbol = symbol.strip()
    match = _SYMBOL_RE.match(symbol)
    if not match:
        raise ValueError(f"unrecognized chord symbol: {symbol!r}")
    root_raw = match.group("root")
    root = root_raw[0].upper() + root_raw[1:]
    root_pc = PITCH_CLASSES.get(root)
    if root_pc is None:
        raise ValueError(f"unrecognized chord root: {root!r} (from {symbol!r})")

    rest = match.group("rest").lower().replace("°", "dim").replace("ø", "dim")
    # Check "maj" before the bare "m" minor check below, since
    # "maj7".startswith("m") would otherwise be misread as minor.
    if rest.startswith("dim") or rest.startswith("o"):
        quality = "dim"
    elif rest.startswith("aug") or rest.startswith("+"):
        quality = "aug"
    elif rest.startswith("maj") or rest == "" or rest[0].isdigit() or rest.startswith("sus"):
        quality = "maj"
    elif rest.startswith("m") or rest.startswith("-"):
        quality = "min"
    else:
        quality = "maj"
    return root_pc, quality


def parse_note_name(name: str) -> int:
    """Parse a note name + octave like "Eb4" or "F#3" into a MIDI pitch
    number (e.g. "C4" -> 60, matching MIDI's convention that middle C
    is C4).
    """
    name = name.strip()
    match = re.match(r"^(?P<note>[A-Ga-g][#b]?)(?P<octave>-?\d+)$", name)
    if not match:
        raise ValueError(f"unrecognized note name: {name!r} (expected e.g. 'C4', 'Eb3')")
    note = match.group("note")
    note = note[0].upper() + note[1:]
    pitch_class = PITCH_CLASSES.get(note)
    if pitch_class is None:
        raise ValueError(f"unrecognized note letter/accidental: {note!r}")
    octave = int(match.group("octave"))
    return 12 * (octave + 1) + pitch_class


def voice_triads(chords: list[ChordEvent], base_octave: int = 3, velocity: int = 75) -> list[NoteEvent]:
    """Turn each chord into a close-position triad, choosing each
    triad's *inversion* to keep consecutive chords close together in
    pitch (basic voice leading) instead of always playing root position.

    See the original chords.py docstring (git history) for the full
    explanation of close position / inversions / voice leading -- this
    is the same logic, just moved here so both the chart-based and
    audio-transcription paths can call it.
    """
    notes: list[NoteEvent] = []
    root_base = 12 * (base_octave + 1)  # MIDI note 0 = C-1
    prev_centroid: float | None = None

    for chord in chords:
        if chord.quality == "N":
            continue

        _root_offset, third_offset, fifth_offset = TRIAD_INTERVALS.get(chord.quality, TRIAD_INTERVALS["maj"])
        root_pc = chord.root_pitch_class
        third_pc = (root_pc + third_offset) % 12
        fifth_pc = (root_pc + fifth_offset) % 12

        candidates = [
            _stack_close_position((root_pc, third_pc, fifth_pc), root_base),   # root position
            _stack_close_position((third_pc, fifth_pc, root_pc), root_base),   # 1st inversion
            _stack_close_position((fifth_pc, root_pc, third_pc), root_base),   # 2nd inversion
        ]

        if prev_centroid is None:
            chosen = candidates[0]
        else:
            chosen = min(candidates, key=lambda pitches: abs(_centroid(pitches) - prev_centroid))

        prev_centroid = _centroid(chosen)
        for pitch in chosen:
            notes.append(NoteEvent(pitch=pitch, start=chord.start, end=chord.end, velocity=velocity))
    return notes


def _stack_close_position(pitch_classes: tuple[int, int, int], anchor: int) -> list[int]:
    """Turn 3 pitch classes into 3 real, ascending MIDI pitches, stacked
    as tightly as possible starting near `anchor`.
    """
    bottom = anchor - (anchor % 12) + pitch_classes[0]
    stack = [bottom]
    for pitch_class in pitch_classes[1:]:
        previous = stack[-1]
        candidate = previous + 1
        while candidate % 12 != pitch_class:
            candidate += 1
        stack.append(candidate)
    return stack


def _centroid(pitches: list[int]) -> float:
    """The average of a list of MIDI pitches."""
    return sum(pitches) / len(pitches)


def transpose_chords(chords: list[ChordEvent], semitones: int) -> list[ChordEvent]:
    """Shift every chord's root by `semitones` (can be negative), wrapping
    around the 12 pitch classes. "N" (no-chord) entries pass through unchanged.
    """
    return [
        ChordEvent(
            root_pitch_class=(c.root_pitch_class + semitones) % 12 if c.quality != "N" else c.root_pitch_class,
            quality=c.quality, start=c.start, end=c.end, confidence=c.confidence,
        )
        for c in chords
    ]


def transpose_notes(notes: list[NoteEvent], semitones: int) -> list[NoteEvent]:
    """Shift every note's MIDI pitch by `semitones` (can be negative)."""
    return [
        NoteEvent(pitch=n.pitch + semitones, start=n.start, end=n.end, velocity=n.velocity)
        for n in notes
    ]


def key_semitone_offset(from_key: str, to_key: str) -> int:
    """How many semitones (in [-11, 11], shortest direction) to add to
    something in `from_key` to land it in `to_key` -- e.g.
    key_semitone_offset("C", "D") == 2.
    """
    from_pc = PITCH_CLASSES.get(from_key)
    to_pc = PITCH_CLASSES.get(to_key)
    if from_pc is None:
        raise ValueError(f"unrecognized key: {from_key!r}")
    if to_pc is None:
        raise ValueError(f"unrecognized key: {to_key!r}")
    offset = (to_pc - from_pc) % 12
    # Prefer the shorter direction when there's a tie/choice, e.g. +6 vs -6;
    # %12 already gives us 0-11, so anything above 6 is shorter as a negative shift.
    if offset > 6:
        offset -= 12
    return offset
