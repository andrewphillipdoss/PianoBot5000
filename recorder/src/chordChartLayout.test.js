import { describe, expect, it } from 'vitest';
import { chordBarWidthStyle, layoutChordChartRows } from './chordChartLayout.js';

describe('layoutChordChartRows', () => {
  it('keeps a short section on one row', () => {
    const chords = [{ start: 0, end: 4 }, { start: 4, end: 8 }]; // 1 bar + 1 bar = 2 bars, well under the 8-bar cap
    expect(layoutChordChartRows(chords)).toEqual([chords]);
  });

  it('splits onto a new row once the next chord would push a row past maxBarsPerRow', () => {
    // 4 bars + 4 bars + 4 bars = 12 bars total; capped at 8 bars/row -> first two fill row 1, the third starts row 2.
    const a = { start: 0, end: 16 };
    const b = { start: 16, end: 32 };
    const c = { start: 32, end: 48 };
    expect(layoutChordChartRows([a, b, c], { maxBarsPerRow: 8 })).toEqual([[a, b], [c]]);
  });

  it('gives a single chord longer than a full row its own row rather than splitting it', () => {
    const tooLong = { start: 0, end: 40 }; // 10 bars, longer than the 8-bar cap
    const next = { start: 40, end: 44 };
    expect(layoutChordChartRows([tooLong, next], { maxBarsPerRow: 8 })).toEqual([[tooLong], [next]]);
  });

  it('supports the on-disk {duration_beats} shape via the durationBeats accessor default', () => {
    const chords = [
      { beat: 0, duration_beats: 16 },
      { beat: 16, duration_beats: 16 },
      { beat: 32, duration_beats: 16 },
    ];
    expect(layoutChordChartRows(chords, { maxBarsPerRow: 8 })).toEqual([[chords[0], chords[1]], [chords[2]]]);
  });
});

describe('chordBarWidthStyle', () => {
  it('sizes a chord relative to a full row\'s capacity, not its own row\'s total', () => {
    // A 2-bar chord in an 8-bar-max row is 25% width, regardless of what else shares its row.
    expect(chordBarWidthStyle({ start: 0, end: 8 }, { maxBarsPerRow: 8 })).toEqual({ width: '25%' });
  });

  it('makes a chord twice as wide as one half its duration', () => {
    const half = chordBarWidthStyle({ start: 0, end: 2 }, { maxBarsPerRow: 8 });
    const whole = chordBarWidthStyle({ start: 0, end: 4 }, { maxBarsPerRow: 8 });
    const double = chordBarWidthStyle({ start: 0, end: 8 }, { maxBarsPerRow: 8 });
    expect(parseFloat(whole.width)).toBeCloseTo(parseFloat(half.width) * 2, 10);
    expect(parseFloat(double.width)).toBeCloseTo(parseFloat(whole.width) * 2, 10);
  });
});
