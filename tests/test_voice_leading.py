"""Tests for theory.py's inversion-choosing voice leading in
voice_triads(), plus its two small pure helpers (_stack_close_position,
_centroid). This logic is shared by both the chart-based path and the
audio-transcription path, so it lives in theory.py rather than either
one specifically.

Beginner note: "voice leading" is the music-theory term for choosing,
among several equally-correct ways to voice a chord, whichever one
moves the least from the chord before it. These tests check that
voice_triads() actually does that instead of always defaulting to
root position.
"""

from __future__ import annotations

from pianobot.theory import _centroid, _stack_close_position, voice_triads
from pianobot.types import ChordEvent


def test_stack_close_position_builds_ascending_stack_near_anchor():
    # E, G, C (a C major triad starting on its third) anchored near
    # MIDI 48 (C3) should become E3, G3, C4 -- the smallest possible
    # upward stack starting from an E close to that anchor.
    assert _stack_close_position((4, 7, 0), anchor=48) == [52, 55, 60]


def test_centroid_is_the_plain_average():
    assert _centroid([48, 52, 55]) == (48 + 52 + 55) / 3


def test_first_chord_defaults_to_root_position():
    # With nothing before it to lead smoothly from, the first chord
    # should just be plain root position: C3, E3, G3.
    chords = [ChordEvent(root_pitch_class=0, quality="maj", start=0.0, end=1.0)]
    pitches = sorted(n.pitch for n in voice_triads(chords))
    assert pitches == [48, 52, 55]


def test_second_chord_picks_the_inversion_closest_to_the_first():
    # C major -> A minor. Root position for both (the old, naive
    # behavior) would jump the whole hand from [48,52,55] up to
    # [57,60,64] -- an 9-12 semitone leap on every note. With voice
    # leading, A minor's first inversion ([48,52,57], i.e. C-E-A) is
    # obviously closer: it shares two notes outright (C3, E3) with the
    # C major chord before it, and only the third note moves at all.
    chords = [
        ChordEvent(root_pitch_class=0, quality="maj", start=0.0, end=1.0),
        ChordEvent(root_pitch_class=9, quality="min", start=1.0, end=2.0),
    ]
    voiced = voice_triads(chords)
    first_chord_pitches = sorted(n.pitch for n in voiced if n.start == 0.0)
    second_chord_pitches = sorted(n.pitch for n in voiced if n.start == 1.0)

    assert first_chord_pitches == [48, 52, 55]  # C3, E3, G3 (root position)
    assert second_chord_pitches == [48, 52, 57]  # C3, E3, A3 (A minor, 1st inversion)

    # The concrete voice-leading payoff: two notes don't move at all.
    shared = set(first_chord_pitches) & set(second_chord_pitches)
    assert shared == {48, 52}


def test_a_no_chord_gap_does_not_reset_voice_leading():
    # An "N" (no chord) segment in the middle shouldn't make the chord
    # after it forget where the hand was -- it should still lead
    # smoothly from the last *real* chord before the gap.
    chords = [
        ChordEvent(root_pitch_class=0, quality="maj", start=0.0, end=1.0),
        ChordEvent(root_pitch_class=0, quality="N", start=1.0, end=1.5),
        ChordEvent(root_pitch_class=9, quality="min", start=1.5, end=2.5),
    ]
    voiced = voice_triads(chords)
    # The "N" segment contributes no notes at all.
    assert all(n.start != 1.0 or n.end != 1.5 for n in voiced)

    after_gap_pitches = sorted(n.pitch for n in voiced if n.start == 1.5)
    assert after_gap_pitches == [48, 52, 57]  # same voice-leading result as with no gap
