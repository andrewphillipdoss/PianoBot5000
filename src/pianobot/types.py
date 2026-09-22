"""Data contracts passed between pipeline stages.

Every stage (real model or stub) speaks these types, so stages can be
swapped independently -- e.g. Chordino <-> madmom, or a real model <->
a synthetic fixture in tests -- without touching downstream code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class NoteEvent:
    pitch: int  # MIDI note number, 0-127
    start: float  # seconds
    end: float  # seconds
    velocity: int = 90

    def __post_init__(self) -> None:
        if self.end < self.start:
            raise ValueError(f"note end {self.end} precedes start {self.start}")


@dataclass
class ChordEvent:
    root_pitch_class: int  # 0=C, 1=C#, ..., 11=B
    quality: str  # "maj", "min", "dom7", "maj7", "min7", "dim", "aug", "N" (no chord)
    start: float
    end: float
    confidence: float = 1.0


@dataclass
class Beat:
    time: float  # seconds
    is_downbeat: bool = False


@dataclass
class Section:
    start: float
    end: float
    label: str  # remapped repeat-group label, e.g. "A", "B", "C"
    source_label: str = ""  # original model label, e.g. "chorus", "verse_2"


@dataclass
class StemSet:
    """Paths to Demucs-separated stems, plus the original mix."""

    original: Path
    vocals: Path
    drums: Path
    bass: Path
    other: Path

    def harmonic_mix_sources(self) -> list[Path]:
        """Stems worth summing for chord/harmony analysis (skip drums)."""
        return [self.bass, self.other]


@dataclass
class SongAnalysis:
    """Everything extracted from the audio, ready for MIDI assembly."""

    duration: float
    beats: list[Beat] = field(default_factory=list)
    sections: list[Section] = field(default_factory=list)
    melody_notes: list[NoteEvent] = field(default_factory=list)
    chords: list[ChordEvent] = field(default_factory=list)
