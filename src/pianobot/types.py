"""Data contracts passed between pipeline stages.

Every stage (real model or stub) speaks these types, so stages can be
swapped independently -- e.g. Chordino <-> madmom, or a real model <->
a synthetic fixture in tests -- without touching downstream code.

Beginner note: a "data contract" here just means "a plain container
that holds a few related values, with a name for each one." Instead of
passing around loose tuples like (60, 0.0, 0.5, 90) and having to
remember "wait, is the pitch first or the start time?", we pass around
a NoteEvent(pitch=60, start=0.0, end=0.5, velocity=90) and can just
read the field names. Every stage of the pipeline agrees to use these
same shapes, which is what makes it possible to swap one stage's
implementation (say, Chordino for madmom) without having to change any
other file -- as long as the new code still hands back a list of
ChordEvent objects, nothing downstream needs to know or care how it
was made.
"""

# This import lets us write type hints like `list[Beat]` (using the
# lowercase, no-import-needed style) even though this file targets a
# Python version where that syntax wasn't the default yet. It has no
# effect on how the code actually runs.
from __future__ import annotations

# `dataclass` is a decorator (a function that wraps another piece of
# code to add behavior) that auto-generates the boring boilerplate for
# a "just data" class: the __init__ that sets each field, a readable
# __repr__ for printing, and __eq__ for comparing two instances field
# by field. `field` lets us customize one field's default value below.
from dataclasses import dataclass, field
# `Path` represents a filesystem path (e.g. "/home/user/song.wav") as
# an object with useful methods, instead of a plain string.
from pathlib import Path


# The @dataclass decorator turns this into a regular Python class with
# an automatically-generated constructor: NoteEvent(pitch=60, start=0.0, end=0.5)
@dataclass
class NoteEvent:
    """One played note: which key, when it starts, when it stops, how hard it's hit."""

    pitch: int  # MIDI note number, 0-127 (60 = middle C, each +1 is one semitone up)
    start: float  # when the note begins, in seconds from the start of the song
    end: float  # when the note ends, in seconds from the start of the song
    velocity: int = 90  # how "loud"/hard the note is struck, 0-127 (MIDI convention); defaults to a medium-loud 90

    # Dataclasses call __post_init__ automatically right after the
    # auto-generated __init__ finishes setting self.pitch/start/end/velocity.
    # We use it here to sanity-check the values and fail loudly (raise an
    # error) instead of silently creating a nonsensical note.
    def __post_init__(self) -> None:
        if self.end < self.start:
            # f-strings (the f"..." syntax) let us drop variable values
            # straight into a string, e.g. f"{self.end}" becomes "1.5".
            raise ValueError(f"note end {self.end} precedes start {self.start}")


@dataclass
class ChordEvent:
    """One chord being played for a stretch of time, e.g. 'C major from 4.0s to 6.0s'."""

    root_pitch_class: int  # which of the 12 notes is the chord's root: 0=C, 1=C#, 2=D, ..., 11=B (octave doesn't matter here)
    quality: str  # the chord's "flavor": "maj", "min", "dom7", "maj7", "min7", "dim", "aug", or "N" (no chord playing)
    start: float  # when this chord starts, in seconds
    end: float  # when this chord ends, in seconds
    confidence: float = 1.0  # how sure the chord-detection model is about this guess, from 0.0 (unsure) to 1.0 (certain); defaults to fully certain


@dataclass
class Beat:
    """One detected beat (a metronome click) in the song."""

    time: float  # when the beat lands, in seconds
    is_downbeat: bool = False  # True if this beat is beat "1" of a measure/bar (the strongest, most obvious beat); defaults to False


@dataclass
class Section:
    """A chunk of the song that plays one time, e.g. 'the second chorus, from 45s to 60s'."""

    start: float  # when this section starts, in seconds
    end: float  # when this section ends, in seconds
    label: str  # our simplified letter label for this section, e.g. "A", "B", "C" -- repeated sections (like two choruses) share the same letter
    source_label: str = ""  # the original, more descriptive label the structure-detection model gave it, e.g. "chorus" or "verse_2"; defaults to empty until we've run structure detection


@dataclass
class StemSet:
    """Paths to Demucs-separated stems, plus the original mix.

    "Stems" is music-production jargon for the separate instrument/voice
    tracks that were mixed together to make the final song. Demucs is a
    model that takes one mixed-down audio file and guesses what each of
    those tracks sounded like on its own.
    """

    original: Path  # the untouched input audio file the user gave us
    vocals: Path  # Demucs's best guess at just the singing/vocals, isolated
    drums: Path  # Demucs's best guess at just the drums, isolated
    bass: Path  # Demucs's best guess at just the bass line, isolated
    other: Path  # everything else Demucs could separate out (guitars, synths, piano, etc.)

    def harmonic_mix_sources(self) -> list[Path]:
        """Stems worth summing for chord/harmony analysis (skip drums).

        "Harmonic content" means the parts of the song that carry
        musical pitch/chords -- bass and "other" -- as opposed to drums,
        which are mostly noise-like percussion with no clear pitch and
        would just confuse a chord-detection model. We deliberately
        leave vocals out too, since a melody line isn't a chord.
        """
        # Returns a plain Python list containing the two Path objects
        # for the bass and "other" stems, in that order.
        return [self.bass, self.other]


@dataclass
class SongAnalysis:
    """Everything extracted from the audio, ready for MIDI assembly.

    This is the "final report card" for a song: once every pipeline
    stage has run, we bundle up all of its findings into one object so
    it's easy to save, inspect, or hand off to the MIDI-writing step.
    """

    duration: float  # total length of the song, in seconds
    # `field(default_factory=list)` means "if nobody provides a value,
    # default to a brand-new empty list []". We can't just write
    # `= []` here the way you might in a normal function, because a
    # single shared list would then get reused (and accidentally
    # shared) across every SongAnalysis instance -- default_factory
    # tells the dataclass to call list() fresh for each new instance.
    beats: list[Beat] = field(default_factory=list)  # every detected beat in the song, in time order
    sections: list[Section] = field(default_factory=list)  # every detected song section (verse, chorus, ...), in time order
    melody_notes: list[NoteEvent] = field(default_factory=list)  # the cleaned-up, single-note-at-a-time melody line
    chords: list[ChordEvent] = field(default_factory=list)  # every detected chord, snapped to the beat grid
