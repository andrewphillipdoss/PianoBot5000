import { describe, expect, it } from 'vitest';
import { layoutMeasures } from './chordChartLayout.js';

const C = { rootPitchClass: 0, quality: 'maj' };
const F = { rootPitchClass: 5, quality: 'maj' };
const G = { rootPitchClass: 7, quality: 'maj' };

describe('layoutMeasures', () => {
  it('gives one measure per bar of the section, empty ones included', () => {
    const measures = layoutMeasures([{ ...C, start: 0, end: 4 }], { sectionLengthBeats: 16, beatsPerBar: 4 });
    expect(measures.map((m) => m.number)).toEqual([1, 2, 3, 4]);
    expect(measures.map((m) => m.startBeat)).toEqual([0, 4, 8, 12]);
    expect(measures.slice(1).every((m) => m.segments.length === 0)).toBe(true);
  });

  it('places each chord at the beat it lands on within its measure', () => {
    const f = { ...F, start: 4, end: 6 };
    const g = { ...G, start: 6, end: 8 };
    const [, second] = layoutMeasures([{ ...C, start: 0, end: 4 }, f, g], { sectionLengthBeats: 8 });
    expect(second.segments).toEqual([
      { chord: f, from: 0, to: 2, isStart: true },
      { chord: g, from: 2, to: 4, isStart: true },
    ]);
  });

  it('splits a chord held across a barline, naming it only where it starts', () => {
    const c = { ...C, start: 2, end: 10 };
    const measures = layoutMeasures([c], { sectionLengthBeats: 12 });
    expect(measures.map((m) => m.segments)).toEqual([
      [{ chord: c, from: 2, to: 4, isStart: true }],
      [{ chord: c, from: 0, to: 4, isStart: false }],
      [{ chord: c, from: 0, to: 2, isStart: false }],
    ]);
  });

  it('follows the time signature -- 3/4 bars are three beats', () => {
    const measures = layoutMeasures([{ ...C, start: 0, end: 3 }, { ...G, start: 3, end: 6 }], { sectionLengthBeats: 6, beatsPerBar: 3 });
    expect(measures).toHaveLength(2);
    expect(measures[1].segments[0]).toMatchObject({ from: 0, to: 3, isStart: true });
  });

  it('cuts off anything past the end of the section', () => {
    const measures = layoutMeasures([{ ...C, start: 0, end: 4 }, { ...G, start: 6, end: 12 }, { ...F, start: 8, end: 12 }], { sectionLengthBeats: 8 });
    expect(measures).toHaveLength(2);
    expect(measures[1].segments.map((s) => [s.chord.rootPitchClass, s.from, s.to])).toEqual([[7, 2, 4]]);
  });

  it('without a section length, makes just enough measures to hold every chord', () => {
    expect(layoutMeasures([{ ...C, start: 0, end: 9 }], { beatsPerBar: 4 })).toHaveLength(3);
    expect(layoutMeasures([], { beatsPerBar: 4 })).toHaveLength(1);
  });
});
