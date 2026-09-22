"""Assemble the final piano arrangement MIDI file (pretty_midi).

Right hand (melody) and left hand (chord voicings) are written as two
Instrument tracks, both on Acoustic Grand Piano; sections become text
meta-events so the labels show up as markers in a DAW/notation editor.

Beginner note: this is the very last step of the pipeline. Every
earlier stage has produced plain Python objects (NoteEvent, Section,
...) describing *what* should be played and *when* -- but none of that
is a real, openable file yet. This module's job is to translate those
objects into an actual .mid file using the `pretty_midi` library,
which knows how to write the MIDI file format byte-for-byte. A MIDI
file is like a player-piano roll: it doesn't contain audio, just
instructions ("play this key, this hard, starting now, until then").
"""

from __future__ import annotations

from pathlib import Path

# `pretty_midi` is a third-party library that gives us friendly Python
# objects (PrettyMIDI, Instrument, Note, Text) for building up a MIDI
# file, instead of having to write out raw MIDI bytes ourselves.
import pretty_midi

from .types import NoteEvent, Section

_PIANO_PROGRAM = 0  # MIDI "program number" 0 = Acoustic Grand Piano (General MIDI's standard instrument list)


def assemble_midi(
    melody_notes: list[NoteEvent],
    chord_notes: list[NoteEvent],
    sections: list[Section],
    tempo: float = 120.0,
) -> pretty_midi.PrettyMIDI:
    """Build an in-memory MIDI "document" from our note/section data.

    This doesn't write anything to disk yet -- see `write_midi` below
    for that. Splitting "build the document" and "save the document"
    into two functions makes each one easier to test on its own.
    """
    # Create a brand-new, empty MIDI document, and record the song's
    # tempo (beats per minute) as its starting tempo.
    pm = pretty_midi.PrettyMIDI(initial_tempo=tempo)

    # A MIDI file can contain multiple "Instrument" tracks that all
    # play at once. We use two: one for the right-hand melody, one for
    # the left-hand chords -- both set to Acoustic Grand Piano so they
    # sound like the same instrument, just played with two hands.
    right_hand = pretty_midi.Instrument(program=_PIANO_PROGRAM, name="Melody (RH)")
    # `_to_pm_notes` (below) converts our own NoteEvent objects into
    # pretty_midi's own Note objects; `.extend(...)` appends all of
    # them onto this instrument's note list in one go.
    right_hand.notes.extend(_to_pm_notes(melody_notes))

    left_hand = pretty_midi.Instrument(program=_PIANO_PROGRAM, name="Chords (LH)")
    left_hand.notes.extend(_to_pm_notes(chord_notes))

    # Add both instrument tracks to the document.
    pm.instruments.extend([right_hand, left_hand])
    # MIDI files can also carry plain text "markers" at specific times,
    # separate from any instrument -- useful for labeling song
    # sections (A, B, C, ...) so they show up as named markers when you
    # open the file in a DAW or notation program. This is a generator
    # expression (like a list comprehension, but lazily produced one
    # at a time) building one pretty_midi.Text per section.
    # `section.label or section.source_label` uses whichever one is
    # non-empty -- normally `label` (the "A"/"B"/"C" form) will always
    # be set by the time this runs, but falling back to
    # `source_label` keeps this function safe to call even with
    # sections that haven't been through `structure.label_repeats` yet.
    pm.text_events.extend(
        pretty_midi.Text(text=section.label or section.source_label, time=section.start)
        for section in sections
    )
    return pm


def write_midi(pm: pretty_midi.PrettyMIDI, out_path: Path) -> Path:
    """Save an in-memory MIDI document to an actual .mid file on disk."""
    out_path = Path(out_path)
    # Make sure the destination folder exists before trying to write
    # into it (e.g. if out_path is "songs/output/mysong.mid" but the
    # "songs/output" folder doesn't exist yet).
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # pretty_midi's own method that does the actual byte-level MIDI
    # file writing; it wants a plain string path, hence `str(out_path)`.
    pm.write(str(out_path))
    # Return the path back to the caller, so e.g. cli.py can print
    # "wrote <this path>" without having to remember it separately.
    return out_path


def _to_pm_notes(notes: list[NoteEvent]) -> list[pretty_midi.Note]:
    """Convert our NoteEvent objects into pretty_midi's own Note objects.

    We keep our own NoteEvent type everywhere else in the pipeline
    (see types.py) so that no other file needs to depend on
    pretty_midi's specific API -- this function is the one narrow spot
    where that translation happens, right before writing the file.
    """
    return [
        pretty_midi.Note(velocity=n.velocity, pitch=n.pitch, start=n.start, end=n.end)
        for n in notes
    ]
