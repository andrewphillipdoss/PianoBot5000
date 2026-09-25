import { describe, expect, it } from 'vitest';
import {
  clusterOnsets,
  detectChordQuality,
  detectChords,
  formatChordSymbol,
  mergeConsecutiveChords,
  messagesToNotes,
  midiNoteName,
  parseChordSymbol,
  quantizeBeat,
  quantizeNotes,
  roundToBarInterval,
  secondsToBeats,
  trimTrailingEmptyBars,
  voiceChordSimple,
} from './theory.js';

describe('formatChordSymbol', () => {
  it('writes a major triad as just the root letter', () => {
    expect(formatChordSymbol(0, 'maj')).toBe('C');
  });

  it('writes minor/diminished/augmented with their usual suffixes', () => {
    expect(formatChordSymbol(0, 'min')).toBe('Cm');
    expect(formatChordSymbol(6, 'dim')).toBe('F#dim');
    expect(formatChordSymbol(4, 'aug')).toBe('Eaug');
  });

  it('writes 7th chords with their usual suffixes', () => {
    expect(formatChordSymbol(7, 'dom7')).toBe('G7');
    expect(formatChordSymbol(0, 'maj7')).toBe('Cmaj7');
    expect(formatChordSymbol(0, 'min7')).toBe('Cm7');
    expect(formatChordSymbol(11, 'm7b5')).toBe('Bm7b5');
    expect(formatChordSymbol(0, 'dim7')).toBe('Cdim7');
    expect(formatChordSymbol(0, 'minMaj7')).toBe('Cm(maj7)');
  });
});

describe('parseChordSymbol', () => {
  it('is the exact inverse of formatChordSymbol for every recognized quality, at every root', () => {
    const qualities = ['maj', 'min', 'dim', 'aug', 'dom7', 'maj7', 'min7', 'm7b5', 'dim7', 'minMaj7'];
    for (let root = 0; root < 12; root++) {
      for (const quality of qualities) {
        const symbol = formatChordSymbol(root, quality);
        expect(parseChordSymbol(symbol)).toEqual({ rootPitchClass: root, quality });
      }
    }
  });

  it('returns null for a symbol that is not one of this app\'s own recognized shapes', () => {
    expect(parseChordSymbol('Csus4')).toBeNull();
    expect(parseChordSymbol('H')).toBeNull(); // not a real note letter
    expect(parseChordSymbol('')).toBeNull();
  });
});

describe('midiNoteName', () => {
  it('names middle C (60) as C4, per MIDI convention', () => {
    expect(midiNoteName(60)).toBe('C4');
  });

  it('names other pitches correctly, sharps only', () => {
    expect(midiNoteName(61)).toBe('C#4');
    expect(midiNoteName(69)).toBe('A4'); // concert A
    expect(midiNoteName(21)).toBe('A0'); // lowest note on an 88-key piano
    expect(midiNoteName(108)).toBe('C8'); // highest note on an 88-key piano
  });
});

describe('detectChordQuality', () => {
  it('recognizes a root-position major triad', () => {
    expect(detectChordQuality([0, 4, 7])).toEqual({ rootPitchClass: 0, quality: 'maj' });
  });

  it('recognizes the same triad in any inversion (pitch classes only)', () => {
    // E-G-C (1st inversion of C major) -- same pitch class set as C-E-G.
    expect(detectChordQuality([4, 7, 0])).toEqual({ rootPitchClass: 0, quality: 'maj' });
  });

  it('recognizes minor, diminished, and augmented triads', () => {
    expect(detectChordQuality([9, 0, 4])).toEqual({ rootPitchClass: 9, quality: 'min' }); // A minor
    expect(detectChordQuality([11, 2, 5])).toEqual({ rootPitchClass: 11, quality: 'dim' }); // B diminished
    // augmented is ambiguous by pitch class alone -- covered by its own test below.
  });

  it('returns null for a set that is not a recognizable triad', () => {
    expect(detectChordQuality([0, 1, 2])).toBeNull(); // not a triad shape at all
    expect(detectChordQuality([0, 4])).toBeNull(); // only 2 distinct pitch classes
  });

  it('uses the bass note to resolve an augmented triad\'s inherent symmetry', () => {
    // {0, 4, 8} is a C augmented triad -- but by pure interval pattern,
    // 4 and 8 are equally valid "roots" of the same pitch-class set.
    const bassC = detectChordQuality([0, 4, 8], 0);
    const bassE = detectChordQuality([0, 4, 8], 4);
    expect(bassC.rootPitchClass).toBe(0);
    expect(bassE.rootPitchClass).toBe(4);
  });

  it('recognizes dominant, major, and minor 7th chords (4 distinct pitch classes)', () => {
    expect(detectChordQuality([0, 4, 7, 10])).toEqual({ rootPitchClass: 0, quality: 'dom7' }); // C7
    expect(detectChordQuality([0, 4, 7, 11])).toEqual({ rootPitchClass: 0, quality: 'maj7' }); // Cmaj7
    expect(detectChordQuality([0, 3, 7, 10])).toEqual({ rootPitchClass: 0, quality: 'min7' }); // Cm7
  });

  it('recognizes half-diminished and diminished 7th chords', () => {
    expect(detectChordQuality([11, 2, 5, 9])).toEqual({ rootPitchClass: 11, quality: 'm7b5' }); // Bm7b5
    expect(detectChordQuality([0, 3, 6, 9])).toEqual({ rootPitchClass: 0, quality: 'dim7' });
  });

  it("uses the bass note to resolve a diminished 7th's inherent (4-way) symmetry", () => {
    // {0, 3, 6, 9} is fully symmetric -- every one of its 4 notes is an
    // equally valid root by pure interval pattern alone.
    expect(detectChordQuality([0, 3, 6, 9], 0).rootPitchClass).toBe(0);
    expect(detectChordQuality([0, 3, 6, 9], 3).rootPitchClass).toBe(3);
    expect(detectChordQuality([0, 3, 6, 9], 6).rootPitchClass).toBe(6);
    expect(detectChordQuality([0, 3, 6, 9], 9).rootPitchClass).toBe(9);
  });

  it('returns null for 4 distinct pitch classes that are not a recognized 7th chord', () => {
    expect(detectChordQuality([0, 1, 2, 3])).toBeNull();
  });

  it('returns null for 5 or more distinct pitch classes (outside this app\'s recognized vocabulary)', () => {
    expect(detectChordQuality([0, 2, 4, 7, 10])).toBeNull();
  });
});

describe('voiceChordSimple', () => {
  it('stacks a major triad from the root', () => {
    expect(voiceChordSimple(0, 'maj')).toEqual([48, 52, 55]); // C3, E3, G3
  });

  it('stacks a dominant 7th (4 notes)', () => {
    expect(voiceChordSimple(7, 'dom7')).toEqual([55, 59, 62, 65]); // G3, B3, D4, F4
  });

  it('returns an empty voicing for an unrecognized quality', () => {
    expect(voiceChordSimple(0, 'nonsense')).toEqual([]);
  });
});

describe('quantizeBeat', () => {
  it('snaps onto the nearest grid point for a given subdivision', () => {
    expect(quantizeBeat(4.3, 2)).toBe(4.5); // 8th notes
    expect(quantizeBeat(4.3, 4)).toBe(4.25); // 16th notes
    expect(quantizeBeat(4.3, 8)).toBe(4.25); // 32nd notes (4.3 is nearer 4.25 than 4.375)
  });
});

describe('quantizeNotes', () => {
  it('snaps start/end onto the nearest 16th-note grid point', () => {
    const notes = [{ pitch: 60, start: 0.06, end: 0.97, velocity: 90 }];
    const [snapped] = quantizeNotes(notes, 4);
    expect(snapped.start).toBeCloseTo(0.0);
    expect(snapped.end).toBeCloseTo(1.0);
  });

  it('never collapses a note to zero length', () => {
    const notes = [{ pitch: 60, start: 1.01, end: 1.03, velocity: 90 }];
    const [snapped] = quantizeNotes(notes, 4);
    expect(snapped.end).toBeGreaterThan(snapped.start);
  });
});

describe('clusterOnsets', () => {
  it('groups near-simultaneous notes and separates distant ones', () => {
    const notes = [
      { pitch: 60, start: 0.0, end: 1.0 },
      { pitch: 64, start: 0.02, end: 1.0 },
      { pitch: 67, start: 0.03, end: 1.0 },
      { pitch: 65, start: 1.0, end: 2.0 },
    ];
    const clusters = clusterOnsets(notes, 0.05);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toHaveLength(3);
    expect(clusters[1]).toHaveLength(1);
  });

  it('anchors to the cluster\'s first note, not the most recent one (no drift on a slow roll)', () => {
    // Each note is 0.04 beats after the last -- under threshold pairwise,
    // but the 4th note is 0.12 beats from the *first* note, over a 0.1 threshold.
    const notes = [
      { pitch: 60, start: 0.0, end: 1.0 },
      { pitch: 64, start: 0.04, end: 1.0 },
      { pitch: 67, start: 0.08, end: 1.0 },
      { pitch: 72, start: 0.12, end: 1.0 },
    ];
    const clusters = clusterOnsets(notes, 0.1);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toHaveLength(3);
  });
});

describe('detectChords', () => {
  it('turns a clean triad cluster into one ChordEvent spanning the cluster', () => {
    const notes = [
      { pitch: 48, start: 0.0, end: 4.0 }, // C3
      { pitch: 52, start: 0.01, end: 3.9 }, // E3
      { pitch: 55, start: 0.02, end: 4.0 }, // G3
    ];
    const [chord] = detectChords(notes, 0.05);
    expect(chord).toEqual({ rootPitchClass: 0, quality: 'maj', start: 0.0, end: 4.0 });
  });

  it('turns a clean 7th-chord cluster (4 notes) into one ChordEvent', () => {
    const notes = [
      { pitch: 43, start: 4.0, end: 8.0 }, // G2
      { pitch: 47, start: 4.0, end: 8.0 }, // B2
      { pitch: 50, start: 4.0, end: 8.0 }, // D3
      { pitch: 53, start: 4.0, end: 7.9 }, // F3
    ];
    const [chord] = detectChords(notes, 0.05);
    expect(chord).toEqual({ rootPitchClass: 7, quality: 'dom7', start: 4.0, end: 8.0 }); // G7
  });

  it('throws with the beat position and pitches for an unrecognizable cluster', () => {
    const notes = [
      { pitch: 48, start: 2.0, end: 3.0 },
      { pitch: 49, start: 2.0, end: 3.0 },
      { pitch: 50, start: 2.0, end: 3.0 },
    ];
    expect(() => detectChords(notes, 0.05)).toThrow(/beat 2\.00/);
  });
});

describe('mergeConsecutiveChords', () => {
  it('merges adjacent identical chords into one, extended entry', () => {
    const chords = [
      { rootPitchClass: 0, quality: 'maj', start: 0, end: 4 }, // C
      { rootPitchClass: 0, quality: 'maj', start: 4, end: 8 }, // C again -- re-struck, not a real change
      { rootPitchClass: 5, quality: 'maj', start: 8, end: 12 }, // F
    ];
    expect(mergeConsecutiveChords(chords)).toEqual([
      { rootPitchClass: 0, quality: 'maj', start: 0, end: 8 },
      { rootPitchClass: 5, quality: 'maj', start: 8, end: 12 },
    ]);
  });

  it('does not merge the same chord symbol if something else played in between', () => {
    const chords = [
      { rootPitchClass: 0, quality: 'maj', start: 0, end: 4 }, // C
      { rootPitchClass: 5, quality: 'maj', start: 4, end: 8 }, // F
      { rootPitchClass: 0, quality: 'maj', start: 8, end: 12 }, // C again, but a real repeat this time
    ];
    expect(mergeConsecutiveChords(chords)).toEqual(chords);
  });

  it('treats the same root with a different quality as a real change', () => {
    const chords = [
      { rootPitchClass: 0, quality: 'maj', start: 0, end: 4 }, // C
      { rootPitchClass: 0, quality: 'min', start: 4, end: 8 }, // Cm
    ];
    expect(mergeConsecutiveChords(chords)).toEqual(chords);
  });

  it('leaves an already chord-change-only progression untouched', () => {
    expect(mergeConsecutiveChords([])).toEqual([]);
  });
});

describe('trimTrailingEmptyBars', () => {
  it('drops trailing bars with no chord onset', () => {
    // Onsets only through bar 1 (beats 4-8) of an 8-bar (32-beat) take -- bars 2-7 are dead air.
    const trimmed = trimTrailingEmptyBars(32, [0, 4], 4);
    expect(trimmed).toBe(8); // 2 bars kept
  });

  it('keeps everything when the last bar has an onset', () => {
    const trimmed = trimTrailingEmptyBars(16, [0, 4, 8, 12], 4);
    expect(trimmed).toBe(16);
  });

  it('never trims a gap in the middle, only from the end', () => {
    // Bar 1 (beats 4-8) is empty, but bar 2 (beats 8-12) has an onset --
    // nothing should be trimmed, since the empty bar isn't trailing.
    const trimmed = trimTrailingEmptyBars(12, [0, 8], 4);
    expect(trimmed).toBe(12);
  });
});

describe('roundToBarInterval', () => {
  it('rounds to the nearest 4-bar (16-beat) interval', () => {
    expect(roundToBarInterval(15)).toBe(16);
    expect(roundToBarInterval(17)).toBe(16);
    expect(roundToBarInterval(25)).toBe(32);
  });

  it('never rounds down to zero', () => {
    expect(roundToBarInterval(2)).toBe(16);
  });
});

describe('messagesToNotes', () => {
  it('pairs noteon/noteoff into NoteEvents', () => {
    const messages = [
      { timestamp: 0.0, type: 'noteon', note: 60, velocity: 90 },
      { timestamp: 0.5, type: 'noteoff', note: 60, velocity: 0 },
    ];
    expect(messagesToNotes(messages)).toEqual([{ pitch: 60, start: 0.0, end: 0.5, velocity: 90 }]);
  });

  it('treats a velocity-0 noteon as a noteoff', () => {
    const messages = [
      { timestamp: 0.0, type: 'noteon', note: 60, velocity: 90 },
      { timestamp: 0.5, type: 'noteon', note: 60, velocity: 0 },
    ];
    expect(messagesToNotes(messages)).toEqual([{ pitch: 60, start: 0.0, end: 0.5, velocity: 90 }]);
  });

  it('closes a still-held note at endTimestamp -- the normal case when a recording stops mid-chord', () => {
    const messages = [
      { timestamp: 0.0, type: 'noteon', note: 48, velocity: 90 },
      { timestamp: 0.0, type: 'noteon', note: 52, velocity: 90 },
      { timestamp: 0.0, type: 'noteon', note: 55, velocity: 90 },
      // ...no note-offs at all: the chord was still held when the pass ended.
    ];
    expect(messagesToNotes(messages, 4.0)).toEqual([
      { pitch: 48, start: 0.0, end: 4.0, velocity: 90 },
      { pitch: 52, start: 0.0, end: 4.0, velocity: 90 },
      { pitch: 55, start: 0.0, end: 4.0, velocity: 90 },
    ]);
  });

  it('drops a still-held note entirely when no endTimestamp is given (the old, default behavior)', () => {
    const messages = [{ timestamp: 0.0, type: 'noteon', note: 60, velocity: 90 }];
    expect(messagesToNotes(messages)).toEqual([]);
  });

  it('closes a stuck note when the same pitch is struck again', () => {
    const messages = [
      { timestamp: 0.0, type: 'noteon', note: 60, velocity: 90 },
      { timestamp: 0.5, type: 'noteon', note: 60, velocity: 70 }, // no noteoff in between
      { timestamp: 1.0, type: 'noteoff', note: 60, velocity: 0 },
    ];
    expect(messagesToNotes(messages)).toEqual([
      { pitch: 60, start: 0.0, end: 0.5, velocity: 90 },
      { pitch: 60, start: 0.5, end: 1.0, velocity: 70 },
    ]);
  });

  it('ignores an unmatched noteoff', () => {
    const messages = [{ timestamp: 0.5, type: 'noteoff', note: 60, velocity: 0 }];
    expect(messagesToNotes(messages)).toEqual([]);
  });
});

describe('secondsToBeats', () => {
  it('converts using the given tempo', () => {
    const notes = [{ pitch: 60, start: 0.0, end: 1.0, velocity: 90 }];
    // 120 BPM -> 2 beats per second.
    const [beats] = secondsToBeats(notes, 120);
    expect(beats.start).toBeCloseTo(0.0);
    expect(beats.end).toBeCloseTo(2.0);
  });
});
