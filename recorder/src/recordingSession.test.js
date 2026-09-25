import { describe, expect, it, vi } from 'vitest';
import { playNoteForDuration } from './pianoSynth.js';
import { RecordingSession } from './recordingSession.js';

// Only the audio side is mocked (real Web Audio doesn't exist in this
// test environment) -- the state machine itself runs on real
// setTimeout/setInterval against a very fast fake tempo, so these
// tests genuinely exercise the count-in -> capture -> done timing
// logic and MIDI message buffering, just compressed into
// milliseconds instead of real musical time. What this file can't
// verify is how the audio actually sounds/syncs in a real browser --
// that's confirmed separately, by ear and via Playwright.
vi.mock('./pianoSynth.js', () => ({
  getAudioContext: () => ({ currentTime: 0 }),
  playClickAt: vi.fn(),
  playNoteForDuration: vi.fn(),
  stopAllNotes: vi.fn(),
}));

const FAST_TEMPO = 6000; // 10ms/beat -- unrealistic musically, just fast enough to test with real timers

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('RecordingSession (chords mode)', () => {
  it('goes idle -> countIn -> capturing -> done, buffering messages only while capturing', async () => {
    const phases = [];
    const session = new RecordingSession({ tempo: FAST_TEMPO, mode: 'chords', onPhaseChange: (p) => phases.push(p) });

    expect(session.phase).toBe('idle');
    session.start();
    expect(session.phase).toBe('countIn');

    // Sent during the count-in -- should be dropped, not buffered.
    session.handleMidiMessage({ timestamp: performance.now(), type: 'noteon', note: 60, velocity: 90 });

    await wait(80); // well past the ~40ms count-in at this tempo
    expect(session.phase).toBe('capturing');
    expect(session.bufferedMessages).toEqual([]); // the count-in message was correctly ignored

    session.handleMidiMessage({ timestamp: performance.now(), type: 'noteon', note: 48, velocity: 90 }); // C3
    session.handleMidiMessage({ timestamp: performance.now(), type: 'noteon', note: 52, velocity: 90 }); // E3
    session.handleMidiMessage({ timestamp: performance.now(), type: 'noteon', note: 55, velocity: 90 }); // G3

    await wait(20);
    session.stop();

    expect(session.phase).toBe('done');
    expect(phases).toEqual(['idle', 'countIn', 'capturing', 'done']); // start() always cancels first, hence the leading 'idle'
    expect(session.result.chords).toHaveLength(1);
    expect(session.result.chords[0].quality).toBe('maj');

    // rawMessages + captureDurationSeconds ride along so a later
    // screen can re-quantize this exact take without re-recording.
    expect(session.result.rawMessages).toHaveLength(3);
    expect(session.result.captureDurationSeconds).toBeGreaterThan(0);
  });

  it('cancel() stops everything and goes back to idle', async () => {
    const session = new RecordingSession({ tempo: FAST_TEMPO, mode: 'chords' });
    session.start();
    await wait(80);
    expect(session.phase).toBe('capturing');
    session.cancel();
    expect(session.phase).toBe('idle');
  });

  it('stop() is a no-op outside the capturing phase', () => {
    const session = new RecordingSession({ tempo: FAST_TEMPO, mode: 'chords' });
    session.start();
    expect(session.phase).toBe('countIn');
    session.stop(); // too early -- still counting in
    expect(session.phase).toBe('countIn');
  });

  it('an unrecognizable chord calls onError (not onDone) and drops back to idle, not a stuck "done"', async () => {
    let error = null;
    let doneCalled = false;
    const phases = [];
    const session = new RecordingSession({
      tempo: FAST_TEMPO,
      mode: 'chords',
      onPhaseChange: (p) => phases.push(p),
      onDone: () => {
        doneCalled = true;
      },
      onError: (e) => {
        error = e;
      },
    });
    session.start();
    await wait(80);
    expect(session.phase).toBe('capturing');

    // Two notes a whole step apart isn't a recognizable triad or 7th.
    session.handleMidiMessage({ timestamp: performance.now(), type: 'noteon', note: 60, velocity: 90 });
    session.handleMidiMessage({ timestamp: performance.now(), type: 'noteon', note: 62, velocity: 90 });

    await wait(20);
    session.stop();

    expect(doneCalled).toBe(false);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/couldn't recognize a chord/);
    expect(session.phase).toBe('idle'); // not stuck on 'done' with no result
    expect(phases.at(-1)).toBe('idle');
  });
});

describe('RecordingSession (melody mode)', () => {
  it('auto-finishes after sectionLengthBeats and calls onDone', async () => {
    let doneResult = null;
    const session = new RecordingSession({
      tempo: FAST_TEMPO,
      mode: 'melody',
      onDone: (result) => {
        doneResult = result;
      },
    });
    session.start({ chords: [], sectionLengthBeats: 20 }); // 20 beats * 10ms = 200ms of capture -- long enough to leave real margin around the count-in and the message below

    await wait(80); // past the ~40ms count-in, comfortably before the 200ms capture window ends
    expect(session.phase).toBe('capturing');
    const noteOnAt = performance.now();
    session.handleMidiMessage({ timestamp: noteOnAt, type: 'noteon', note: 60, velocity: 90 });
    session.handleMidiMessage({ timestamp: noteOnAt + 5, type: 'noteoff', note: 60, velocity: 0 });

    await wait(220); // past the full capture window -- should auto-finish, no stop() call needed
    expect(session.phase).toBe('done');
    expect(doneResult).not.toBeNull();
    expect(doneResult.notes).toHaveLength(1);
    expect(doneResult.notes[0].pitch).toBe(60);
    expect(doneResult.rawMessages).toHaveLength(2); // note-on + note-off, so this take can be re-quantized later too
  });

  it('signals the pickup bar starting when capturing begins and ending one bar later', async () => {
    const pickupBarChanges = [];
    const session = new RecordingSession({
      tempo: FAST_TEMPO,
      mode: 'melody',
      onPickupBarChange: (isPickupBar) => pickupBarChanges.push(isPickupBar),
    });
    session.start({ chords: [], sectionLengthBeats: 20 });

    await wait(20); // still in count-in -- pickup bar hasn't started yet
    expect(session.isPickupBar).toBe(false);

    await wait(30); // past the ~40ms count-in -- capturing (and the pickup bar) has begun
    expect(session.phase).toBe('capturing');
    expect(session.isPickupBar).toBe(true);

    await wait(50); // past the ~40ms pickup bar -- the chords have started, pickup bar is over
    expect(session.isPickupBar).toBe(false);
    // Leading falses: the constructor's own _resetPassState(), plus start()'s cancel() and its own _resetPassState().
    expect(pickupBarChanges).toEqual([false, false, false, true, false]);
  });

  it('schedules chord backing for a fractional-beat chord, delayed by one full pickup bar', async () => {
    // Regression test: chord backing used to piggyback on the click
    // loop, which only ever visits *integer* beat positions -- a
    // chord starting on a fractional beat (e.g. 2.25, completely
    // normal at 16th-note quantization) silently never played. Now
    // it's scheduled directly at its own precise beat position, one
    // full pickup bar after the count-in ends.
    playNoteForDuration.mockClear();
    const chords = [{ rootPitchClass: 0, quality: 'maj', start: 2.25, end: 3 }];
    const session = new RecordingSession({ tempo: FAST_TEMPO, mode: 'melody' });
    session.start({ chords, sectionLengthBeats: 20 });

    await wait(80); // past the count-in -- chord backing gets scheduled all at once right here
    expect(playNoteForDuration).toHaveBeenCalled();

    const secondsPerBeat = 60 / FAST_TEMPO;
    const COUNT_IN_BEATS = 4;
    const PICKUP_BEATS = 4;
    const expectedWhen = 0.05 + (COUNT_IN_BEATS + PICKUP_BEATS + 2.25) * secondsPerBeat;
    for (const [, , when] of playNoteForDuration.mock.calls) {
      expect(when).toBeCloseTo(expectedWhen, 10);
    }
  });

  it('restart() discards the in-progress take and begins a fresh count-in', async () => {
    const phases = [];
    const session = new RecordingSession({ tempo: FAST_TEMPO, mode: 'melody', onPhaseChange: (p) => phases.push(p) });
    session.start({ chords: [], sectionLengthBeats: 20 }); // comfortable margin before auto-finish -- see the auto-finish test above for why a short window here races
    await wait(80);
    expect(session.phase).toBe('capturing');
    session.handleMidiMessage({ timestamp: performance.now(), type: 'noteon', note: 60, velocity: 90 });

    session.restart();
    expect(session.phase).toBe('countIn');
    expect(session.bufferedMessages).toEqual([]); // the discarded take's message is gone

    await wait(80);
    expect(session.phase).toBe('capturing');
  });
});
