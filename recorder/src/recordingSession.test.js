import { describe, expect, it, vi } from 'vitest';
import { playClickAt, playNoteForDuration } from './pianoSynth.js';
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

describe('RecordingSession (open-ended chords take)', () => {
  it('goes idle -> countIn -> capturing -> done, buffering messages only while capturing', async () => {
    const phases = [];
    const session = new RecordingSession({ tempo: FAST_TEMPO, part: 'chords', onPhaseChange: (p) => phases.push(p) });

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

    await wait(60); // held well past dropAccidentalTouches' real-time minimum duration (40ms), not just this fake tempo's beat length
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

  it('anchors captureStartRealTime to the nominal count-in end, not to whenever the setTimeout callback happens to actually fire', async () => {
    // Regression test for a real bug: reading performance.now() fresh
    // inside the count-in's setTimeout callback means every captured
    // note's timestamp is offset by however late that callback actually
    // fired (ordinary setTimeout jitter, worse under any main-thread
    // contention) -- consistently enough, at a fine grid/fast tempo, to
    // land notes on the wrong side of their intended grid line. Anchoring
    // to start()'s own timestamp plus the nominal count-in duration
    // instead makes this immune to how late the callback actually runs.
    const startedAt = performance.now();
    const session = new RecordingSession({ tempo: FAST_TEMPO, part: 'chords' });
    session.start();
    await wait(80);
    expect(session.phase).toBe('capturing');

    const COUNT_IN_BEATS = 4;
    const secondsPerBeat = 60 / FAST_TEMPO;
    const expectedCaptureStart = startedAt + COUNT_IN_BEATS * secondsPerBeat * 1000;
    expect(session.captureStartRealTime).toBeCloseTo(expectedCaptureStart, 0);
  });

  it('count-in length follows a non-default time signature (3/4 -- one 3-beat bar, not 4)', async () => {
    const session = new RecordingSession({ tempo: FAST_TEMPO, part: 'chords', beatsPerBar: 3 });
    session.start();
    await wait(20); // less than a 3-beat (30ms) count-in
    expect(session.phase).toBe('countIn');
    await wait(30); // now well past 30ms total -- a 3-beat count-in should have already ended
    expect(session.phase).toBe('capturing');
  });

  it('cancel() stops everything and goes back to idle', async () => {
    const session = new RecordingSession({ tempo: FAST_TEMPO, part: 'chords' });
    session.start();
    await wait(80);
    expect(session.phase).toBe('capturing');
    session.cancel();
    expect(session.phase).toBe('idle');
  });

  it('stop() is a no-op outside the capturing phase', () => {
    const session = new RecordingSession({ tempo: FAST_TEMPO, part: 'chords' });
    session.start();
    expect(session.phase).toBe('countIn');
    session.stop(); // too early -- still counting in
    expect(session.phase).toBe('countIn');
  });

  it('an unrecognizable cluster is dropped, not treated as a failed take -- onDone still fires', async () => {
    let result = null;
    let errorCalled = false;
    const session = new RecordingSession({
      tempo: FAST_TEMPO,
      part: 'chords',
      onDone: (r) => {
        result = r;
      },
      onError: () => {
        errorCalled = true;
      },
    });
    session.start();
    await wait(80);
    expect(session.phase).toBe('capturing');

    // Two notes a whole step apart isn't a recognizable triad or 7th --
    // dropped as one skipped cluster, same as a stray melody note would
    // be, rather than failing this (otherwise chord-free) take.
    session.handleMidiMessage({ timestamp: performance.now(), type: 'noteon', note: 60, velocity: 90 });
    session.handleMidiMessage({ timestamp: performance.now(), type: 'noteon', note: 62, velocity: 90 });

    await wait(60); // held well past dropAccidentalTouches' real-time minimum duration (40ms), not just this fake tempo's beat length
    session.stop();

    expect(errorCalled).toBe(false);
    expect(result.chords).toEqual([]);
    expect(result.skippedClusterCount).toBe(1);
    expect(session.phase).toBe('done');
  });
});

describe('RecordingSession: any part can set the length, or record against it', () => {
  it('a melody take with no length yet runs open-ended -- no pickup bar, stop() ends it, and it sets the length', async () => {
    const pickupBarChanges = [];
    const session = new RecordingSession({ tempo: FAST_TEMPO, part: 'melody', onPickupBarChange: (p) => pickupBarChanges.push(p) });
    session.start();
    await wait(80);
    expect(session.phase).toBe('capturing');
    expect(session.isPickupBar).toBe(false);

    const t = performance.now();
    session.handleMidiMessage({ timestamp: t, type: 'noteon', note: 67, velocity: 90 });
    session.handleMidiMessage({ timestamp: t + 5, type: 'noteoff', note: 67, velocity: 0 });
    await wait(30);
    session.stop();

    expect(session.phase).toBe('done');
    expect(pickupBarChanges.every((p) => p === false)).toBe(true);
    expect(session.result.part).toBe('melody');
    expect(session.result.setsLength).toBe(true);
    expect(session.result.pickupBeats).toBe(0);
    expect(session.result.notes.map((n) => n.pitch)).toEqual([67]);
    expect(session.result.sectionLengthBeats).toBeGreaterThan(0);
  });

  it('a chords take against an existing length auto-finishes there, and never gets a pickup bar', async () => {
    let result = null;
    const session = new RecordingSession({ tempo: FAST_TEMPO, part: 'chords', onDone: (r) => (result = r) });
    session.start({ sectionLengthBeats: 16 });
    await wait(60);
    expect(session.phase).toBe('capturing');
    expect(session.isPickupBar).toBe(false);
    session.stop(); // a no-op on a fixed take -- it ends on its own
    expect(session.phase).toBe('capturing');

    await wait(200); // past 16 beats * 10ms
    expect(session.phase).toBe('done');
    expect(result.setsLength).toBe(false);
    expect(result.sectionLengthBeats).toBe(16);
  });
});

describe('RecordingSession metronome subdivision', () => {
  it('defaults to eighth notes -- a quiet "off" subdivision click between each beat', async () => {
    playClickAt.mockClear();
    const session = new RecordingSession({ tempo: FAST_TEMPO, part: 'chords' });
    session.start();
    await wait(40); // past the first schedule-ahead tick
    session.cancel();

    const strengths = playClickAt.mock.calls.map(([, strength]) => strength);
    expect(strengths).toContain('off');
  });

  it('quarter notes (metronomeSubdivisionsPerBeat: 1) never schedules a subdivision click', async () => {
    playClickAt.mockClear();
    const session = new RecordingSession({ tempo: FAST_TEMPO, part: 'chords', metronomeSubdivisionsPerBeat: 1 });
    session.start();
    await wait(40);
    session.cancel();

    const strengths = playClickAt.mock.calls.map(([, strength]) => strength);
    expect(strengths.length).toBeGreaterThan(0); // still clicking, just only on the beat
    expect(strengths).not.toContain('off');
    expect(strengths.every((s) => s === 'strong' || s === 'weak')).toBe(true);
  });
});

describe('RecordingSession (fixed-length melody take)', () => {
  it('auto-finishes after sectionLengthBeats and calls onDone', async () => {
    let doneResult = null;
    const session = new RecordingSession({
      tempo: FAST_TEMPO,
      part: 'melody',
      onDone: (result) => {
        doneResult = result;
      },
    });
    session.start({ sectionLengthBeats: 20 }); // 20 beats * 10ms = 200ms of capture -- long enough to leave real margin around the count-in and the message below

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
      part: 'melody',
      onPickupBarChange: (isPickupBar) => pickupBarChanges.push(isPickupBar),
    });
    session.start({ sectionLengthBeats: 20 });

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

  it('never signals a pickup bar at all when pickupBeats is 0', async () => {
    const pickupBarChanges = [];
    const session = new RecordingSession({
      tempo: FAST_TEMPO,
      part: 'melody',
      pickupBeats: 0,
      onPickupBarChange: (isPickupBar) => pickupBarChanges.push(isPickupBar),
    });
    session.start({ sectionLengthBeats: 20 });

    await wait(80); // past the count-in -- capturing has begun
    expect(session.phase).toBe('capturing');
    expect(session.isPickupBar).toBe(false);

    await wait(50); // well past where a pickup bar would have ended, had there been one
    expect(session.isPickupBar).toBe(false);
    expect(pickupBarChanges.every((v) => v === false)).toBe(true); // never once true
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
    const session = new RecordingSession({ tempo: FAST_TEMPO, part: 'melody' });
    session.start({ sectionLengthBeats: 20, backing: { chords } });

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

  it('plays the other lines back too -- a backing melody note lands on its own beat, after the pickup bar', async () => {
    playNoteForDuration.mockClear();
    const melody = [{ pitch: 72, velocity: 88, start: 1.5, end: 2 }];
    const session = new RecordingSession({ tempo: FAST_TEMPO, part: 'bassline' });
    session.start({ sectionLengthBeats: 20, backing: { melody } });
    session.cancel();

    const secondsPerBeat = 60 / FAST_TEMPO;
    expect(playNoteForDuration).toHaveBeenCalledWith(72, 88, expect.closeTo(0.05 + (4 + 4 + 1.5) * secondsPerBeat, 10), expect.any(Number));
  });

  it('restart() discards the in-progress take and begins a fresh count-in', async () => {
    const phases = [];
    const session = new RecordingSession({ tempo: FAST_TEMPO, part: 'melody', onPhaseChange: (p) => phases.push(p) });
    session.start({ sectionLengthBeats: 20 }); // comfortable margin before auto-finish -- see the auto-finish test above for why a short window here races
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
