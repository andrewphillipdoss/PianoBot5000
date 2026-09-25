import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { midiToFrequency } from './pianoSynth.js';

// The rest of pianoSynth.js talks directly to the real Web Audio API
// (AudioContext, OscillatorNode, GainNode), which this project's test
// environment (plain Node, no jsdom) doesn't implement -- everything
// here beyond this pure math is otherwise verified by ear. The
// playNoteForDuration suite below is the one exception: it stubs just
// enough of the Web Audio surface (a fake `window.AudioContext`) to
// verify the actual sequence of automation calls it schedules, which
// is exactly what the click/pop fix depends on being right.
describe('midiToFrequency', () => {
  it('tunes A4 (MIDI 69) to 440Hz, the standard reference pitch', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 5);
  });

  it('doubles frequency exactly one octave up', () => {
    expect(midiToFrequency(81)).toBeCloseTo(880, 5); // A5
  });

  it('halves frequency exactly one octave down', () => {
    expect(midiToFrequency(57)).toBeCloseTo(220, 5); // A3
  });

  it('gets middle C (MIDI 60) right', () => {
    expect(midiToFrequency(60)).toBeCloseTo(261.63, 2);
  });
});

describe('playNoteForDuration', () => {
  // A minimal fake of just the Web Audio surface pianoSynth.js touches.
  // The gain param's `.value` getter throws on read -- reading it is
  // exactly the stale-value bug playNoteForDuration exists to avoid
  // (see pianoSynth.js's own comment on it), so any test here failing
  // with that error means the fix regressed, not that the fake is
  // incomplete.
  function installFakeAudioContext() {
    const gainEvents = [];
    const oscillators = [];

    function makeGainNode() {
      const gain = {
        get value() {
          throw new Error('playNoteForDuration must never read AudioParam.value -- see its own comment for why');
        },
        // Writing .value directly (not reading it back) is legitimate,
        // static usage -- pianoSynth.js does this for each harmonic's
        // fixed mix level, nothing to do with envelope automation.
        set value(_v) {},
        setValueAtTime(value, time) {
          gainEvents.push({ method: 'setValueAtTime', value, time });
          return gain;
        },
        linearRampToValueAtTime(value, time) {
          gainEvents.push({ method: 'linearRampToValueAtTime', value, time });
          return gain;
        },
        exponentialRampToValueAtTime(value, time) {
          gainEvents.push({ method: 'exponentialRampToValueAtTime', value, time });
          return gain;
        },
        cancelScheduledValues(time) {
          gainEvents.push({ method: 'cancelScheduledValues', time });
          return gain;
        },
      };
      return { gain, connect: () => {} };
    }

    function makeOscillator() {
      const osc = { frequency: { setValueAtTime: () => osc }, connect: () => {}, start: vi.fn(), stop: vi.fn() };
      oscillators.push(osc);
      return osc;
    }

    class FakeAudioContext {
      constructor() {
        this.currentTime = 0;
        this.destination = {};
      }
      createGain() {
        return makeGainNode();
      }
      createOscillator() {
        return makeOscillator();
      }
      resume() {
        return Promise.resolve();
      }
    }

    globalThis.window = { AudioContext: FakeAudioContext };
    return { gainEvents, oscillators };
  }

  beforeEach(() => {
    vi.resetModules(); // pianoSynth.js's AudioContext is a lazily-created module singleton -- start fresh each test
  });

  afterEach(() => {
    delete globalThis.window;
  });

  it('schedules a fully analytic attack/decay/release envelope ending at true silence, never reading .value', async () => {
    const { gainEvents, oscillators } = installFakeAudioContext();
    const { enableAudio, playNoteForDuration } = await import('./pianoSynth.js');
    await enableAudio();

    expect(() => playNoteForDuration(60, 90, 1.0, 0.5)).not.toThrow();

    expect(gainEvents[0]).toMatchObject({ method: 'setValueAtTime', value: 0, time: 1.0 });
    expect(gainEvents.map((e) => e.method)).toEqual([
      'setValueAtTime',
      'linearRampToValueAtTime', // attack
      'exponentialRampToValueAtTime', // decay
      'linearRampToValueAtTime', // release
    ]);

    const release = gainEvents.at(-1);
    expect(release.value).toBe(0); // true silence, not the old 0.0001 floor -- no truncation click when the oscillator stops

    for (let i = 1; i < gainEvents.length; i++) {
      expect(gainEvents[i].time).toBeGreaterThanOrEqual(gainEvents[i - 1].time); // a valid, strictly-forward automation curve
    }

    // One oscillator per harmonic, all starting exactly at `when` and
    // stopping only once the gain curve has actually reached silence.
    expect(oscillators).toHaveLength(3);
    for (const osc of oscillators) {
      expect(osc.start).toHaveBeenCalledWith(1.0);
      expect(osc.stop.mock.calls[0][0]).toBeGreaterThan(release.time);
    }
  });

  it('inserts an explicit hold point before releasing when the note outlasts the decay', async () => {
    const { gainEvents } = installFakeAudioContext();
    const { enableAudio, playNoteForDuration } = await import('./pianoSynth.js');
    await enableAudio();

    playNoteForDuration(60, 90, 0, 2); // well longer than the ~0.6s decay
    expect(gainEvents.map((e) => e.method)).toEqual([
      'setValueAtTime',
      'linearRampToValueAtTime',
      'exponentialRampToValueAtTime',
      'setValueAtTime', // the hold point -- nothing to read back, its value is already known analytically
      'linearRampToValueAtTime',
    ]);
  });
});
