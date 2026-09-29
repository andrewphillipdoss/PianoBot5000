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
    // Every gain node now gets its own `.events` log rather than one
    // shared array: connectRhodesPartials's tine partial schedules its
    // own short automation curve on its own gain node (see
    // pianoSynth.js), so "the master bus's own envelope calls" and "a
    // partial's own mix-level automation" would otherwise interleave
    // in one flat list. `createdGainNodes[0]` is always the master bus
    // -- both playNoteAt/playNoteForDuration create it before calling
    // connectRhodesPartials for the rest.
    const createdGainNodes = [];
    const oscillators = [];

    function makeGainNode() {
      const events = [];
      const gain = {
        get value() {
          throw new Error('playNoteForDuration must never read AudioParam.value -- see its own comment for why');
        },
        // Writing .value directly (not reading it back) is legitimate,
        // static usage -- pianoSynth.js does this for each partial's
        // fixed mix level, nothing to do with envelope automation.
        set value(_v) {},
        setValueAtTime(value, time) {
          events.push({ method: 'setValueAtTime', value, time });
          return gain;
        },
        linearRampToValueAtTime(value, time) {
          events.push({ method: 'linearRampToValueAtTime', value, time });
          return gain;
        },
        exponentialRampToValueAtTime(value, time) {
          events.push({ method: 'exponentialRampToValueAtTime', value, time });
          return gain;
        },
        cancelScheduledValues(time) {
          events.push({ method: 'cancelScheduledValues', time });
          return gain;
        },
      };
      const node = { gain, events, connect: () => {} };
      createdGainNodes.push(node);
      return node;
    }

    function makeOscillator() {
      const osc = { frequency: { setValueAtTime: () => osc }, connect: () => {}, start: vi.fn(), stop: vi.fn() };
      oscillators.push(osc);
      return osc;
    }

    const filters = [];
    function makeParam() {
      const events = [];
      return {
        events,
        get value() {
          throw new Error('scheduled voices must never read AudioParam.value');
        },
        set value(_v) {},
        setValueAtTime(value, time) {
          events.push({ method: 'setValueAtTime', value, time });
        },
        exponentialRampToValueAtTime(value, time) {
          events.push({ method: 'exponentialRampToValueAtTime', value, time });
        },
      };
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
      createDynamicsCompressor() {
        const plain = () => ({ value: 0 });
        return { threshold: plain(), knee: plain(), ratio: plain(), attack: plain(), release: plain(), connect: () => {} };
      }
      createBiquadFilter() {
        const filter = { type: null, Q: makeParam(), frequency: makeParam(), connect: () => {} };
        filters.push(filter);
        return filter;
      }
      resume() {
        return Promise.resolve();
      }
    }

    globalThis.window = { AudioContext: FakeAudioContext };
    return { createdGainNodes, oscillators, filters };
  }

  beforeEach(() => {
    vi.resetModules(); // pianoSynth.js's AudioContext is a lazily-created module singleton -- start fresh each test
  });

  afterEach(() => {
    delete globalThis.window;
  });

  it('schedules a fully analytic attack/decay/release envelope ending at true silence, never reading .value', async () => {
    const { createdGainNodes, oscillators } = installFakeAudioContext();
    const { enableAudio, playNoteForDuration } = await import('./pianoSynth.js');
    await enableAudio();

    expect(() => playNoteForDuration(60, 90, 1.0, 0.5)).not.toThrow();

    const master = createdGainNodes[0];
    expect(master.events[0]).toMatchObject({ method: 'setValueAtTime', value: 0, time: 1.0 });
    expect(master.events.map((e) => e.method)).toEqual([
      'setValueAtTime',
      'linearRampToValueAtTime', // attack
      'exponentialRampToValueAtTime', // decay
      'linearRampToValueAtTime', // release
    ]);

    const release = master.events.at(-1);
    expect(release.value).toBe(0); // true silence, not the old 0.0001 floor -- no truncation click when the oscillator stops

    for (let i = 1; i < master.events.length; i++) {
      expect(master.events[i].time).toBeGreaterThanOrEqual(master.events[i - 1].time); // a valid, strictly-forward automation curve
    }

    // Four partials (fundamental, octave, tine, tremolo), all starting
    // exactly at `when` and stopping only once the gain curve has
    // actually reached silence.
    expect(oscillators).toHaveLength(4);
    for (const osc of oscillators) {
      expect(osc.start).toHaveBeenCalledWith(1.0);
      expect(osc.stop.mock.calls[0][0]).toBeGreaterThan(release.time);
    }
  });

  it('inserts an explicit hold point before releasing when the note outlasts the decay', async () => {
    const { createdGainNodes } = installFakeAudioContext();
    const { enableAudio, playNoteForDuration } = await import('./pianoSynth.js');
    await enableAudio();

    playNoteForDuration(60, 90, 0, 2); // well longer than the ~0.6s decay
    expect(createdGainNodes[0].events.map((e) => e.method)).toEqual([
      'setValueAtTime',
      'linearRampToValueAtTime',
      'exponentialRampToValueAtTime',
      'setValueAtTime', // the hold point -- nothing to read back, its value is already known analytically
      'linearRampToValueAtTime',
    ]);
  });

  it("gives the tine/bark partial its own short decay, independent of how long the note is held", async () => {
    const { createdGainNodes } = installFakeAudioContext();
    const { enableAudio, playNoteForDuration } = await import('./pianoSynth.js');
    await enableAudio();

    playNoteForDuration(60, 90, 0, 2); // a long-held note -- the bark must still decay quickly, not track this duration
    // Creation order in connectRhodesPartials: master(0), fundamentalGain(1), octaveGain(2), tineGain(3), tremoloDepth(4).
    const tine = createdGainNodes[3];
    expect(tine.events.map((e) => e.method)).toEqual(['setValueAtTime', 'exponentialRampToValueAtTime']);
    const [peak, decayed] = tine.events;
    expect(decayed.time - peak.time).toBeLessThan(0.2);
  });

  it('bass guitar voice: a pluck that opens the filter and closes it again, then fades while held -- all analytic', async () => {
    const { createdGainNodes, oscillators, filters } = installFakeAudioContext();
    const { enableAudio, playBassForDuration } = await import('./pianoSynth.js');
    await enableAudio();

    expect(() => playBassForDuration(36, 100, 1.0, 1.5)).not.toThrow(); // C2, held well past the pluck

    const master = createdGainNodes[0];
    expect(master.events.map((e) => e.method)).toEqual([
      'setValueAtTime',
      'linearRampToValueAtTime', // attack
      'exponentialRampToValueAtTime', // the pluck settling into the body
      'exponentialRampToValueAtTime', // the slow fade while held
      'linearRampToValueAtTime', // the fingertip mute, down to true silence
    ]);
    expect(master.events.at(-1).value).toBe(0);
    for (let i = 1; i < master.events.length; i++) {
      expect(master.events[i].time).toBeGreaterThanOrEqual(master.events[i - 1].time);
    }
    expect(master.events[3].value).toBeLessThan(master.events[2].value); // still fading, never a flat sustain

    const [filter] = filters;
    expect(filter.type).toBe('lowpass');
    const [open, settled] = filter.frequency.events;
    expect(settled.value).toBeLessThan(open.value); // bright, then darker
    expect(settled.time - open.time).toBeLessThan(0.5);

    expect(oscillators.map((o) => o.type).sort()).toEqual(['sawtooth', 'sine']);
    for (const osc of oscillators) {
      expect(osc.start).toHaveBeenCalledWith(1.0);
      expect(osc.stop.mock.calls[0][0]).toBeGreaterThan(master.events.at(-1).time);
    }
  });

  it('bass guitar voice: a harder pluck is brighter', async () => {
    const { filters } = installFakeAudioContext();
    const { enableAudio, playBassForDuration } = await import('./pianoSynth.js');
    await enableAudio();
    playBassForDuration(36, 40, 0, 1);
    playBassForDuration(36, 120, 0, 1);
    expect(filters[1].frequency.events[0].value).toBeGreaterThan(filters[0].frequency.events[0].value);
  });
});
