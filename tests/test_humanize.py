"""Tests for charts/humanize.py's timing/velocity randomization."""

from __future__ import annotations

from pianobot.charts.humanize import humanize_notes
from pianobot.types import NoteEvent


def _notes():
    return [
        NoteEvent(pitch=60, start=0.0, end=1.0, velocity=75),
        NoteEvent(pitch=64, start=1.0, end=2.0, velocity=75),
        NoteEvent(pitch=67, start=2.0, end=3.0, velocity=75),
    ]


def test_humanize_notes_is_deterministic_for_a_given_seed():
    a = humanize_notes(_notes(), seed=42)
    b = humanize_notes(_notes(), seed=42)
    assert [(n.start, n.end, n.velocity) for n in a] == [(n.start, n.end, n.velocity) for n in b]


def test_humanize_notes_different_seeds_produce_different_output():
    a = humanize_notes(_notes(), seed=1)
    b = humanize_notes(_notes(), seed=2)
    assert [(n.start, n.velocity) for n in a] != [(n.start, n.velocity) for n in b]


def test_humanize_notes_stays_within_the_configured_jitter_bounds():
    notes = _notes()
    humanized = humanize_notes(notes, seed=7, timing_jitter=0.02, velocity_jitter=10)
    for original, jittered in zip(notes, humanized):
        assert abs(jittered.start - original.start) <= 0.02 + 1e-9
        assert abs(jittered.velocity - original.velocity) <= 10
        # Duration is preserved -- both ends shift by the same offset.
        assert jittered.end - jittered.start == original.end - original.start


def test_humanize_notes_never_pushes_a_note_before_time_zero():
    notes = [NoteEvent(pitch=60, start=0.0, end=0.5, velocity=75)]
    # A large jitter with many seeds tried should never go negative.
    for seed in range(50):
        humanized = humanize_notes(notes, seed=seed, timing_jitter=0.05)
        assert humanized[0].start >= 0.0

def test_humanize_notes_clamps_velocity_to_the_valid_midi_range():
    quiet = [NoteEvent(pitch=60, start=0.0, end=1.0, velocity=3)]
    loud = [NoteEvent(pitch=60, start=0.0, end=1.0, velocity=125)]
    for seed in range(50):
        assert 1 <= humanize_notes(quiet, seed=seed, velocity_jitter=8)[0].velocity <= 127
        assert 1 <= humanize_notes(loud, seed=seed, velocity_jitter=8)[0].velocity <= 127


def test_humanize_notes_preserves_pitch_and_note_count():
    notes = _notes()
    humanized = humanize_notes(notes, seed=0)
    assert len(humanized) == len(notes)
    assert [n.pitch for n in humanized] == [n.pitch for n in notes]
