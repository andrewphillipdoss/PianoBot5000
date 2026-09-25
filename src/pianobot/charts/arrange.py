"""Turn a Chart into the (melody_notes, chord_notes, sections) triple
that ``pianobot.assemble.assemble_midi`` expects -- converting from
beats (how a Chart stores time) to seconds (how a MIDI file stores
time) along the way, using the chart's tempo.

This is deliberately the one place a "style"/complexity knob lives:
"simple" (plain block triads via ``theory.voice_triads``) and
"comping" (the same voicings, played as a rhythmic pattern via
``theory.comp_triads`` instead of one static sustained block -- see
that function's docstring). The idea discussed for this project is to
add more styles later still -- a walking bass line, extended jazz
voicings, and so on -- all consuming the exact same Chart and producing
a different left hand without touching the chart format, the melody
side, or assemble.py at all.

This is also where humanization (small randomized timing/velocity
nudges, see ``humanize.py``) is applied, since it needs real seconds
(not beats) to work in, and needs to happen after arranging (so it
nudges the actual notes that will be played, comping hits included --
not just the original chord spans).
"""

from __future__ import annotations

from ..theory import comp_triads, voice_triads
from ..types import Chart, NoteEvent, Section
from .humanize import humanize_notes

_STYLES = {"simple": voice_triads, "comping": comp_triads}


def render_to_midi_inputs(
    chart: Chart, style: str = "simple", humanize: bool = True, seed: int = 0,
) -> tuple[list[NoteEvent], list[NoteEvent], list[Section]]:
    """Chart -> (melody_notes, chord_notes, sections), all in seconds."""
    voice_chords = _STYLES.get(style)
    if voice_chords is None:
        raise ValueError(f"unknown arrangement style {style!r} (implemented: {', '.join(_STYLES)})")

    seconds_per_beat = 60.0 / chart.tempo
    chord_notes_beats = voice_chords(chart.chords)

    melody_notes = _scale_notes(chart.melody, seconds_per_beat)
    chord_notes = _scale_notes(chord_notes_beats, seconds_per_beat)
    sections = _scale_sections(chart.sections, seconds_per_beat)

    if humanize:
        # Different seeds for each hand so their jitter isn't
        # correlated (a real two-handed player's hands don't drift
        # together) -- still fully deterministic for a given `seed`.
        melody_notes = humanize_notes(melody_notes, seed=seed)
        chord_notes = humanize_notes(chord_notes, seed=seed + 1)

    return melody_notes, chord_notes, sections


def _scale_notes(notes: list[NoteEvent], seconds_per_beat: float) -> list[NoteEvent]:
    return [
        NoteEvent(pitch=n.pitch, start=n.start * seconds_per_beat, end=n.end * seconds_per_beat, velocity=n.velocity)
        for n in notes
    ]


def _scale_sections(sections: list[Section], seconds_per_beat: float) -> list[Section]:
    return [
        Section(start=s.start * seconds_per_beat, end=s.end * seconds_per_beat,
                label=s.label, source_label=s.source_label)
        for s in sections
    ]
