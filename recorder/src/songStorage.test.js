import { describe, expect, it } from 'vitest';
import {
  appendSectionData,
  buildChartData,
  chartFileName,
  emptyChartData,
  formatRelativeTime,
  mergeConsecutiveChordEntries,
  nextSectionLabel,
  readChartQuantization,
  replaceLastSectionData,
  sectionChordsAsInternal,
  slugify,
  summarizeChart,
} from './songStorage.js';

describe('slugify', () => {
  it('lowercases and dashes spaces/punctuation', () => {
    expect(slugify('Amazing Grace')).toBe('amazing-grace');
    expect(slugify("Why Can't We Be Friends?")).toBe('why-can-t-we-be-friends');
  });

  it('collapses runs of punctuation into one dash and trims leading/trailing dashes', () => {
    expect(slugify('  Hello -- World!!  ')).toBe('hello-world');
  });

  it('falls back to "untitled" for a title with nothing sluggable in it', () => {
    expect(slugify('***')).toBe('untitled');
    expect(slugify('')).toBe('untitled');
  });
});

describe('chartFileName', () => {
  it('appends .json to the slugified title', () => {
    expect(chartFileName('Amazing Grace')).toBe('amazing-grace.json');
  });
});

describe('mergeConsecutiveChordEntries', () => {
  it('merges adjacent identical chord symbols and extends the duration', () => {
    const chords = [
      { beat: 0, duration_beats: 4, chord: 'C' },
      { beat: 4, duration_beats: 4, chord: 'C' },
      { beat: 8, duration_beats: 4, chord: 'F' },
    ];
    expect(mergeConsecutiveChordEntries(chords)).toEqual([
      { beat: 0, duration_beats: 8, chord: 'C' },
      { beat: 8, duration_beats: 4, chord: 'F' },
    ]);
  });

  it('does not merge the same symbol coming back after something else played', () => {
    const chords = [
      { beat: 0, duration_beats: 4, chord: 'C' },
      { beat: 4, duration_beats: 4, chord: 'F' },
      { beat: 8, duration_beats: 4, chord: 'C' },
    ];
    expect(mergeConsecutiveChordEntries(chords)).toEqual(chords);
  });
});

describe('buildChartData', () => {
  it('builds the on-disk chart shape from internal chord/melody events', () => {
    const chart = buildChartData({
      title: 'Amazing Grace',
      key: 'C',
      tempo: 76,
      sectionLabel: 'A',
      sectionLengthBeats: 16,
      chords: [
        { rootPitchClass: 0, quality: 'maj', start: 0, end: 4 },
        { rootPitchClass: 7, quality: 'dom7', start: 4, end: 8 },
      ],
      melody: [{ pitch: 60, start: 0, end: 1, velocity: 90 }],
    });

    expect(chart).toEqual({
      title: 'Amazing Grace',
      key: 'C',
      tempo: 76,
      chordsQuantization: 2, // not passed above -- defaults to 8th notes
      melodyQuantization: 4, // not passed above -- defaults to 16th notes
      sections: [{ label: 'A', start_beat: 0, end_beat: 16 }],
      chords: [
        { beat: 0, duration_beats: 4, chord: 'C' },
        { beat: 4, duration_beats: 4, chord: 'G7' },
      ],
      melody: [{ beat: 0, duration_beats: 1, pitch: 60, velocity: 90 }],
    });
  });

  it('saves explicitly chosen quantization settings instead of defaulting', () => {
    const chart = buildChartData({
      title: 'Amazing Grace',
      key: 'C',
      tempo: 76,
      chordsQuantization: 4, // 16th notes
      melodyQuantization: 8, // 32nd notes
      sectionLabel: 'A',
      sectionLengthBeats: 16,
      chords: [],
      melody: [],
    });
    expect(chart.chordsQuantization).toBe(4);
    expect(chart.melodyQuantization).toBe(8);
  });
});

describe('readChartQuantization', () => {
  it('reads separate chords/melody quantization fields', () => {
    expect(readChartQuantization({ chordsQuantization: 2, melodyQuantization: 8 })).toEqual({
      chordsQuantization: 2,
      melodyQuantization: 8,
    });
  });

  it('falls back to a single legacy quantization field for both, then to the current defaults', () => {
    expect(readChartQuantization({ quantization: 8 })).toEqual({ chordsQuantization: 8, melodyQuantization: 8 });
    expect(readChartQuantization({})).toEqual({ chordsQuantization: 2, melodyQuantization: 4 });
  });
});

describe('nextSectionLabel', () => {
  it('labels sections A, B, C, ... in order recorded', () => {
    expect(nextSectionLabel(0)).toBe('A');
    expect(nextSectionLabel(1)).toBe('B');
    expect(nextSectionLabel(2)).toBe('C');
  });
});

describe('appendSectionData', () => {
  it('lays a second section onto the chart contiguously, right after the first', () => {
    const chartData = buildChartData({
      title: 'Two Sections',
      key: 'C',
      tempo: 120,
      sectionLabel: 'A',
      sectionLengthBeats: 16,
      chords: [{ rootPitchClass: 0, quality: 'maj', start: 0, end: 16 }],
      melody: [{ pitch: 60, start: 0, end: 1, velocity: 90 }],
    });

    const withB = appendSectionData(chartData, {
      sectionLabel: 'B',
      sectionLengthBeats: 8,
      chords: [{ rootPitchClass: 5, quality: 'maj', start: 0, end: 8 }], // section-relative -- starts at its OWN beat 0
      melody: [{ pitch: 64, start: 0, end: 1, velocity: 80 }],
    });

    expect(withB.sections).toEqual([
      { label: 'A', start_beat: 0, end_beat: 16 },
      { label: 'B', start_beat: 16, end_beat: 24 }, // starts exactly where A ends
    ]);
    expect(withB.chords).toEqual([
      { beat: 0, duration_beats: 16, chord: 'C' },
      { beat: 16, duration_beats: 8, chord: 'F' }, // offset onto the chart's global timeline
    ]);
    expect(withB.melody).toEqual([
      { beat: 0, duration_beats: 1, pitch: 60, velocity: 90 },
      { beat: 16, duration_beats: 1, pitch: 64, velocity: 80 },
    ]);
  });

  it('lands a pickup note (negative section-relative beat) in the tail of whatever section came before it', () => {
    const chartData = appendSectionData(emptyChartData({ title: 'T', key: 'C', tempo: 120 }), {
      sectionLabel: 'A',
      sectionLengthBeats: 16,
      chords: [],
      melody: [],
    });
    const withB = appendSectionData(chartData, {
      sectionLabel: 'B',
      sectionLengthBeats: 8,
      chords: [],
      melody: [{ pitch: 72, start: -2, end: 0, velocity: 90 }], // a pickup note leading into B
    });
    // -2 + startBeat(16) = 14 -- inside A's own numeric beat range, which is
    // exactly correct: that's really when it's played, leading into B's downbeat.
    expect(withB.melody).toEqual([{ beat: 14, duration_beats: 2, pitch: 72, velocity: 90 }]);
  });
});

describe('sectionChordsAsInternal', () => {
  it('is the exact inverse of what appendSectionData does to a section\'s chords', () => {
    const internalChords = [
      { rootPitchClass: 5, quality: 'maj', start: 0, end: 4 },
      { rootPitchClass: 0, quality: 'min7', start: 4, end: 8 },
    ];
    const chartData = appendSectionData(emptyChartData({ title: 'T', key: 'C', tempo: 120 }), {
      sectionLabel: 'A',
      sectionLengthBeats: 8,
      chords: internalChords,
      melody: [],
    });
    // Give it a real offset (a non-zero start_beat) by appending a second section too, then read the FIRST section's chords back.
    const withB = appendSectionData(chartData, { sectionLabel: 'B', sectionLengthBeats: 8, chords: internalChords, melody: [] });

    expect(sectionChordsAsInternal(withB, withB.sections[0])).toEqual(internalChords);
    expect(sectionChordsAsInternal(withB, withB.sections[1])).toEqual(internalChords);
  });
});

describe('replaceLastSectionData', () => {
  it('replaces only the last section, leaving earlier sections and their chords/melody untouched', () => {
    let chartData = buildChartData({
      title: 'T',
      key: 'C',
      tempo: 120,
      sectionLabel: 'A',
      sectionLengthBeats: 16,
      chords: [{ rootPitchClass: 0, quality: 'maj', start: 0, end: 16 }],
      melody: [{ pitch: 60, start: 0, end: 1, velocity: 90 }],
    });
    chartData = appendSectionData(chartData, {
      sectionLabel: 'B',
      sectionLengthBeats: 8,
      chords: [{ rootPitchClass: 5, quality: 'maj', start: 0, end: 8 }],
      melody: [{ pitch: 64, start: 0, end: 1, velocity: 80 }],
    });

    const replaced = replaceLastSectionData(chartData, {
      sectionLengthBeats: 4, // a shorter re-take this time
      chords: [{ rootPitchClass: 9, quality: 'min', start: 0, end: 4 }],
      melody: [{ pitch: 69, start: 0, end: 2, velocity: 100 }],
    });

    expect(replaced.sections).toEqual([
      { label: 'A', start_beat: 0, end_beat: 16 }, // untouched
      { label: 'B', start_beat: 16, end_beat: 20 }, // re-recorded, kept its own label, new length
    ]);
    expect(replaced.chords).toEqual([
      { beat: 0, duration_beats: 16, chord: 'C' }, // A's chord, untouched
      { beat: 16, duration_beats: 4, chord: 'Am' }, // B's new chord
    ]);
    expect(replaced.melody).toEqual([
      { beat: 0, duration_beats: 1, pitch: 60, velocity: 90 }, // A's melody, untouched
      { beat: 16, duration_beats: 2, pitch: 69, velocity: 100 }, // B's new melody
    ]);
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-09-25T12:00:00Z').getTime();

  it('formats recent times as "just now"', () => {
    expect(formatRelativeTime(now - 5000, now)).toBe('just now');
  });

  it('formats minutes/hours/days/weeks/months', () => {
    expect(formatRelativeTime(now - 5 * 60 * 1000, now)).toBe('5 minutes ago');
    expect(formatRelativeTime(now - 3 * 60 * 60 * 1000, now)).toBe('3 hours ago');
    expect(formatRelativeTime(now - 2 * 24 * 60 * 60 * 1000, now)).toBe('2 days ago');
    expect(formatRelativeTime(now - 14 * 24 * 60 * 60 * 1000, now)).toBe('2 weeks ago');
    expect(formatRelativeTime(now - 60 * 24 * 60 * 60 * 1000, now)).toBe('2 months ago');
  });

  it('uses singular units correctly', () => {
    expect(formatRelativeTime(now - 60 * 1000, now)).toBe('1 minute ago');
    expect(formatRelativeTime(now - 24 * 60 * 60 * 1000, now)).toBe('1 day ago');
  });
});

describe('summarizeChart', () => {
  it('extracts the song-list summary from chart JSON', () => {
    const now = new Date('2026-09-25T12:00:00Z').getTime();
    const chartData = {
      title: 'Amazing Grace',
      key: 'C',
      tempo: 76,
      sections: [{ label: 'A', start_beat: 0, end_beat: 16 }],
      chords: [],
      melody: [],
    };
    expect(summarizeChart(chartData, now - 2 * 24 * 60 * 60 * 1000, now)).toEqual({
      title: 'Amazing Grace',
      key: 'C',
      tempo: 76,
      sectionLabels: ['A'],
      updatedAtMs: now - 2 * 24 * 60 * 60 * 1000,
      updatedAt: '2 days ago',
    });
  });
});
