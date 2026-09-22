"""End-to-end smoke test for the non-ML stages (cleanup, voicing,
labeling, MIDI assembly) using hand-built fixtures -- no Demucs /
Basic Pitch / Chordino / allin1 required, so this runs anywhere.

Beginner note: a "smoke test" is a quick check that the basic wiring
works, named after the old electronics habit of powering on a new
device and checking whether smoke comes out -- if it does, something's
badly wrong; if not, it's at least safe to test further. Here, instead
of running real (slow, heavyweight) AI models, we hand-build small,
fake NoteEvent/ChordEvent/Section objects ourselves ("fixtures") and
feed them straight into our own cleanup/voicing/labeling/assembly
code, to make sure that code behaves correctly regardless of where its
input actually came from.

Every function starting with `test_` is automatically discovered and
run by pytest (the testing tool we use) when you type `pytest` in a
terminal -- you never call these functions yourself.
"""

from __future__ import annotations

from pathlib import Path

import pretty_midi
# pytest is our test-running framework; `pytest.approx(...)` (used
# below) lets us compare floating-point numbers for "close enough"
# equality instead of requiring an exact match, which floats rarely give.
import pytest

from pianobot import assemble, chords, melody, structure
from pianobot.types import Beat, ChordEvent, NoteEvent, Section


def _beats(n: int, beat_dur: float = 0.5) -> list[Beat]:
    """Helper: build `n` evenly-spaced fake beats, one every `beat_dur` seconds.

    Marks every 4th beat as a downbeat, mimicking a steady 4/4 time
    signature (four beats per measure). This isn't a `test_...`
    function, so pytest won't try to run it directly -- it's just a
    convenience the tests below call to avoid repeating themselves.
    """
    return [Beat(time=i * beat_dur, is_downbeat=(i % 4 == 0)) for i in range(n)]


def test_clean_melody_collapses_overlaps_and_quantizes():
    """Feed melody.clean_melody() some deliberately messy, overlapping
    notes and check it produces a single, beat-aligned melody line."""
    beats = _beats(5)
    raw_notes = [
        NoteEvent(pitch=60, start=0.02, end=0.48, velocity=90),
        NoteEvent(pitch=64, start=0.20, end=0.46, velocity=40),  # quieter, overlapping -> dropped/trimmed
        NoteEvent(pitch=62, start=0.51, end=0.97, velocity=80),
    ]
    # Pass subdivisions_per_beat explicitly (rather than relying on
    # clean_melody's default) so this test keeps checking the
    # *mechanism* regardless of whatever the library's default happens
    # to be set to.
    cleaned = melody.clean_melody(raw_notes, beats, subdivisions_per_beat=2)

    # Every remaining note should still have positive duration (no
    # zero-or-negative-length leftovers from the trimming logic).
    assert all(n.end > n.start for n in cleaned)
    # monophonic: no two notes overlap in time.
    # `zip(cleaned, cleaned[1:])` walks through consecutive pairs of
    # notes (note 0 & note 1, note 1 & note 2, ...) so we can check
    # each note ends at or before the next one starts. The tiny
    # `+ 1e-9` tolerance avoids a test failure from harmless
    # floating-point rounding dust.
    for a, b in zip(cleaned, cleaned[1:]):
        assert a.end <= b.start + 1e-9
    # quantized onto the same beat subdivision grid we asked for above.
    # We rebuild that grid (by calling clean_melody's private
    # `_beat_grid` helper directly) so we can confirm every note's
    # start/end lines up exactly with one of those grid points.
    grid = melody._beat_grid(beats, subdivisions_per_beat=2)
    for n in cleaned:
        # `any(... for g in grid)` is True if the note's start/end is
        # extremely close to *any* grid point.
        assert any(abs(n.start - g) < 1e-9 for g in grid)
        assert any(abs(n.end - g) < 1e-9 for g in grid)


def test_chord_snapping_and_voicing():
    """Check that chords.snap_chords_to_beats + voice_triads behave as expected."""
    beats = _beats(9)
    raw_chords = [
        ChordEvent(root_pitch_class=0, quality="maj", start=0.03, end=1.97),  # C major, ~beats 0-4
        ChordEvent(root_pitch_class=9, quality="min", start=2.01, end=4.0),   # A minor, ~beats 4-8
    ]
    snapped = chords.snap_chords_to_beats(raw_chords, beats)
    # The first chord started at 0.03s, very close to beat 0 (at 0.0s)
    # -- confirm snapping pulled it exactly onto that beat.
    # `pytest.approx(0.0)` allows for tiny floating-point differences.
    assert snapped[0].start == pytest.approx(0.0)
    assert snapped[1].root_pitch_class == 9

    triads = chords.voice_triads(snapped)
    # each chord contributes exactly 3 notes (root, third, fifth).
    assert len(triads) == 3 * len(snapped)
    # Pull out just the notes belonging to the first (C major) chord
    # -- i.e. the ones starting at time 0.0 -- and check they're
    # exactly C3, E3, G3 (MIDI 48, 52, 55): the correct C major triad
    # in the octave voice_triads defaults to.
    c_major_pitches = sorted(n.pitch for n in triads if n.start == 0.0)
    assert c_major_pitches == [48, 52, 55]  # C3, E3, G3


def test_label_repeats_reuses_letters_for_repeated_sections():
    """Two "verse" sections should both get the same letter, and
    likewise for two "chorus" sections -- that's the whole point of
    structure.label_repeats."""
    sections = [
        Section(start=0, end=10, label="", source_label="verse"),
        Section(start=10, end=20, label="", source_label="chorus"),
        Section(start=20, end=30, label="", source_label="verse"),
        Section(start=30, end=40, label="", source_label="chorus"),
    ]
    labeled = structure.label_repeats(sections)
    # Expect: verse->A, chorus->B, verse (repeat)->A again, chorus (repeat)->B again.
    assert [s.label for s in labeled] == ["A", "B", "A", "B"]


def test_assemble_and_write_midi_roundtrips(tmp_path: Path):
    """Build a tiny MIDI file, save it, then read it back with
    pretty_midi and check everything we put in is still there.

    `tmp_path` is a pytest built-in fixture: pytest automatically
    creates a brand-new, empty temporary folder for each test that
    asks for it (just by naming `tmp_path` as a parameter, no import
    needed), and cleans it up afterwards -- so tests never leave stray
    files lying around or interfere with each other.
    """
    melody_notes = [NoteEvent(pitch=60 + i, start=i * 0.5, end=i * 0.5 + 0.45, velocity=90) for i in range(4)]
    chord_notes = [
        NoteEvent(pitch=p, start=0.0, end=2.0, velocity=70) for p in (48, 52, 55)
    ]
    sections = [Section(start=0.0, end=2.0, label="A", source_label="verse")]

    pm = assemble.assemble_midi(melody_notes, chord_notes, sections, tempo=100.0)
    out_path = assemble.write_midi(pm, tmp_path / "out.mid")

    assert out_path.exists()
    # Read the file back from disk as a *fresh* PrettyMIDI object --
    # this checks that what we wrote is actually valid, loadable MIDI,
    # not just that our in-memory Python objects looked right.
    reloaded = pretty_midi.PrettyMIDI(str(out_path))
    # We should still have exactly our two tracks: right hand + left hand.
    assert len(reloaded.instruments) == 2
    # Flatten every instrument's notes into one combined list, to check
    # the total note count round-tripped correctly.
    all_notes = [n for inst in reloaded.instruments for n in inst.notes]
    assert len(all_notes) == len(melody_notes) + len(chord_notes)
    # The one section marker we added ("A") should have survived too.
    assert [t.text for t in reloaded.text_events] == ["A"]
