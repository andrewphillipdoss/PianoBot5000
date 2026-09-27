import { describe, expect, it } from 'vitest';
import {
  appendSectionData,
  buildChartData,
  chartFileName,
  emptyChartData,
  entrySectionLabel,
  formatRelativeTime,
  mergeConsecutiveChordEntries,
  nextSectionLabel,
  readChartBeatsPerBar,
  readChartQuantization,
  replaceSectionData,
  requantizeChartData,
  sectionBasslineAsInternal,
  sectionChordsAsInternal,
  sectionMelodyAsInternal,
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
      beatsPerBar: 4, // not passed above -- defaults to 4/4
      chordsQuantization: 2, // not passed above -- defaults to 8th notes
      melodyQuantization: 4, // not passed above -- defaults to 16th notes
      melodyQuantizeStrength: 0.6, // not passed above -- defaults to the softened snap
      melodyPickupBeats: 4, // not passed above -- defaults to a full pickup bar
      basslineQuantization: 4,
      basslineQuantizeStrength: 0.6,
      basslinePickupBeats: 4,
      metronomeSubdivisionsPerBeat: 2, // not passed above -- defaults to 8th notes
      sections: [{ label: 'A', start_beat: 0, end_beat: 16 }],
      chords: [
        { beat: 0, duration_beats: 4, chord: 'C', section: 'A' },
        { beat: 4, duration_beats: 4, chord: 'G7', section: 'A' },
      ],
      melody: [{ beat: 0, duration_beats: 1, pitch: 60, velocity: 90, section: 'A' }],
      bassline: [],
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
  it('reads separate chords/melody quantization fields, plus melody\'s quantize strength and pickup length', () => {
    expect(
      readChartQuantization({ chordsQuantization: 2, melodyQuantization: 8, melodyQuantizeStrength: 1, melodyPickupBeats: 0 })
    ).toEqual({
      chordsQuantization: 2,
      melodyQuantization: 8,
      melodyQuantizeStrength: 1,
      melodyPickupBeats: 0,
      basslineQuantization: 4,
      basslineQuantizeStrength: 0.6,
      basslinePickupBeats: 4,
      metronomeSubdivisionsPerBeat: 2,
    });
  });

  it('falls back to a single legacy quantization field for both, then to the current defaults', () => {
    expect(readChartQuantization({ quantization: 8 })).toEqual({
      chordsQuantization: 8,
      melodyQuantization: 8,
      melodyQuantizeStrength: 0.6,
      melodyPickupBeats: 4,
      basslineQuantization: 4,
      basslineQuantizeStrength: 0.6,
      basslinePickupBeats: 4,
      metronomeSubdivisionsPerBeat: 2,
    });
    expect(readChartQuantization({})).toEqual({
      chordsQuantization: 2,
      melodyQuantization: 4,
      melodyQuantizeStrength: 0.6,
      melodyPickupBeats: 4,
      basslineQuantization: 4,
      basslineQuantizeStrength: 0.6,
      basslinePickupBeats: 4,
      metronomeSubdivisionsPerBeat: 2,
    });
  });

  it('reads a saved metronome subdivision setting back', () => {
    expect(readChartQuantization({ metronomeSubdivisionsPerBeat: 1 }).metronomeSubdivisionsPerBeat).toBe(1);
  });

  it('reads bassline settings back, and falls back basslinePickupBeats to a full bar of the time signature', () => {
    expect(
      readChartQuantization({ basslineQuantization: 8, basslineQuantizeStrength: 1, basslinePickupBeats: 0 })
    ).toMatchObject({
      basslineQuantization: 8,
      basslineQuantizeStrength: 1,
      basslinePickupBeats: 0,
    });
    expect(readChartQuantization({ beatsPerBar: 3 }).basslinePickupBeats).toBe(3);
  });

  it('falls back melodyPickupBeats to a full bar of the chart\'s own (non-default) time signature', () => {
    expect(readChartQuantization({ beatsPerBar: 3 }).melodyPickupBeats).toBe(3);
  });
});

describe('readChartBeatsPerBar', () => {
  it('reads a saved time signature', () => {
    expect(readChartBeatsPerBar({ beatsPerBar: 3 })).toBe(3);
  });

  it('falls back to 4/4 for a chart saved before time signature existed', () => {
    expect(readChartBeatsPerBar({})).toBe(4);
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
      { beat: 0, duration_beats: 16, chord: 'C', section: 'A' },
      { beat: 16, duration_beats: 8, chord: 'F', section: 'B' }, // offset onto the chart's global timeline
    ]);
    expect(withB.melody).toEqual([
      { beat: 0, duration_beats: 1, pitch: 60, velocity: 90, section: 'A' },
      { beat: 16, duration_beats: 1, pitch: 64, velocity: 80, section: 'B' },
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
    // Tagged 'B' (not 'A') despite the numeric overlap -- it really is B's
    // pickup note, which is exactly the ambiguity the tag exists to resolve.
    expect(withB.melody).toEqual([{ beat: 14, duration_beats: 2, pitch: 72, velocity: 90, section: 'B' }]);
  });

  it('offsets bassline notes onto the global timeline the same way as melody', () => {
    const chartData = appendSectionData(emptyChartData({ title: 'T', key: 'C', tempo: 120 }), {
      sectionLabel: 'A',
      sectionLengthBeats: 16,
      chords: [],
      melody: [],
      bassline: [{ pitch: 36, start: 0, end: 4, velocity: 100 }],
    });
    const withB = appendSectionData(chartData, {
      sectionLabel: 'B',
      sectionLengthBeats: 8,
      chords: [],
      melody: [],
      bassline: [{ pitch: 41, start: 0, end: 4, velocity: 95 }],
    });
    expect(withB.bassline).toEqual([
      { beat: 0, duration_beats: 4, pitch: 36, velocity: 100, section: 'A' },
      { beat: 16, duration_beats: 4, pitch: 41, velocity: 95, section: 'B' },
    ]);
  });

  it('defaults bassline to an empty list for a song that never records one', () => {
    const chartData = appendSectionData(emptyChartData({ title: 'T', key: 'C', tempo: 120 }), {
      sectionLabel: 'A',
      sectionLengthBeats: 16,
      chords: [],
      melody: [],
    });
    expect(chartData.bassline).toEqual([]);
  });
});

describe('entrySectionLabel', () => {
  const sections = [
    { label: 'A', start_beat: 0, end_beat: 16 },
    { label: 'B', start_beat: 16, end_beat: 24 },
  ];

  it('uses the entry\'s own tag when present, regardless of its beat', () => {
    expect(entrySectionLabel({ beat: 14, section: 'B' }, sections)).toBe('B');
    expect(entrySectionLabel({ beat: 14, pitch: 60, section: 'B' }, sections)).toBe('B');
  });

  it('falls back to exact beat-range inference for an untagged (legacy) chord entry -- never widened, chords have no pickup concept', () => {
    expect(entrySectionLabel({ beat: 8, chord: 'C' }, sections)).toBe('A');
    expect(entrySectionLabel({ beat: 20, chord: 'G' }, sections)).toBe('B');
    // Regression: a chord genuinely in A's own last bar must stay A's,
    // not get pulled into B just because it's within one pickup-bar's
    // width of B's start -- that widening only ever applied to melody.
    expect(entrySectionLabel({ beat: 14, chord: 'C' }, sections)).toBe('A');
    expect(entrySectionLabel({ beat: 15.5, chord: 'C' }, sections)).toBe('A');
  });

  it('falls back to widened beat-range inference for an untagged (legacy) melody entry', () => {
    expect(entrySectionLabel({ beat: 8, pitch: 60 }, sections)).toBe('A');
    expect(entrySectionLabel({ beat: 20, pitch: 60 }, sections)).toBe('B');
  });

  it('resolves an ambiguous melody boundary beat (within one pickup bar of the earlier section\'s end) to the later section', () => {
    expect(entrySectionLabel({ beat: 14, pitch: 60 }, sections)).toBe('B'); // no tag -- genuinely ambiguous, resolved as B's pickup
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

    const expectedChords = internalChords.map((c) => ({ ...c, bassPitchClass: c.rootPitchClass })); // round-tripped through a plain (non-slash) symbol -- bass defaults to the root
    expect(sectionChordsAsInternal(withB, withB.sections[0])).toEqual(expectedChords);
    expect(sectionChordsAsInternal(withB, withB.sections[1])).toEqual(expectedChords);
  });

  it('drops a symbol it can\'t parse (e.g. a hand-edited file) instead of passing on a half-formed chord', () => {
    const chartData = {
      sections: [{ label: 'A', start_beat: 0, end_beat: 8 }],
      chords: [
        { beat: 0, duration_beats: 4, chord: 'C', section: 'A' },
        { beat: 4, duration_beats: 4, chord: 'Cadd11', section: 'A' },
      ],
    };
    expect(sectionChordsAsInternal(chartData, chartData.sections[0])).toEqual([{ rootPitchClass: 0, quality: 'maj', bassPitchClass: 0, start: 0, end: 4 }]);
  });
});

describe('sectionMelodyAsInternal / sectionBasslineAsInternal', () => {
  it('are the exact inverse of what appendSectionData does to a section\'s melody/bassline notes', () => {
    const internalMelody = [{ pitch: 60, start: 0, end: 1, velocity: 90 }];
    const internalBassline = [{ pitch: 36, start: 0, end: 2, velocity: 100 }];
    const chartData = appendSectionData(emptyChartData({ title: 'T', key: 'C', tempo: 120 }), {
      sectionLabel: 'A',
      sectionLengthBeats: 8,
      chords: [],
      melody: internalMelody,
      bassline: internalBassline,
    });
    const withB = appendSectionData(chartData, {
      sectionLabel: 'B',
      sectionLengthBeats: 8,
      chords: [],
      melody: internalMelody,
      bassline: internalBassline,
    });

    expect(sectionMelodyAsInternal(withB, withB.sections[1])).toEqual(internalMelody);
    expect(sectionBasslineAsInternal(withB, withB.sections[1])).toEqual(internalBassline);
  });

  it('returns an empty list for a chart that never recorded a bassline at all', () => {
    const chartData = appendSectionData(emptyChartData({ title: 'T', key: 'C', tempo: 120 }), {
      sectionLabel: 'A',
      sectionLengthBeats: 8,
      chords: [],
      melody: [],
    });
    expect(sectionBasslineAsInternal(chartData, chartData.sections[0])).toEqual([]);
  });
});

describe('replaceSectionData', () => {
  function twoSectionChart() {
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
    return chartData;
  }

  it('replaces the last section, leaving earlier sections and their chords/melody untouched', () => {
    const chartData = twoSectionChart();

    const replaced = replaceSectionData(chartData, 1, {
      sectionLengthBeats: 4, // a shorter re-take this time
      chords: [{ rootPitchClass: 9, quality: 'min', start: 0, end: 4 }],
      melody: [{ pitch: 69, start: 0, end: 2, velocity: 100 }],
    });

    expect(replaced.sections).toEqual([
      { label: 'A', start_beat: 0, end_beat: 16 }, // untouched
      { label: 'B', start_beat: 16, end_beat: 20 }, // re-recorded, kept its own label, new length
    ]);
    expect(replaced.chords).toEqual([
      { beat: 0, duration_beats: 16, chord: 'C', section: 'A' }, // A's chord, untouched
      { beat: 16, duration_beats: 4, chord: 'Am', section: 'B' }, // B's new chord
    ]);
    expect(replaced.melody).toEqual([
      { beat: 0, duration_beats: 1, pitch: 60, velocity: 90, section: 'A' }, // A's melody, untouched
      { beat: 16, duration_beats: 2, pitch: 69, velocity: 100, section: 'B' }, // B's new melody
    ]);
  });

  it('replaces bassline the same way, and defaults it to empty when not given (e.g. re-recording just chords/melody)', () => {
    let chartData = appendSectionData(emptyChartData({ title: 'T', key: 'C', tempo: 120 }), {
      sectionLabel: 'A',
      sectionLengthBeats: 16,
      chords: [],
      melody: [],
      bassline: [{ pitch: 36, start: 0, end: 4, velocity: 100 }],
    });

    const replaced = replaceSectionData(chartData, 0, {
      sectionLengthBeats: 16,
      chords: [],
      melody: [],
      bassline: [{ pitch: 41, start: 0, end: 4, velocity: 90 }],
    });
    expect(replaced.bassline).toEqual([{ beat: 0, duration_beats: 4, pitch: 41, velocity: 90, section: 'A' }]);

    const replacedNoBassline = replaceSectionData(chartData, 0, { sectionLengthBeats: 16, chords: [], melody: [] });
    expect(replacedNoBassline.bassline).toEqual([]); // the old bassline note is gone, not silently carried over -- callers preserve it themselves via sectionBasslineAsInternal if that's what they want
  });

  it('replaces an earlier section, shifting every later section\'s length/beats without touching earlier ones', () => {
    const chartData = twoSectionChart();

    const replaced = replaceSectionData(chartData, 0, {
      sectionLengthBeats: 20, // 4 beats longer than A's original 16
      chords: [{ rootPitchClass: 9, quality: 'min', start: 0, end: 20 }],
      melody: [{ pitch: 69, start: 0, end: 2, velocity: 100 }],
    });

    expect(replaced.sections).toEqual([
      { label: 'A', start_beat: 0, end_beat: 20 }, // re-recorded, kept its own label, new length
      { label: 'B', start_beat: 20, end_beat: 28 }, // pushed back by A's +4-beat delta
    ]);
    expect(replaced.chords).toEqual([
      { beat: 0, duration_beats: 20, chord: 'Am', section: 'A' }, // A's new chord
      { beat: 20, duration_beats: 8, chord: 'F', section: 'B' }, // B's original chord, shifted +4
    ]);
    expect(replaced.melody).toEqual([
      { beat: 0, duration_beats: 2, pitch: 69, velocity: 100, section: 'A' }, // A's new melody
      { beat: 20, duration_beats: 1, pitch: 64, velocity: 80, section: 'B' }, // B's original melody, shifted +4
    ]);
  });
});

describe('requantizeChartData', () => {
  it('re-snaps bassline the same way as chords/melody, and keeps its own quantization field', () => {
    const chartData = appendSectionData(emptyChartData({ title: 'T', key: 'C', tempo: 120 }), {
      sectionLabel: 'A',
      sectionLengthBeats: 8,
      chords: [],
      melody: [],
      bassline: [{ pitch: 36, start: 0.1, end: 3.9, velocity: 100 }],
    });

    const requantized = requantizeChartData(chartData, { chordsQuantization: 2, melodyQuantization: 4, basslineQuantization: 1 }); // 1 = quarter notes
    expect(requantized.basslineQuantization).toBe(1);
    expect(requantized.bassline).toEqual([{ beat: 0, duration_beats: 4, pitch: 36, velocity: 100, section: 'A' }]);
  });

  it('falls back basslineQuantization to the chart\'s own already-saved setting when not given', () => {
    const chartData = { ...emptyChartData({ title: 'T', key: 'C', tempo: 120 }), basslineQuantization: 8 };
    expect(requantizeChartData(chartData, { chordsQuantization: 2, melodyQuantization: 4 }).basslineQuantization).toBe(8);
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
