"""Beat/downbeat/section detection (allin1) + A/B/C repeat labeling.

Install: pip install "pianobot5000[structure]"
allin1 ("All-In-One Music Structure Analyzer") wraps its own torch
models and downloads weights on first run; like Demucs it works on
CPU but is happiest with a GPU.
"""

from __future__ import annotations

import string
from pathlib import Path

from .types import Beat, Section


class Allin1Unavailable(RuntimeError):
    pass


def analyze_structure(audio_path: Path) -> tuple[list[Beat], list[Section]]:
    """Run allin1 and return (beats, sections). Sections carry allin1's
    own semantic label (verse/chorus/...) in ``source_label``; call
    ``label_repeats`` to get the diagram's A/B/C grouping.
    """
    try:
        import allin1
    except ImportError as exc:
        raise Allin1Unavailable(
            "allin1 is not installed. Run: pip install 'pianobot5000[structure]'"
        ) from exc

    result = allin1.analyze(str(audio_path))

    downbeat_times = set(round(t, 3) for t in result.downbeats)
    beats = [Beat(time=float(t), is_downbeat=round(float(t), 3) in downbeat_times) for t in result.beats]

    sections = [
        Section(start=float(seg.start), end=float(seg.end), label="", source_label=str(seg.label))
        for seg in result.segments
    ]
    return beats, sections


def label_repeats(sections: list[Section]) -> list[Section]:
    """Assign A/B/C/... letters to sections, reusing a letter whenever
    a section's source label (e.g. "chorus") repeats -- the diagram's
    "Label A/B/C: group repeats" box.
    """
    letters = iter(string.ascii_uppercase)
    assigned: dict[str, str] = {}
    labeled: list[Section] = []
    for section in sections:
        key = section.source_label or "?"
        if key not in assigned:
            assigned[key] = next(letters, key)
        labeled.append(Section(start=section.start, end=section.end, label=assigned[key], source_label=key))
    return labeled
