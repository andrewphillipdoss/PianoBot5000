"""Beat/downbeat/section detection (allin1) + A/B/C repeat labeling.

Install: pip install "pianobot5000[structure]"
allin1 ("All-In-One Music Structure Analyzer") wraps its own torch
models and downloads weights on first run; like Demucs it works on
CPU but is happiest with a GPU.

Beginner note: this file answers two different questions about a
song's rhythm and form:
  1. "Where exactly are the beats?" (needed so melody.py and chords.py
     know where to snap notes/chords onto the rhythm grid)
  2. "How is the song structured?" (verse, chorus, bridge, ...), and
     specifically, "which sections repeat?" -- so we can label them
     A, B, C the way a lead sheet would, instead of using allin1's
     more technical labels directly.
"""

from __future__ import annotations

from pathlib import Path

from ..theory import label_repeats
from ..types import Beat, Section

# `label_repeats` itself moved to theory.py -- it's pure Section-in/
# Section-out logic with no audio dependency at all, and the chart-
# based path's MusicXML importer needs the exact same A/B/C-grouping
# behavior for rehearsal marks. Imported (not just called) here so
# existing callers can keep writing `structure_stage.label_repeats(...)`
# unchanged.


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

    # Hand the whole song off to allin1 and let it do its analysis.
    # `result` comes back as an object with several useful attributes,
    # including `.beats`, `.downbeats`, and `.segments`.
    result = allin1.analyze(str(audio_path))

    # allin1 gives us downbeat times as their own separate list, but we
    # want a single list of Beat objects where each one just knows
    # "am I a downbeat or not?" Rounding to 3 decimal places (i.e. to
    # the nearest millisecond) avoids floating-point comparisons like
    # "1.2300000001 == 1.23" failing due to tiny rounding differences.
    # Wrapping the rounded times in a `set` (rather than a list) makes
    # the "is this beat's time in here?" check below very fast.
    downbeat_times = set(round(t, 3) for t in result.downbeats)
    beats = [Beat(time=float(t), is_downbeat=round(float(t), 3) in downbeat_times) for t in result.beats]

    # allin1 splits the song into labeled segments (verse, chorus,
    # etc). We copy those into our own Section objects, stashing
    # allin1's label in `source_label` for now -- `label` (the
    # simplified "A"/"B"/"C" version) gets filled in by
    # `label_repeats` below, so we start it out blank.
    sections = [
        Section(start=float(seg.start), end=float(seg.end), label="", source_label=str(seg.label))
        for seg in result.segments
    ]
    return beats, sections
