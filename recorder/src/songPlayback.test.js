import { describe, expect, it, vi } from 'vitest';
import { playClickAt, playNoteForDuration, stopAllNotes } from './pianoSynth.js';
import { playSong } from './songPlayback.js';

vi.mock('./pianoSynth.js', () => ({
  enableAudio: vi.fn(() => Promise.resolve()),
  getAudioContext: () => ({ currentTime: 0 }),
  playClickAt: vi.fn(() => ({ stop: vi.fn() })),
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
      chords: [{ beat: 0, duration_beats: 4, chord: 'Cadd9' }], // not a recognized shape
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

  it('does not click at all unless metronome is explicitly requested', async () => {
    playClickAt.mockClear();
    const chartData = {
      tempo: TEMPO,
      sections: [{ label: 'A', start_beat: 0, end_beat: 8 }],
      chords: [],
      melody: [],
    };
    await playSong(chartData);
    expect(playClickAt).not.toHaveBeenCalled();
  });

  it('clicks every half beat when metronome is on, strong on downbeats, weak on other beats, off on the eighth-note subdivision', async () => {
    playClickAt.mockClear();
    const chartData = {
      tempo: TEMPO,
      sections: [{ label: 'A', start_beat: 0, end_beat: 8 }], // 2 bars
      chords: [],
      melody: [],
    };
    await playSong(chartData, { metronome: true });

    // beats 0..7.5 in 0.5 steps = 16 clicks; downbeats at 0 and 4 (BEATS_PER_BAR).
    expect(playClickAt).toHaveBeenCalledTimes(16);
    const strengthsByBeat = Object.fromEntries(playClickAt.mock.calls.map(([when, strength], i) => [i * 0.5, strength]));
    expect(strengthsByBeat[0]).toBe('strong');
    expect(strengthsByBeat[4]).toBe('strong');
    expect(strengthsByBeat[1]).toBe('weak');
    expect(strengthsByBeat[2]).toBe('weak');
    expect(strengthsByBeat[0.5]).toBe('off');
    expect(strengthsByBeat[3.5]).toBe('off');
  });

  it('clicks a pickup note\'s lead-in too, not just from beat 0', async () => {
    playClickAt.mockClear();
    const chartData = {
      tempo: TEMPO,
      sections: [{ label: 'A', start_beat: 0, end_beat: 4 }],
      chords: [],
      melody: [{ beat: -2, duration_beats: 1, pitch: 72, velocity: 90 }],
    };
    await playSong(chartData, { metronome: true });

    const firstWhen = Math.min(...playClickAt.mock.calls.map(([when]) => when));
    expect(firstWhen).toBeCloseTo(ANCHOR, 10); // clicking starts at beat -2, the pickup's own start
  });

  it('cancels every not-yet-played click on stop(), not just held chord/melody notes', async () => {
    playClickAt.mockClear();
    const chartData = {
      tempo: 6000, // fast, so this test does not need to actually wait out a real song
      sections: [{ label: 'A', start_beat: 0, end_beat: 16 }],
      chords: [],
      melody: [],
    };
    const stop = await playSong(chartData, { metronome: true });
    const clickOscillators = playClickAt.mock.results.map((r) => r.value);
    expect(clickOscillators.length).toBeGreaterThan(0);

    stop();
    for (const osc of clickOscillators) {
      expect(osc.stop).toHaveBeenCalled();
    }
  });
});
