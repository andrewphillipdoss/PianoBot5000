"""Transpose a Chart into a different key.

Since a Chart's chords/melody are plain pitch classes and MIDI pitches
(see types.py), transposing is just "add N semitones to every root and
every note pitch" -- no re-parsing or re-voicing needed. This is the
whole payoff of not needing a key-agnostic (Roman-numeral) internal
representation: a chart written in one key can still be practiced in
any other key on request, it just costs one cheap arithmetic pass.
"""

from __future__ import annotations

from ..theory import key_semitone_offset, transpose_chords, transpose_notes
from ..types import Chart


def transpose_chart(chart: Chart, to_key: str) -> Chart:
    """Return a new Chart with every chord/note shifted from
    ``chart.key`` to ``to_key``. Returns the chart unchanged (same
    object) if it's already in the requested key.
    """
    semitones = key_semitone_offset(chart.key, to_key)
    if semitones == 0:
        return chart
    return Chart(
        title=chart.title,
        key=to_key,
        tempo=chart.tempo,
        sections=list(chart.sections),  # sections carry no pitch info -- untouched by transposition
        chords=transpose_chords(chart.chords, semitones),
        melody=transpose_notes(chart.melody, semitones),
    )
