"""End-to-end smoke test for the non-ML stages (cleanup, voicing,
labeling, MIDI assembly) using hand-built fixtures -- no Demucs /
Basic Pitch / Chordino / allin1 required, so this runs anywhere.
"""

from __future__ import annotations

from pathlib import Path

import pretty_midi
import pytest

from pianobot import assemble, chords, melody, structure
from pianobot.types import Beat, ChordEvent, NoteEvent, Section


def _beats(n: int, beat_dur: float = 0.5) -> list[Beat]:
    return [Beat(time=i * beat_dur, is_downbeat=(i % 4 == 0)) for i in range(n)]


def test_clean_melody_collapses_overlaps_and_quantizes():
    beats = _beats(5)
    raw_notes = [
        NoteEvent(pitch=60, start=0.02, end=0.48, velocity=90),
        NoteEvent(pitch=64, start=0.20, end=0.46, velocity=40),  # quieter, overlapping -> dropped/trimmed
        NoteEvent(pitch=62, start=0.51, end=0.97, velocity=80),
    ]
    cleaned = melody.clean_melody(raw_notes, beats)

    assert all(n.end > n.start for n in cleaned)
    # monophonic: no two notes overlap in time
    for a, b in zip(cleaned, cleaned[1:]):
        assert a.end <= b.start + 1e-9
    # quantized onto the beat subdivision grid (default: 2 subdivisions/beat)
    grid = melody._beat_grid(beats, subdivisions_per_beat=2)
    for n in cleaned:
        assert any(abs(n.start - g) < 1e-9 for g in grid)
        assert any(abs(n.end - g) < 1e-9 for g in grid)


def test_chord_snapping_and_voicing():
    beats = _beats(9)
    raw_chords = [
        ChordEvent(root_pitch_class=0, quality="maj", start=0.03, end=1.97),  # C major, ~beats 0-4
        ChordEvent(root_pitch_class=9, quality="min", start=2.01, end=4.0),   # A minor, ~beats 4-8
    ]
    snapped = chords.snap_chords_to_beats(raw_chords, beats)
    assert snapped[0].start == pytest.approx(0.0)
    assert snapped[1].root_pitch_class == 9

    triads = chords.voice_triads(snapped)
    # each chord contributes exactly 3 notes (root, third, fifth)
    assert len(triads) == 3 * len(snapped)
    c_major_pitches = sorted(n.pitch for n in triads if n.start == 0.0)
    assert c_major_pitches == [48, 52, 55]  # C3, E3, G3


def test_label_repeats_reuses_letters_for_repeated_sections():
    sections = [
        Section(start=0, end=10, label="", source_label="verse"),
        Section(start=10, end=20, label="", source_label="chorus"),
        Section(start=20, end=30, label="", source_label="verse"),
        Section(start=30, end=40, label="", source_label="chorus"),
    ]
    labeled = structure.label_repeats(sections)
    assert [s.label for s in labeled] == ["A", "B", "A", "B"]


def test_assemble_and_write_midi_roundtrips(tmp_path: Path):
    melody_notes = [NoteEvent(pitch=60 + i, start=i * 0.5, end=i * 0.5 + 0.45, velocity=90) for i in range(4)]
    chord_notes = [
        NoteEvent(pitch=p, start=0.0, end=2.0, velocity=70) for p in (48, 52, 55)
    ]
    sections = [Section(start=0.0, end=2.0, label="A", source_label="verse")]

    pm = assemble.assemble_midi(melody_notes, chord_notes, sections, tempo=100.0)
    out_path = assemble.write_midi(pm, tmp_path / "out.mid")

    assert out_path.exists()
    reloaded = pretty_midi.PrettyMIDI(str(out_path))
    assert len(reloaded.instruments) == 2
    all_notes = [n for inst in reloaded.instruments for n in inst.notes]
    assert len(all_notes) == len(melody_notes) + len(chord_notes)
    assert [t.text for t in reloaded.text_events] == ["A"]
