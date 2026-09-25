"""Subtle, deterministic timing/velocity randomization ("humanization"),
applied as the last step before assembling the MIDI file.

Why this exists: a chart's own chords/melody are, by construction,
locked exactly to the beat grid -- correct for *notation* ("this note
starts on beat 3", full stop), but playing that back completely
literally is a big part of what makes a rendered arrangement sound
mechanical: no real player's timing or dynamics are ever perfectly
identical note to note. This nudges each note's start/end and velocity
by a small random amount -- small enough that the written rhythm and
dynamics are still clearly recognizable, large enough to not sound
like a sequencer.
"""

from __future__ import annotations

import random

from ..types import NoteEvent

_TIMING_JITTER_SECONDS = 0.015  # max +/- shift applied to a note's start (and end, by the same amount, so its duration is unchanged)
_VELOCITY_JITTER = 8  # max +/- shift applied to a note's velocity
_MIN_DURATION_SECONDS = 0.02  # floor so timing jitter can never make a very short note (or negative-length one)


def humanize_notes(
    notes: list[NoteEvent],
    seed: int,
    timing_jitter: float = _TIMING_JITTER_SECONDS,
    velocity_jitter: int = _VELOCITY_JITTER,
) -> list[NoteEvent]:
    """Return a new list of notes with small random timing/velocity
    nudges applied. Deterministic for a given `seed` -- same chart,
    same seed, same output -- so this doesn't make renders
    unreproducible or tests flaky.
    """
    rng = random.Random(seed)
    humanized = []
    for note in notes:
        offset = rng.uniform(-timing_jitter, timing_jitter)
        # Clamp the *offset* itself (not just the resulting start) so
        # start and end still shift by the same amount, preserving the
        # note's duration exactly even for notes right at the top of
        # the song.
        offset = max(offset, -note.start)
        start = note.start + offset
        end = max(start + _MIN_DURATION_SECONDS, note.end + offset)
        velocity = min(127, max(1, note.velocity + rng.randint(-velocity_jitter, velocity_jitter)))
        humanized.append(NoteEvent(pitch=note.pitch, start=start, end=end, velocity=velocity))
    return humanized
