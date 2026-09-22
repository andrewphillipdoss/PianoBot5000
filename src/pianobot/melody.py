"""Melody extraction (Basic Pitch on the vocal stem) + cleanup.

Install: pip install "pianobot5000[melody]"
Basic Pitch (Spotify) is CPU-friendly (small ONNX/TF model, no GPU
needed) and is the lightest of the four model stages -- a good one to
verify first.

Beginner note: Basic Pitch listens to an audio file and guesses which
piano-roll notes were being played/sung -- similar to what a musician
does when they "transcribe" a recording by ear into sheet music. Its
raw output can be messy (overlapping notes, notes that don't line up
neatly with the beat), so this file has two jobs: (1) call Basic Pitch
and translate its answer into our NoteEvent objects, and (2) clean
that raw answer up into a single, tidy melody line a piano's right
hand could actually play.
"""

from __future__ import annotations

from pathlib import Path

from .types import Beat, NoteEvent


class BasicPitchUnavailable(RuntimeError):
    pass


def extract_melody_notes(vocals_path: Path) -> list[NoteEvent]:
    """Run Basic Pitch on a vocal stem, returning raw (possibly
    polyphonic/overlapping) note events. Use ``clean_melody`` to turn
    this into a single-line, quantized right-hand part.

    ("Polyphonic" means more than one note sounding at once -- normal
    for a full band, but not what we want for a single melody line.)
    """
    try:
        # Basic Pitch's own function that does the actual note
        # detection, plus the path to its pre-trained model weights.
        from basic_pitch.inference import predict
        from basic_pitch import ICASSP_2022_MODEL_PATH
    except ImportError as exc:
        raise BasicPitchUnavailable(
            "basic-pitch is not installed. Run: pip install 'pianobot5000[melody]'"
        ) from exc

    # `predict(...)` returns three things; we only care about the
    # third, so we name the first two `_` by convention (Python's way
    # of saying "I'm intentionally ignoring this value"). `note_events`
    # is a list of raw tuples: (start_time, end_time, pitch, amplitude, pitch_bend).
    _, _, note_events = predict(str(vocals_path), model_or_model_path=ICASSP_2022_MODEL_PATH)
    # This is a "list comprehension": a compact way of writing a loop
    # that builds a new list. It's equivalent to:
    #
    #   notes = []
    #   for start, end, pitch, amp, _pitch_bend in note_events:
    #       if end > start:
    #           notes.append(NoteEvent(pitch=int(pitch), start=float(start),
    #                                   end=float(end), velocity=_amp_to_velocity(amp)))
    #
    # The `if end > start` at the end filters out any zero-or-negative-
    # length "notes" Basic Pitch might report, which don't make sense
    # to keep.
    notes = [
        NoteEvent(pitch=int(pitch), start=float(start), end=float(end), velocity=_amp_to_velocity(amp))
        for start, end, pitch, amp, _pitch_bend in note_events
        if end > start
    ]
    # Put the notes in chronological order (earliest start time first).
    # `key=lambda n: n.start` tells `sort` "compare notes using their
    # .start value" -- a lambda is just a tiny, unnamed function
    # (`lambda n: n.start` means "given n, return n.start").
    notes.sort(key=lambda n: n.start)
    return notes


def clean_melody(notes: list[NoteEvent], beats: list[Beat], subdivisions_per_beat: int = 2) -> list[NoteEvent]:
    """Collapse to a single monophonic line and snap onsets/offsets to
    the beat grid, matching the diagram's "one note, quantized" box.

    ("Monophonic" is the opposite of polyphonic: only one note playing
    at any given moment, like a single human voice can only sing one
    note at a time. "Quantize" means "round to the nearest grid line" --
    here, the nearest fraction of a beat -- so notes line up cleanly
    with the song's rhythm instead of starting/stopping at slightly
    off-kilter, messy-looking times.)
    """
    mono = _to_monophonic(notes)
    # If we have no beat information at all (e.g. structure detection
    # hasn't run, or found nothing), there's no grid to snap onto, so
    # just return the monophonic notes as-is rather than crashing.
    if not beats:
        return mono
    grid = _beat_grid(beats, subdivisions_per_beat)
    return _quantize(mono, grid)


def _amp_to_velocity(amplitude: float) -> int:
    """Convert Basic Pitch's 0.0-1.0 confidence/loudness into a MIDI velocity (0-127)."""
    # `round(...)` turns e.g. 0.708 * 127 = 89.9 into the whole number
    # 90. `max(1, ...)` and `min(127, ...)` then clamp the result so it
    # can never fall below 1 or above 127, since MIDI velocities must
    # be whole numbers in that range.
    return max(1, min(127, round(float(amplitude) * 127)))


def _to_monophonic(notes: list[NoteEvent]) -> list[NoteEvent]:
    """At any instant, keep only the loudest active note. Resolves
    Basic Pitch's occasional polyphonic/overlapping output down to a
    single melodic line, which is what a vocal line actually is.
    """
    # Sort notes by start time first; for notes that start at exactly
    # the same instant, sort the louder one (`-n.velocity`, negated so
    # that "sort ascending" actually means "loudest first") before the
    # quieter one. This ordering matters for the loop below, which
    # processes notes one at a time and needs to see louder/earlier
    # notes before it decides how to trim quieter/later ones.
    ordered = sorted(notes, key=lambda n: (n.start, -n.velocity))
    result: list[NoteEvent] = []
    for note in ordered:
        start, end = note.start, note.end
        # Walk backwards through the notes we've already decided to
        # keep, most-recently-added first, looking for any that
        # overlap in time with the note we're currently considering.
        for kept in reversed(result):
            # `kept` ends before `note` begins -- no overlap, and
            # because `result` is in time order, nothing earlier in
            # the list can overlap either, so we can stop looking.
            if kept.end <= start:
                break
            if kept.velocity >= note.velocity:
                # The already-kept note is at least as loud: shrink
                # the *new* note so it doesn't start until the kept
                # note finishes (i.e. the kept note "wins" the overlap).
                start = max(start, kept.end)
            else:
                # The new note is louder: shrink the *already-kept*
                # note so it stops where the new, louder note begins.
                kept.end = min(kept.end, note.start)
        # After trimming, only keep this note if there's still a
        # meaningful sliver of it left (more than one millisecond;
        # anything shorter is essentially a rounding artifact, not a
        # real note).
        if end - start > 1e-3:
            result.append(NoteEvent(pitch=note.pitch, start=start, end=end, velocity=note.velocity))
    # The trimming above can occasionally shrink an already-kept note
    # down to (or past) zero length, so filter those out here.
    result = [n for n in result if n.end > n.start]
    # Trimming can also change the effective order slightly, so
    # re-sort by start time before handing the result back.
    result.sort(key=lambda n: n.start)
    return result


def _beat_grid(beats: list[Beat], subdivisions_per_beat: int) -> list[float]:
    """Build a list of evenly-spaced time points to snap notes onto.

    With subdivisions_per_beat=2 and beats at [0.0, 0.5, 1.0], this
    returns [0.0, 0.25, 0.5, 0.75, 1.0] -- i.e. it adds one extra grid
    point exactly halfway between each pair of beats, so notes can
    land on either a full beat or a half-beat.
    """
    times = [b.time for b in beats]
    # With fewer than 2 beats there's no gap to subdivide, and
    # subdivisions_per_beat=1 means "don't subdivide at all" -- in
    # either case just use the beat times themselves as the grid.
    if subdivisions_per_beat <= 1 or len(times) < 2:
        return times
    grid: list[float] = []
    # `zip(times, times[1:])` pairs up each beat time with the one
    # right after it: (times[0], times[1]), (times[1], times[2]), ...
    # -- a common Python trick for "look at every consecutive pair."
    for a, b in zip(times, times[1:]):
        step = (b - a) / subdivisions_per_beat
        # Add `subdivisions_per_beat` evenly-spaced points starting at
        # `a` (inclusive) and stopping just before `b`, since `b` will
        # get added as the start of the *next* pair's range instead.
        grid.extend(a + i * step for i in range(subdivisions_per_beat))
    # The loop above never adds the very last beat time on its own
    # (only as the endpoint of a pair), so add it here explicitly.
    grid.append(times[-1])
    return grid


def _snap(time: float, grid: list[float]) -> float:
    """Return whichever value in `grid` is closest to `time`."""
    # `min(..., key=...)` finds the item that minimizes the given
    # function -- here, "distance from `time`" -- rather than just the
    # smallest raw value, so it correctly finds the *nearest* grid
    # point even if that point is larger than `time`.
    return min(grid, key=lambda g: abs(g - time))


def _quantize(notes: list[NoteEvent], grid: list[float]) -> list[NoteEvent]:
    """Snap every note's start and end onto the nearest grid point."""
    quantized = []
    for note in notes:
        start = _snap(note.start, grid)
        end = _snap(note.end, grid)
        # If snapping happened to collapse a very short note down to
        # zero (or negative) length -- both its start and end rounding
        # to the same grid point -- just drop it rather than keep a
        # note with no duration.
        if end <= start:
            continue
        quantized.append(NoteEvent(pitch=note.pitch, start=start, end=end, velocity=note.velocity))
    return quantized
