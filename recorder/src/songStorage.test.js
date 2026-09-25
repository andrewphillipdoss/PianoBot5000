import { describe, expect, it } from 'vitest';
import { buildChartData, chartFileName, formatRelativeTime, mergeConsecutiveChordEntries, slugify, summarizeChart } from './songStorage.js';

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
      quantization: 4, // not passed above -- defaults to 16th notes
      sections: [{ label: 'A', start_beat: 0, end_beat: 16 }],
      chords: [
        { beat: 0, duration_beats: 4, chord: 'C' },
        { beat: 4, duration_beats: 4, chord: 'G7' },
      ],
      melody: [{ beat: 0, duration_beats: 1, pitch: 60, velocity: 90 }],
    });
  });

  it('saves an explicitly chosen quantization instead of defaulting', () => {
    const chart = buildChartData({
      title: 'Amazing Grace',
      key: 'C',
      tempo: 76,
      quantization: 8, // 32nd notes
      sectionLabel: 'A',
      sectionLengthBeats: 16,
      chords: [],
      melody: [],
    });
    expect(chart.quantization).toBe(8);
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
