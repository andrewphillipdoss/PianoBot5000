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

from pianobot.theory import _centroid, _comping_onsets, _stack_close_position, comp_triads, voice_triads
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


# ---- comp_triads / _comping_onsets ---------------------------------------
# comp_triads() is the fix for arrangements that sound "over-quantized":
# instead of one static block chord sustained for the whole duration, it
# plays the same voicing as a repeating rhythmic pattern.


def test_comping_onsets_tiles_the_charleston_cell_across_a_4_beat_chord():
    # A 4-beat (one bar) chord is two full 2-beat cells back to back:
    # hit on beat 0, hit on beat 1.5, hit on beat 2, hit on beat 3.5.
    onsets = _comping_onsets(4.0)
    assert onsets == [(0.0, 1.5), (1.5, 0.5), (2.0, 1.5), (3.5, 0.5)]


def test_comping_onsets_handles_a_leftover_fragment_as_one_plain_hit():
    # 3 beats = one full 2-beat cell, then a 1-beat leftover that's too
    # short to subdivide further -- just one sustained hit for it.
    onsets = _comping_onsets(3.0)
    assert onsets == [(0.0, 1.5), (1.5, 0.5), (2.0, 1.0)]


def test_comping_onsets_handles_a_chord_shorter_than_one_cell():
    onsets = _comping_onsets(1.0)
    assert onsets == [(0.0, 1.0)]


def test_comp_triads_turns_one_sustained_chord_into_multiple_rhythmic_hits():
    chords = [ChordEvent(root_pitch_class=0, quality="maj", start=0.0, end=4.0)]
    notes = comp_triads(chords)

    # 4 comping hits (from the cell tiling above) x 3 notes per triad.
    starts = sorted({n.start for n in notes})
    assert starts == [0.0, 1.5, 2.0, 3.5]
    assert len(notes) == 12

    # Every hit is voiced as the same close-position C major triad.
    for start in starts:
        pitches = sorted(n.pitch for n in notes if n.start == start)
        assert pitches == [48, 52, 55]


def test_comp_triads_detaches_each_hit_so_it_does_not_run_into_the_next():
    chords = [ChordEvent(root_pitch_class=0, quality="maj", start=0.0, end=2.0)]
    notes = comp_triads(chords)

    first_hit = [n for n in notes if n.start == 0.0]
    # The first hit's slot is 1.5 beats; it should end noticeably
    # before the next hit at 1.5 (some silence between them), not
    # exactly at 1.5 (which would just be voice_triads with extra steps).
    assert all(n.end < 1.5 for n in first_hit)
    assert all(n.end > 1.0 for n in first_hit)  # but not cut absurdly short either


def test_comp_triads_still_voice_leads_between_chords():
    chords = [
        ChordEvent(root_pitch_class=0, quality="maj", start=0.0, end=2.0),
        ChordEvent(root_pitch_class=9, quality="min", start=2.0, end=4.0),
    ]
    notes = comp_triads(chords)
    last_hit_of_first_chord = sorted(n.pitch for n in notes if n.start == 1.5)
    first_hit_of_second_chord = sorted(n.pitch for n in notes if n.start == 2.0)

    assert last_hit_of_first_chord == [48, 52, 55]  # C3 E3 G3
    assert first_hit_of_second_chord == [48, 52, 57]  # A minor, 1st inversion -- same voice leading as voice_triads


def test_comp_triads_skips_no_chord_segments():
    chords = [ChordEvent(root_pitch_class=0, quality="N", start=0.0, end=4.0)]
    assert comp_triads(chords) == []
