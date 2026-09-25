import { describe, expect, it, vi } from 'vitest';
import { playNoteForDuration, stopAllNotes } from './pianoSynth.js';
import { playSong } from './songPlayback.js';

vi.mock('./pianoSynth.js', () => ({
  enableAudio: vi.fn(() => Promise.resolve()),
  getAudioContext: () => ({ currentTime: 0 }),
  playNoteForDuration: vi.fn(),
  stopAllNotes: vi.fn(),
}));

const TEMPO = 120;
const SPB = 60 / TEMPO;
const ANCHOR = 0.05; // getAudioContext().currentTime (0) + the 0.05s safety margin playSong adds

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('playSong', () => {
  it('schedules both chords (parsed back from their saved symbols) and melody notes at their correct audio times', async () => {
    playNoteForDuration.mockClear();
    const chartData = {
      tempo: TEMPO,
      sections: [{ label: 'A', start_beat: 0, end_beat: 8 }],
      chords: [{ beat: 0, duration_beats: 4, chord: 'C' }],
      melody: [{ beat: 2, duration_beats: 1, pitch: 67, velocity: 90 }],
    };
    await playSong(chartData);

    // The chord's three voiced pitches -- C major (root pitch class 0) -- all land at beat 0.
    const chordCalls = playNoteForDuration.mock.calls.filter(([pitch]) => [48, 52, 55].includes(pitch));
    expect(chordCalls).toHaveLength(3);
    for (const [, , when] of chordCalls) {
      expect(when).toBeCloseTo(ANCHOR + 0 * SPB, 10);
    }

    // The melody note (G4, pitch 67) lands at beat 2.
    const melodyCall = playNoteForDuration.mock.calls.find(([pitch]) => pitch === 67);
    expect(melodyCall).toBeDefined();
    expect(melodyCall[1]).toBe(90); // velocity carried through as-is
    expect(melodyCall[2]).toBeCloseTo(ANCHOR + 2 * SPB, 10);
  });

  it('starts from a pickup note (negative beat) rather than clipping it', async () => {
    playNoteForDuration.mockClear();
    const chartData = {
      tempo: TEMPO,
      sections: [{ label: 'A', start_beat: 0, end_beat: 8 }],
      chords: [],
      melody: [{ beat: -2, duration_beats: 1, pitch: 72, velocity: 90 }],
    };
    await playSong(chartData);

    const melodyCall = playNoteForDuration.mock.calls.find(([pitch]) => pitch === 72);
    expect(melodyCall).toBeDefined();
    // startBeat is -2 (the pickup note itself), so it plays right at the anchor time, not 2 beats into it.
    expect(melodyCall[2]).toBeCloseTo(ANCHOR, 10);
  });

  it('skips a chord symbol it cannot parse instead of throwing', async () => {
    playNoteForDuration.mockClear();
    const chartData = {
      tempo: TEMPO,
      sections: [{ label: 'A', start_beat: 0, end_beat: 4 }],
      chords: [{ beat: 0, duration_beats: 4, chord: 'Csus4' }], // not a recognized shape
      melody: [],
    };
    await expect(playSong(chartData)).resolves.not.toThrow();
    expect(playNoteForDuration).not.toHaveBeenCalled();
  });

  it('stop() silences everything and cancels the pending onDone', async () => {
    stopAllNotes.mockClear();
    let doneCalled = false;
    const chartData = {
      tempo: 6000, // fast, so this test does not need to actually wait out a real song
      sections: [{ label: 'A', start_beat: 0, end_beat: 4 }],
      chords: [],
      melody: [{ beat: 0, duration_beats: 4, pitch: 60, velocity: 90 }],
    };
    const stop = await playSong(chartData, { onDone: () => { doneCalled = true; } });
    stop();
    expect(stopAllNotes).toHaveBeenCalled();

    await wait(50); // well past when onDone would have fired had stop() not cancelled it
    expect(doneCalled).toBe(false);
  });
});
