"""Synthetic audio generation, for exercising the full CLI pipeline
(stems -> models -> MIDI) without needing a real song file.

The output is a toy "song": a sung-ish melody (voice-like sine +
vibrato, panned/leveled like lead vocal) over a chord pad and a kick
pulse, at a fixed, known tempo/chord progression -- so once the real
model stages are installed you can sanity-check their output against
ground truth instead of just checking "it didn't crash".

Beginner note: this file doesn't call any AI model at all -- it's pure
math. We build a fake "song" from scratch using sine waves (the
simplest possible sound wave shape, like a smoothly wobbling line) at
specific musical pitches, so we have a cheap, always-available test
input. Because *we* chose exactly which notes and chords go into it
(see GROUND_TRUTH_MELODY / GROUND_TRUTH_CHORDS below), we can later
compare what Basic Pitch/Chordino/allin1 *think* they heard against
what we know is actually in the file.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

_A4 = 440.0  # the standard tuning reference pitch: "A above middle C" is defined as 440 Hz


def _midi_to_hz(pitch: int) -> float:
    """Convert a MIDI note number into a frequency in Hz (cycles per second)."""
    # MIDI note 69 is defined as A4 (440 Hz), and each step of 1 MIDI
    # note is one semitone -- and each semitone is a factor of
    # 2^(1/12) in frequency (since doubling frequency = going up a full
    # octave = 12 semitones). So "how many semitones away from A4" is
    # (pitch - 69), and we raise 2^(1/12) to that many powers.
    return _A4 * 2 ** ((pitch - 69) / 12)


def _tone(freq: float, duration: float, sr: int, vibrato: float = 0.0, amp: float = 0.3) -> np.ndarray:
    """Generate `duration` seconds of a sine wave at `freq` Hz, sampled at `sr` samples/second.

    vibrato: how much to wobble the pitch up and down over time, to
        sound a little more like a real sung note than a flat, robotic tone.
    amp: peak loudness (amplitude) of the wave, roughly 0.0 (silent) to 1.0 (max).
    """
    # `np.linspace(0, duration, N, endpoint=False)` creates an array of
    # N evenly-spaced time values from 0 up to (but not including)
    # `duration` -- one timestamp for every audio sample we're about to
    # generate. N = sr * duration, since `sr` is "samples per second."
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    # If vibrato is requested, multiply the frequency by a slowly
    # oscillating factor (a second, much slower sine wave at 5.5 wobbles
    # per second) so the pitch gently rises and falls, the way a human
    # voice naturally does. `1.0 + vibrato * sin(...)` stays close to 1.0,
    # just nudged up/down by a small amount.
    vibrato_mod = 1.0 + vibrato * np.sin(2 * np.pi * 5.5 * t) if vibrato else 1.0
    # The actual audio wave: a sine wave at (approximately) `freq` Hz,
    # scaled down to our desired peak loudness `amp`.
    wave = amp * np.sin(2 * np.pi * freq * vibrato_mod * t)
    # A simple fade-in/fade-out "envelope" so each note doesn't start
    # or stop with an abrupt (and audibly clicky) jump from silence to
    # full volume. `np.minimum(t, duration - t)` is small near both the
    # very start and very end of the note and large in the middle;
    # multiplying by 20 and clamping at 1.0 turns that into a quick
    # ramp up, a sustained plateau at full volume, then a quick ramp
    # back down.
    envelope = np.minimum(1.0, np.minimum(t, duration - t) * 20 + 0.05)
    return wave * envelope


GROUND_TRUTH_TEMPO = 100.0  # beats per minute for our synthetic song
GROUND_TRUTH_MELODY = [60, 62, 64, 65, 64, 62, 60, 60]  # C4 D4 E4 F4 E4 D4 C4 C4, one per beat
GROUND_TRUTH_CHORDS = [(0, "maj"), (5, "maj"), (9, "min"), (7, "maj")]  # C, F, Am, G (2 beats each)


def generate_synthetic_song(path: Path, sr: int = 22050) -> Path:
    """Build the toy song described above and save it as a .wav file at `path`."""
    # Convert "beats per minute" into "seconds per beat" -- e.g. 100
    # BPM means 100 beats happen every 60 seconds, so each beat lasts
    # 60/100 = 0.6 seconds.
    beat_dur = 60.0 / GROUND_TRUTH_TEMPO
    n_beats = len(GROUND_TRUTH_MELODY)
    duration = n_beats * beat_dur
    n_samples = int(sr * duration)

    # Start with a silent track (an array of all zeros) exactly as
    # long as our whole song, then add each layer (melody, chords,
    # kick drum) on top of it below.
    mix = np.zeros(n_samples)

    # "Vocal" melody line (one note per beat).
    # `enumerate(...)` gives us both the position `i` (0, 1, 2, ...)
    # and the note `pitch` at that position, so we know exactly which
    # beat each note should start on.
    for i, pitch in enumerate(GROUND_TRUTH_MELODY):
        # Which audio sample number corresponds to the start of beat `i`.
        start = int(i * beat_dur * sr)
        # Make the note last slightly less than a full beat (95%) so
        # there's a tiny gap between consecutive notes, instead of them
        # running together with no audible separation.
        tone = _tone(_midi_to_hz(pitch), beat_dur * 0.95, sr, vibrato=0.01, amp=0.35)
        # Add this note's samples into the mix starting at `start`.
        # Using `+=` (rather than just overwriting) means if two layers
        # ever overlapped in time, they'd blend together like two
        # instruments actually playing at once, rather than one
        # replacing the other.
        mix[start:start + len(tone)] += tone

    # Chord pad (2 beats per chord), root + third + fifth an octave down.
    root_intervals = {"maj": (0, 4, 7), "min": (0, 3, 7)}
    for i, (root_pc, quality) in enumerate(GROUND_TRUTH_CHORDS):
        start = int(i * 2 * beat_dur * sr)  # each chord holds for 2 beats
        chord_dur = 2 * beat_dur
        for interval in root_intervals[quality]:
            # 48 = MIDI note C3, a comfortable low "left hand" register
            # for a chord pad to sit under the melody.
            pitch = 48 + root_pc + interval
            tone = _tone(_midi_to_hz(pitch), chord_dur * 0.98, sr, amp=0.12)
            mix[start:start + len(tone)] += tone

    # Kick pulse on every beat, so beat trackers have something to grab onto.
    for i in range(n_beats):
        start = int(i * beat_dur * sr)
        click_len = int(sr * 0.05)  # a short, 50-millisecond click
        # A "kick drum" sound approximated as a low-pitched tone that
        # decays (fades out) almost instantly: `np.exp(-np.linspace(0, 30, click_len))`
        # produces a curve that starts at 1.0 and rapidly shrinks
        # toward 0, giving the classic percussive "thump" shape rather
        # than a sustained tone.
        click = 0.5 * np.exp(-np.linspace(0, 30, click_len)) * np.sin(2 * np.pi * 60 * np.linspace(0, 0.05, click_len))
        mix[start:start + click_len] += click

    # Normalize the final mix so its loudest peak sits at 1.0 (the
    # maximum a standard audio file can represent without distorting).
    # `max(1.0, np.abs(mix).max())` avoids ever *increasing* the
    # volume of an already-quiet mix -- we only ever turn it down if
    # it's currently louder than 1.0, never up.
    mix = mix / max(1.0, np.abs(mix).max())
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), mix, sr)
    return path
