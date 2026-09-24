"""Tests for the chart-based path: JSON parsing (charts/simple_format.py),
transposition (charts/transpose.py), and beats->seconds rendering
(charts/arrange.py). All pure -- no audio, no models.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from pianobot.charts.arrange import render_to_midi_inputs
from pianobot.charts.simple_format import chart_from_dict, load_chart
from pianobot.charts.transpose import transpose_chart

_EXAMPLE = {
    "title": "Test Chart",
    "key": "C",
    "tempo": 120,
    "sections": [{"label": "A", "start_beat": 0, "end_beat": 4}],
    "chords": [{"beat": 0, "duration_beats": 4, "chord": "Cmaj7"}],
    "melody": [{"beat": 0, "duration_beats": 1, "pitch": "C4"}],
}


def test_chart_from_dict_parses_chords_melody_and_sections():
    chart = chart_from_dict(_EXAMPLE)

    assert chart.title == "Test Chart"
    assert chart.key == "C"
    assert chart.tempo == 120

    assert len(chart.chords) == 1
    chord = chart.chords[0]
    assert chord.root_pitch_class == 0  # C
    assert chord.quality == "maj"  # Cmaj7 simplifies to a major triad
    assert chord.start == 0
    assert chord.end == 4

    assert len(chart.melody) == 1
    note = chart.melody[0]
    assert note.pitch == 60  # C4
    assert note.start == 0
    assert note.end == 1

    assert len(chart.sections) == 1
    assert chart.sections[0].label == "A"
    assert chart.sections[0].start == 0
    assert chart.sections[0].end == 4


def test_melody_pitch_accepts_raw_midi_number_too():
    data = dict(_EXAMPLE, melody=[{"beat": 0, "duration_beats": 1, "pitch": 60}])
    chart = chart_from_dict(data)
    assert chart.melody[0].pitch == 60


def test_load_chart_reads_the_bundled_example():
    example_path = Path(__file__).parent.parent / "examples" / "practice-changes.json"
    chart = load_chart(example_path)
    assert chart.key == "C"
    assert len(chart.chords) == 8
    assert all(c.quality in ("maj", "min") for c in chart.chords)


def test_transpose_chart_shifts_pitches_and_key():
    chart = chart_from_dict(_EXAMPLE)
    transposed = transpose_chart(chart, "D")  # C -> D is +2 semitones

    assert transposed.key == "D"
    assert transposed.chords[0].root_pitch_class == 2
    assert transposed.melody[0].pitch == 62  # C4 (60) + 2
    # Sections carry no pitch information, so they pass through untouched.
    assert transposed.sections[0].start == chart.sections[0].start
    assert transposed.sections[0].end == chart.sections[0].end
    # The original chart is left unmodified.
    assert chart.key == "C"
    assert chart.chords[0].root_pitch_class == 0


def test_transpose_chart_to_the_same_key_is_a_no_op():
    chart = chart_from_dict(_EXAMPLE)
    assert transpose_chart(chart, "C") is chart


def test_render_to_midi_inputs_converts_beats_to_seconds():
    chart = chart_from_dict(_EXAMPLE)  # tempo=120 -> 0.5 seconds per beat
    melody_notes, chord_notes, sections = render_to_midi_inputs(chart)

    assert melody_notes[0].start == pytest.approx(0.0)
    assert melody_notes[0].end == pytest.approx(0.5)

    # voice_triads() turns the one 4-beat chord into 3 notes, all
    # spanning the same (now-in-seconds) 0.0-2.0s window.
    assert len(chord_notes) == 3
    assert all(n.start == pytest.approx(0.0) and n.end == pytest.approx(2.0) for n in chord_notes)

    assert sections[0].start == pytest.approx(0.0)
    assert sections[0].end == pytest.approx(2.0)


def test_render_to_midi_inputs_rejects_unknown_style():
    chart = chart_from_dict(_EXAMPLE)
    with pytest.raises(ValueError):
        render_to_midi_inputs(chart, style="walking-bass")
