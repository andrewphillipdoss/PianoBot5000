"""Tests for the MusicXML importer (charts/musicxml_format.py), built
from music21 Score objects assembled directly in Python -- no actual
.musicxml file needed, so these run without any file I/O or real sheet
music, while still exercising the real music21 object model.

Skipped entirely if music21 isn't installed (it's an optional extra,
`pianobot5000[charts-musicxml]` -- see pyproject.toml).
"""

from __future__ import annotations

import pytest

music21 = pytest.importorskip("music21")

from pianobot.charts.musicxml_format import chart_from_score, load_chart


def _score_with_part(part) -> "music21.stream.Score":
    score = music21.stream.Score()
    score.append(part)
    return score


def test_key_and_tempo_are_read_and_translated():
    part = music21.stream.Part()
    part.insert(0, music21.key.Key("E-", "major"))  # music21 spells flats as "E-"
    # A compound-time tempo marking (dotted quarter = 80, i.e. 120 quarter-BPM)
    # -- getQuarterBPM() should already normalize this for us.
    part.insert(0, music21.tempo.MetronomeMark(referent=1.5, number=80))
    part.append(music21.note.Note("C4", quarterLength=1.0))

    chart = chart_from_score(music21, _score_with_part(part), title="Test")

    assert chart.key == "Eb"  # translated from music21's "E-" spelling
    assert chart.tempo == pytest.approx(120.0)


def test_no_key_signature_falls_back_to_key_analysis():
    part = music21.stream.Part()
    # No explicit Key object -- an unambiguous C major melody, so
    # music21's own key-finding analysis should land on C.
    for pitch in ("C4", "E4", "G4", "C5", "G4", "E4", "C4"):
        part.append(music21.note.Note(pitch, quarterLength=1.0))

    chart = chart_from_score(music21, _score_with_part(part), title="Test")
    assert chart.key == "C"


def test_tied_notes_across_a_barline_merge_into_one_note():
    part = music21.stream.Part()
    n1 = music21.note.Note("C4", quarterLength=1.0)
    n1.tie = music21.tie.Tie("start")
    n2 = music21.note.Note("C4", quarterLength=1.0)
    n2.tie = music21.tie.Tie("stop")
    part.append(n1)
    part.append(n2)
    part.append(music21.note.Note("D4", quarterLength=1.0))

    chart = chart_from_score(music21, _score_with_part(part), title="Test")

    assert len(chart.melody) == 2
    tied = chart.melody[0]
    assert tied.pitch == 60  # C4
    assert tied.start == 0.0
    assert tied.end == 2.0  # both quarter notes merged into one 2-beat note


def test_grace_notes_are_skipped():
    part = music21.stream.Part()
    grace = music21.note.Note("D4")
    grace.duration = music21.duration.GraceDuration()
    part.append(grace)
    part.append(music21.note.Note("C4", quarterLength=1.0))

    chart = chart_from_score(music21, _score_with_part(part), title="Test")

    assert len(chart.melody) == 1
    assert chart.melody[0].pitch == 60  # C4 -- the grace note contributed nothing


def test_rests_are_skipped():
    part = music21.stream.Part()
    part.append(music21.note.Note("C4", quarterLength=1.0))
    part.append(music21.note.Rest(quarterLength=1.0))
    part.append(music21.note.Note("D4", quarterLength=1.0))

    chart = chart_from_score(music21, _score_with_part(part), title="Test")

    assert [n.pitch for n in chart.melody] == [60, 62]


def test_chord_symbols_become_chord_events_not_melody_notes():
    part = music21.stream.Part()
    part.insert(0.0, music21.harmony.ChordSymbol("Cmaj7"))
    part.append(music21.note.Note("C4", quarterLength=4.0))

    chart = chart_from_score(music21, _score_with_part(part), title="Test")

    # The ChordSymbol must not leak into the melody (it's a Chord
    # subclass in music21, so it would show up in notesAndRests too).
    assert len(chart.melody) == 1
    assert len(chart.chords) == 1
    assert chart.chords[0].root_pitch_class == 0  # C
    assert chart.chords[0].quality == "maj"


def test_m7b5_is_corrected_to_a_diminished_triad_not_minor():
    # music21 parses "Bm7b5" (a common way to write a half-diminished
    # chord) with chordKind == "minor-seventh" and the flatted 5th
    # stored as a separate alteration -- trusting chordKind text alone
    # would misclassify this as a plain minor triad. The actual
    # root/third/fifth pitches (minor 3rd + diminished 5th) show its
    # real diminished-triad shape.
    part = music21.stream.Part()
    part.insert(0.0, music21.harmony.ChordSymbol("Bm7b5"))
    part.append(music21.note.Note("B3", quarterLength=4.0))

    chart = chart_from_score(music21, _score_with_part(part), title="Test")

    assert chart.chords[0].quality == "dim"


def test_none_kind_chord_symbol_is_dropped_as_no_chord():
    part = music21.stream.Part()
    cs = music21.harmony.ChordSymbol("C")
    cs.chordKind = "none"
    part.insert(0.0, cs)
    part.insert(4.0, music21.harmony.ChordSymbol("G7"))
    part.append(music21.note.Note("C4", quarterLength=8.0))

    chart = chart_from_score(music21, _score_with_part(part), title="Test")

    assert len(chart.chords) == 1
    assert chart.chords[0].root_pitch_class == 7  # G


def test_no_rehearsal_marks_gives_one_whole_section():
    part = music21.stream.Part()
    part.append(music21.note.Note("C4", quarterLength=4.0))

    chart = chart_from_score(music21, _score_with_part(part), title="Test")

    assert len(chart.sections) == 1
    assert chart.sections[0].label == "A"
    assert chart.sections[0].start == 0.0
    assert chart.sections[0].end == 4.0


def test_load_chart_accepts_a_plain_string_path(tmp_path):
    # load_chart's file-reading wrapper must coerce its argument to a
    # Path itself (like simple_format.load_chart already does), since a
    # caller passing a plain string (common when a path comes from,
    # say, a database row rather than pathlib) shouldn't crash on
    # `path.stem`.
    part = music21.stream.Part()
    part.append(music21.note.Note("C4", quarterLength=1.0))
    score = _score_with_part(part)
    out = tmp_path / "tiny.musicxml"
    score.write("musicxml", fp=str(out))

    chart = load_chart(str(out))  # a plain str, not a Path
    assert len(chart.melody) == 1


def test_rehearsal_marks_become_labeled_sections():
    part = music21.stream.Part()
    part.insert(0.0, music21.expressions.RehearsalMark("Verse"))
    part.insert(8.0, music21.expressions.RehearsalMark("Chorus"))
    part.insert(16.0, music21.expressions.RehearsalMark("Verse"))
    part.append(music21.note.Note("C4", quarterLength=20.0))

    chart = chart_from_score(music21, _score_with_part(part), title="Test")

    assert [s.label for s in chart.sections] == ["A", "B", "A"]
    assert [s.source_label for s in chart.sections] == ["Verse", "Chorus", "Verse"]
