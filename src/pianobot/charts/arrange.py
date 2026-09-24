"""Turn a Chart into the (melody_notes, chord_notes, sections) triple
that ``pianobot.assemble.assemble_midi`` expects -- converting from
beats (how a Chart stores time) to seconds (how a MIDI file stores
time) along the way, using the chart's tempo.

This is deliberately the one place a "style"/complexity knob lives:
today there's only "simple" (plain block triads via
``theory.voice_triads``, same voicing/voice-leading logic the old
audio-transcription path used), but the idea discussed for this
project is to add more arrangement styles later -- a rhythmic comping
pattern, a walking bass line, extended jazz voicings, and so on -- all
consuming the exact same Chart and producing a different left hand
without touching the chart format, the melody side, or assemble.py at
all.
"""

from __future__ import annotations

from ..theory import voice_triads
from ..types import Chart, NoteEvent, Section

_STYLES = ("simple",)


def render_to_midi_inputs(
    chart: Chart, style: str = "simple",
) -> tuple[list[NoteEvent], list[NoteEvent], list[Section]]:
    """Chart -> (melody_notes, chord_notes, sections), all in seconds."""
    if style not in _STYLES:
        raise ValueError(f"unknown arrangement style {style!r} (implemented: {', '.join(_STYLES)})")

    seconds_per_beat = 60.0 / chart.tempo
    chord_notes_beats = voice_triads(chart.chords)

    melody_notes = _scale_notes(chart.melody, seconds_per_beat)
    chord_notes = _scale_notes(chord_notes_beats, seconds_per_beat)
    sections = _scale_sections(chart.sections, seconds_per_beat)
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
