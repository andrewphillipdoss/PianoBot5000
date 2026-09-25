import { describe, expect, it } from 'vitest';
import { midiToFrequency } from './pianoSynth.js';

// The rest of pianoSynth.js talks directly to the real Web Audio API
// (AudioContext, OscillatorNode, GainNode), which jsdom/Vitest's test
// environment doesn't implement -- only this pure math is testable
// without a real browser. Everything else here is verified by ear.
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
