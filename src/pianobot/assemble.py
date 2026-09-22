"""Assemble the final piano arrangement MIDI file (pretty_midi).

Right hand (melody) and left hand (chord voicings) are written as two
Instrument tracks, both on Acoustic Grand Piano; sections become text
meta-events so the labels show up as markers in a DAW/notation editor.
"""

from __future__ import annotations

from pathlib import Path

import pretty_midi

from .types import NoteEvent, Section

_PIANO_PROGRAM = 0  # Acoustic Grand Piano


def assemble_midi(
    melody_notes: list[NoteEvent],
    chord_notes: list[NoteEvent],
    sections: list[Section],
    tempo: float = 120.0,
) -> pretty_midi.PrettyMIDI:
    pm = pretty_midi.PrettyMIDI(initial_tempo=tempo)

    right_hand = pretty_midi.Instrument(program=_PIANO_PROGRAM, name="Melody (RH)")
    right_hand.notes.extend(_to_pm_notes(melody_notes))

    left_hand = pretty_midi.Instrument(program=_PIANO_PROGRAM, name="Chords (LH)")
    left_hand.notes.extend(_to_pm_notes(chord_notes))

    pm.instruments.extend([right_hand, left_hand])
    pm.text_events.extend(
        pretty_midi.Text(text=section.label or section.source_label, time=section.start)
        for section in sections
    )
    return pm


def write_midi(pm: pretty_midi.PrettyMIDI, out_path: Path) -> Path:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pm.write(str(out_path))
    return out_path


def _to_pm_notes(notes: list[NoteEvent]) -> list[pretty_midi.Note]:
    return [
        pretty_midi.Note(velocity=n.velocity, pitch=n.pitch, start=n.start, end=n.end)
        for n in notes
    ]
