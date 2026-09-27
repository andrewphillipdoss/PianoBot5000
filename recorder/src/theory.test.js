import { describe, expect, it } from 'vitest';
import {
  BASS_CEILING_MIDI,
  clipOverlappingNotes,
  clusterOnsets,
  describeChordTones,
  detectChordQuality,
  detectChords,
  dropAccidentalTouches,
  extractBassLine,
  extractTopLine,
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

  it('appends slash notation when the bass differs from the root', () => {
    expect(formatChordSymbol(0, 'maj', 4)).toBe('C/E'); // C major over E -- 1st inversion
    expect(formatChordSymbol(0, 'maj', 7)).toBe('C/G'); // 2nd inversion
    expect(formatChordSymbol(0, 'maj', 2)).toBe('C/D'); // a foreign (non-chord-tone) bass
  });

  it('omits the slash when the bass is the root itself, or not given at all', () => {
    expect(formatChordSymbol(0, 'maj', 0)).toBe('C');
    expect(formatChordSymbol(0, 'maj', null)).toBe('C');
    expect(formatChordSymbol(0, 'maj')).toBe('C');
  });
});

describe('parseChordSymbol', () => {
  it('is the exact inverse of formatChordSymbol for every recognized quality, at every root', () => {
    const qualities = ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4', 'dom7', 'maj7', 'min7', 'm7b5', 'dim7', 'minMaj7', 'maj6', 'min6', 'dom9', 'maj9', 'min9'];
    for (let root = 0; root < 12; root++) {
      for (const quality of qualities) {
        const symbol = formatChordSymbol(root, quality);
        expect(parseChordSymbol(symbol)).toEqual({ rootPitchClass: root, quality, bassPitchClass: root }); // no slash -- bass defaults to the root itself
      }
    }
  });

  it('parses slash notation back into a distinct bassPitchClass', () => {
    expect(parseChordSymbol('C/E')).toEqual({ rootPitchClass: 0, quality: 'maj', bassPitchClass: 4 });
    expect(parseChordSymbol('C/D')).toEqual({ rootPitchClass: 0, quality: 'maj', bassPitchClass: 2 });
    expect(parseChordSymbol('F#m7/A')).toEqual({ rootPitchClass: 6, quality: 'min7', bassPitchClass: 9 });
  });

  it('returns null for a symbol that is not one of this app\'s own recognized shapes', () => {
    expect(parseChordSymbol('Cadd9')).toBeNull(); // add9 (no 7th) isn't in this app's vocabulary, unlike a full 9th chord
    expect(parseChordSymbol('C11')).toBeNull(); // 11ths/13ths are out of scope -- see FIVE_NOTE_INTERVALS's own comment
    expect(parseChordSymbol('H')).toBeNull(); // not a real note letter
    expect(parseChordSymbol('')).toBeNull();
    expect(parseChordSymbol('C/H')).toBeNull(); // unrecognized bass note letter
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
    // {11, 2, 5, 9} is also, by pitch class alone, a D minor 6th chord
    // (see the dedicated test below) -- the bass hint picks B here.
    expect(detectChordQuality([11, 2, 5, 9], 11)).toEqual({ rootPitchClass: 11, quality: 'm7b5' }); // Bm7b5
    expect(detectChordQuality([0, 3, 6, 9])).toEqual({ rootPitchClass: 0, quality: 'dim7' });
  });

  it('shares its 4 pitch classes with a minor 6th chord a minor 3rd below its root -- a real, textbook ambiguity', () => {
    // Bm7b5 (B-D-F-A) and Dm6 (D-F-A-B) are the exact same 4 notes --
    // a half-diminished 7th and the minor 6th chord built on its own
    // 6th degree always coincide this way (this is the same relation
    // as, e.g., Am7b5/Cm6). Without a bass hint this is genuinely
    // ambiguous, same as an augmented triad or diminished 7th -- the
    // bass note picks which one was actually meant.
    expect(detectChordQuality([11, 2, 5, 9], 11)).toEqual({ rootPitchClass: 11, quality: 'm7b5' });
    expect(detectChordQuality([11, 2, 5, 9], 2)).toEqual({ rootPitchClass: 2, quality: 'min6' });
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

  it('recognizes dominant, major, and minor 9th chords (5 distinct pitch classes)', () => {
    expect(detectChordQuality([0, 2, 4, 7, 10])).toEqual({ rootPitchClass: 0, quality: 'dom9' }); // C9
    expect(detectChordQuality([0, 2, 4, 7, 11])).toEqual({ rootPitchClass: 0, quality: 'maj9' }); // Cmaj9
    expect(detectChordQuality([0, 2, 3, 7, 10])).toEqual({ rootPitchClass: 0, quality: 'min9' }); // Cm9
  });

  it('returns null for 5 distinct pitch classes that are not a recognized 9th chord', () => {
    expect(detectChordQuality([0, 1, 2, 3, 4])).toBeNull();
  });

  it('returns null for 6 or more distinct pitch classes (outside this app\'s recognized vocabulary)', () => {
    expect(detectChordQuality([0, 1, 2, 4, 7, 10])).toBeNull();
  });

  it('recognizes major/minor 6th chords', () => {
    expect(detectChordQuality([0, 4, 7, 9])).toEqual({ rootPitchClass: 0, quality: 'maj6' }); // C6
    expect(detectChordQuality([0, 3, 7, 9])).toEqual({ rootPitchClass: 0, quality: 'min6' }); // Cm6
  });

  it('recognizes sus2/sus4 triads', () => {
    expect(detectChordQuality([0, 2, 7])).toEqual({ rootPitchClass: 0, quality: 'sus2' }); // Csus2
    expect(detectChordQuality([0, 5, 7])).toEqual({ rootPitchClass: 0, quality: 'sus4' }); // Csus4
  });

  it('uses the bass note to resolve sus2/sus4\'s inherent symmetry (the same 3 notes read either way)', () => {
    // {0, 5, 7} is both Csus4 (root C) and Fsus2 (root F, a 4th below) --
    // exactly the same shape by pitch class alone.
    const bassC = detectChordQuality([0, 5, 7], 0);
    const bassF = detectChordQuality([0, 5, 7], 5);
    expect(bassC).toEqual({ rootPitchClass: 0, quality: 'sus4' });
    expect(bassF).toEqual({ rootPitchClass: 5, quality: 'sus2' });
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

  it('adds a bass note a full octave below the voicing for a slash chord', () => {
    expect(voiceChordSimple(0, 'maj', 48, 4)).toEqual([40, 48, 52, 55]); // C/E -- E2, then C3 E3 G3
  });

  it('adds nothing extra when the bass is the root itself, or not given', () => {
    expect(voiceChordSimple(0, 'maj', 48, 0)).toEqual([48, 52, 55]);
    expect(voiceChordSimple(0, 'maj', 48)).toEqual([48, 52, 55]);
  });
});

describe('describeChordTones', () => {
  it('spells out plain triads', () => {
    expect(describeChordTones('maj')).toEqual(['1', '3', '5']);
    expect(describeChordTones('min')).toEqual(['1', '♭3', '5']);
    expect(describeChordTones('dim')).toEqual(['1', '♭3', '♭5']);
    expect(describeChordTones('aug')).toEqual(['1', '3', '♯5']);
  });

  it('calls a sus chord\'s replaced tone "2" or "4", not an upper extension', () => {
    expect(describeChordTones('sus2')).toEqual(['1', '2', '5']);
    expect(describeChordTones('sus4')).toEqual(['1', '4', '5']);
  });

  it('spells out 7th and 6th chords', () => {
    expect(describeChordTones('dom7')).toEqual(['1', '3', '5', '♭7']);
    expect(describeChordTones('maj7')).toEqual(['1', '3', '5', '7']);
    expect(describeChordTones('min7')).toEqual(['1', '♭3', '5', '♭7']);
    expect(describeChordTones('m7b5')).toEqual(['1', '♭3', '♭5', '♭7']);
    expect(describeChordTones('minMaj7')).toEqual(['1', '♭3', '5', '7']);
    expect(describeChordTones('maj6')).toEqual(['1', '3', '5', '6']);
    expect(describeChordTones('min6')).toEqual(['1', '♭3', '5', '6']);
  });

  it('spells a diminished 7th\'s own 7th as a double-flat 7th, not a plain 6th', () => {
    // Same semitone distance as maj6/min6's "6" (9 semitones) but a
    // genuinely different theoretical function -- see this function's
    // own comment for why.
    expect(describeChordTones('dim7')).toEqual(['1', '♭3', '♭5', '♭♭7']);
  });

  it('calls the same whole-step-above-root tone "9" once a chord has a 7th too', () => {
    expect(describeChordTones('dom9')).toEqual(['1', '3', '5', '♭7', '9']);
    expect(describeChordTones('maj9')).toEqual(['1', '3', '5', '7', '9']);
    expect(describeChordTones('min9')).toEqual(['1', '♭3', '5', '♭7', '9']);
  });

  it('returns an empty list for an unrecognized quality', () => {
    expect(describeChordTones('nonsense')).toEqual([]);
  });

  it('always has exactly as many degree labels as voiceChordSimple has notes, for every recognized quality', () => {
    const qualities = ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4', 'dom7', 'maj7', 'min7', 'm7b5', 'dim7', 'minMaj7', 'maj6', 'min6', 'dom9', 'maj9', 'min9'];
    for (const quality of qualities) {
      expect(describeChordTones(quality)).toHaveLength(voiceChordSimple(0, quality).length);
    }
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

describe('clipOverlappingNotes', () => {
  it('clips a note\'s end to the next note\'s start when they overlap', () => {
    const notes = [
      { pitch: 60, start: 0, end: 1.1 },
      { pitch: 64, start: 1, end: 2 },
    ];
    expect(clipOverlappingNotes(notes)).toEqual([
      { pitch: 60, start: 0, end: 1 },
      { pitch: 64, start: 1, end: 2 },
    ]);
  });

  it('leaves non-overlapping notes untouched', () => {
    const notes = [
      { pitch: 60, start: 0, end: 0.5 },
      { pitch: 64, start: 1, end: 1.5 },
    ];
    expect(clipOverlappingNotes(notes)).toEqual(notes);
  });

  it('corrects a whole chain of overlapping notes in one pass', () => {
    const notes = [
      { pitch: 60, start: 0, end: 3 }, // overlaps both notes after it
      { pitch: 64, start: 1, end: 3 }, // overlaps the note after it
      { pitch: 67, start: 2, end: 3 },
    ];
    expect(clipOverlappingNotes(notes)).toEqual([
      { pitch: 60, start: 0, end: 1 },
      { pitch: 64, start: 1, end: 2 },
      { pitch: 67, start: 2, end: 3 },
    ]);
  });

  it('sorts by start first, regardless of input order', () => {
    const notes = [
      { pitch: 64, start: 1, end: 2 },
      { pitch: 60, start: 0, end: 1.5 },
    ];
    expect(clipOverlappingNotes(notes)).toEqual([
      { pitch: 60, start: 0, end: 1 },
      { pitch: 64, start: 1, end: 2 },
    ]);
  });

  it('drops a note entirely clipped away (e.g. two notes quantized onto the same start)', () => {
    const notes = [
      { pitch: 60, start: 0, end: 1 },
      { pitch: 64, start: 0, end: 1 }, // same start -- clipping the first against it would zero it out
    ];
    expect(clipOverlappingNotes(notes)).toEqual([{ pitch: 64, start: 0, end: 1 }]);
  });
});

describe('dropAccidentalTouches', () => {
  it('drops a note too brief to be a deliberate chord tone', () => {
    const notes = [
      { pitch: 60, start: 0, end: 0.5, velocity: 90 },
      { pitch: 61, start: 0.1, end: 0.12, velocity: 90 }, // 20ms -- a brushed adjacent key
    ];
    expect(dropAccidentalTouches(notes)).toEqual([notes[0]]);
  });

  it('drops a note too soft to be a deliberate chord tone', () => {
    const notes = [
      { pitch: 60, start: 0, end: 0.5, velocity: 90 },
      { pitch: 61, start: 0.1, end: 0.5, velocity: 3 }, // held long enough, but barely touched
    ];
    expect(dropAccidentalTouches(notes)).toEqual([notes[0]]);
  });

  it('keeps a normally played, held note', () => {
    const notes = [{ pitch: 60, start: 0, end: 0.5, velocity: 60 }];
    expect(dropAccidentalTouches(notes)).toEqual(notes);
  });

  it('thresholds are configurable', () => {
    const notes = [{ pitch: 60, start: 0, end: 0.02, velocity: 5 }];
    expect(dropAccidentalTouches(notes, { minDurationSeconds: 0.01, minVelocity: 1 })).toEqual(notes);
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
    expect(chord).toEqual({ rootPitchClass: 0, quality: 'maj', bassPitchClass: 0, start: 0.0, end: 4.0 }); // root-position -- bass is the root, no slash
  });

  it('turns a clean 7th-chord cluster (4 notes) into one ChordEvent', () => {
    const notes = [
      { pitch: 43, start: 4.0, end: 8.0 }, // G2
      { pitch: 47, start: 4.0, end: 8.0 }, // B2
      { pitch: 50, start: 4.0, end: 8.0 }, // D3
      { pitch: 53, start: 4.0, end: 7.9 }, // F3
    ];
    const [chord] = detectChords(notes, 0.05);
    expect(chord).toEqual({ rootPitchClass: 7, quality: 'dom7', bassPitchClass: 7, start: 4.0, end: 8.0 }); // G7
  });

  it('does not treat a doubled root as a slash chord', () => {
    // Root doubled an octave below the rest of the voicing -- extremely
    // common comping (full sound), not a deliberate inversion.
    const notes = [
      { pitch: 36, start: 0, end: 4 }, // C2 (doubled root)
      { pitch: 48, start: 0, end: 4 }, // C3
      { pitch: 52, start: 0, end: 4 }, // E3
      { pitch: 55, start: 0, end: 4 }, // G3
    ];
    const [chord] = detectChords(notes, 0.05);
    expect(chord.rootPitchClass).toBe(0);
    expect(chord.bassPitchClass).toBe(0); // still C -- no slash
  });

  it('does NOT read an inversion as a slash chord -- it\'s still the same chord, just voiced differently', () => {
    // E3-G3-C4 -- 1st inversion of C major. The bass note (E) is one of
    // the chord's own tones, not a foreign note borrowed from elsewhere,
    // so this reads as plain "C", not "C/E".
    const notes = [
      { pitch: 52, start: 0, end: 4 }, // E3
      { pitch: 55, start: 0, end: 4 }, // G3
      { pitch: 60, start: 0, end: 4 }, // C4
    ];
    const [chord] = detectChords(notes, 0.05);
    expect(chord.rootPitchClass).toBe(0);
    expect(chord.quality).toBe('maj');
    expect(chord.bassPitchClass).toBe(0); // still just "C" -- no slash
  });

  it('does the same for a 2nd inversion', () => {
    // G3-C4-E4 -- 2nd inversion of C major -- still plain "C", not "C/G".
    const notes = [
      { pitch: 55, start: 0, end: 4 }, // G3
      { pitch: 60, start: 0, end: 4 }, // C4
      { pitch: 64, start: 0, end: 4 }, // E4
    ];
    const [chord] = detectChords(notes, 0.05);
    expect(chord.rootPitchClass).toBe(0);
    expect(chord.bassPitchClass).toBe(0); // still just "C" -- no slash
  });

  it('reads a foreign bass note (not one of the chord\'s own tones) as a slash chord', () => {
    // D2 in the bass, C-E-G triad above it -- the combined set {D,C,E,G}
    // spells no known triad/7th on its own, but C-E-G alone is a clean
    // C major -- read as C/D.
    const notes = [
      { pitch: 38, start: 0, end: 4 }, // D2
      { pitch: 60, start: 0, end: 4 }, // C4
      { pitch: 64, start: 0, end: 4 }, // E4
      { pitch: 67, start: 0, end: 4 }, // G4
    ];
    const [chord] = detectChords(notes, 0.05);
    expect(chord.rootPitchClass).toBe(0);
    expect(chord.quality).toBe('maj');
    expect(chord.bassPitchClass).toBe(2); // D -- C/D
  });

  it('recognizes an octave-doubled bass note (not just a single note) as the bass group', () => {
    // D2 and D3 both in the bass (an octave apart), C-E-G above -- still C/D.
    const notes = [
      { pitch: 38, start: 0, end: 4 }, // D2
      { pitch: 50, start: 0, end: 4 }, // D3
      { pitch: 60, start: 0, end: 4 }, // C4
      { pitch: 64, start: 0, end: 4 }, // E4
      { pitch: 67, start: 0, end: 4 }, // G4
    ];
    const [chord] = detectChords(notes, 0.05);
    expect(chord.rootPitchClass).toBe(0);
    expect(chord.bassPitchClass).toBe(2);
  });

  it('drops an unrecognizable cluster rather than throwing', () => {
    const notes = [
      { pitch: 48, start: 2.0, end: 3.0 },
      { pitch: 49, start: 2.0, end: 3.0 },
      { pitch: 50, start: 2.0, end: 3.0 },
    ];
    expect(detectChords(notes, 0.05)).toEqual([]);
  });

  it('drops a single stray note (e.g. a melody line accidentally mixed into the chords take) the same way', () => {
    // The exact real-world case this behavior exists for: a lone note
    // (not even 3 distinct pitch classes) mid-take, surrounded by
    // otherwise-good triads -- losing the whole take over this one
    // moment would be far worse than a small gap in the chart.
    const notes = [{ pitch: 70, start: 4.0, end: 4.2 }];
    expect(detectChords(notes, 0.05)).toEqual([]);
  });

  it('keeps every recognizable cluster and only skips the unrecognizable one in between', () => {
    const notes = [
      { pitch: 48, start: 0, end: 2 }, // C3
      { pitch: 52, start: 0, end: 2 }, // E3
      { pitch: 55, start: 0, end: 2 }, // G3 -- a good C major triad
      { pitch: 74, start: 4, end: 4.2 }, // a single stray note (e.g. a melody slip)
      { pitch: 53, start: 8, end: 10 }, // F3
      { pitch: 57, start: 8, end: 10 }, // A3
      { pitch: 60, start: 8, end: 10 }, // C4 -- a good F major triad
    ];
    const chords = detectChords(notes, 0.05);
    expect(chords).toHaveLength(2);
    expect(chords[0]).toMatchObject({ rootPitchClass: 0, quality: 'maj' });
    expect(chords[1]).toMatchObject({ rootPitchClass: 5, quality: 'maj' });
  });

  it('still returns nothing when neither the whole cluster nor the notes above an isolated bass form a recognized chord', () => {
    const notes = [
      { pitch: 38, start: 0, end: 4 }, // D2, isolated bass
      { pitch: 60, start: 0, end: 4 }, // C4
      { pitch: 61, start: 0, end: 4 }, // C#4 -- not a recognizable shape either way
    ];
    expect(detectChords(notes, 0.05)).toEqual([]);
  });

  describe('denoising (one slipped note)', () => {
    it('drops a semitone slip struck along with a triad and still reads the triad', () => {
      const notes = [
        { pitch: 48, start: 0, end: 4, velocity: 90 }, // C3
        { pitch: 49, start: 0, end: 4, velocity: 90 }, // C#3 -- slipped finger
        { pitch: 52, start: 0, end: 4, velocity: 90 }, // E3
        { pitch: 55, start: 0, end: 4, velocity: 90 }, // G3
      ];
      // Not "C#dim/C": C# sits a semitone off the bass, far too crowded to
      // be a deliberate foreign bass note, and the bass is never the one
      // assumed to have slipped when another reading works.
      const [chord] = detectChords(notes, 0.05);
      expect(chord).toMatchObject({ rootPitchClass: 0, quality: 'maj', bassPitchClass: 0 });
    });

    it('drops a stray note struck with the chord in a far-off register', () => {
      const notes = [
        { pitch: 48, start: 0, end: 4, velocity: 90 }, // C3
        { pitch: 52, start: 0, end: 4, velocity: 90 }, // E3
        { pitch: 55, start: 0, end: 4, velocity: 90 }, // G3
        { pitch: 78, start: 0, end: 4, velocity: 90 }, // F#5 -- stray hit
      ];
      const [chord] = detectChords(notes, 0.05);
      expect(chord).toMatchObject({ rootPitchClass: 0, quality: 'maj', bassPitchClass: 0 });
    });

    it('prefers dropping the softer note when two different drops would each leave a valid chord', () => {
      // C-D-E-G: dropping D leaves C major, dropping E leaves Csus2 -- the
      // glancing (soft) D is the slip.
      const notes = [
        { pitch: 48, start: 0, end: 4, velocity: 90 }, // C3
        { pitch: 50, start: 0, end: 4, velocity: 25 }, // D3 -- soft brush
        { pitch: 52, start: 0, end: 4, velocity: 90 }, // E3
        { pitch: 55, start: 0, end: 4, velocity: 90 }, // G3
      ];
      const [chord] = detectChords(notes, 0.05);
      expect(chord).toMatchObject({ rootPitchClass: 0, quality: 'maj' });
    });

    it('leaves a genuinely ambiguous cluster unrecognized rather than guessing', () => {
      // Same C-D-E-G, but nothing distinguishes D from E as the slip.
      const notes = [
        { pitch: 48, start: 0, end: 4, velocity: 90 },
        { pitch: 50, start: 0, end: 4, velocity: 90 },
        { pitch: 52, start: 0, end: 4, velocity: 90 },
        { pitch: 55, start: 0, end: 4, velocity: 90 },
      ];
      expect(detectChords(notes, 0.05)).toEqual([]);
    });

    it("doesn't let a slip's own timing stretch the chord", () => {
      const notes = [
        { pitch: 48, start: 0, end: 2, velocity: 90 },
        { pitch: 52, start: 0, end: 2, velocity: 90 },
        { pitch: 55, start: 0, end: 2, velocity: 90 },
        { pitch: 78, start: 0, end: 6, velocity: 90 }, // stray note left held way longer
      ];
      const [chord] = detectChords(notes, 0.05);
      expect(chord.end).toBe(2);
    });

    it('does not read a doubled bass note plus a slip as a slash chord', () => {
      // C3 E3 G3 C4 + C#4: C recurs above the bass, so it's a chord tone,
      // never a foreign bass -- the C# is the slip.
      const notes = [
        { pitch: 48, start: 0, end: 4, velocity: 90 },
        { pitch: 52, start: 0, end: 4, velocity: 90 },
        { pitch: 55, start: 0, end: 4, velocity: 90 },
        { pitch: 60, start: 0, end: 4, velocity: 90 },
        { pitch: 61, start: 0, end: 4, velocity: 90 },
      ];
      const [chord] = detectChords(notes, 0.05);
      expect(chord).toMatchObject({ rootPitchClass: 0, quality: 'maj', bassPitchClass: 0 });
    });
  });
});

describe('extractTopLine', () => {
  it('keeps only the highest note of notes struck together', () => {
    const notes = [
      { pitch: 60, start: 0, end: 1 }, // C4
      { pitch: 64, start: 0.01, end: 1 }, // E4
      { pitch: 72, start: 0.02, end: 1 }, // C5 -- the melody note
    ];
    expect(extractTopLine(notes).map((n) => n.pitch)).toEqual([72]);
  });

  it('ignores accompaniment moving underneath a held melody note', () => {
    const notes = [
      { pitch: 76, start: 0, end: 2 }, // E5 held
      { pitch: 60, start: 0.5, end: 1 }, // C4 underneath
      { pitch: 64, start: 1, end: 1.5 }, // E4 underneath
      { pitch: 74, start: 2, end: 3 }, // D5 -- next melody note
    ];
    expect(extractTopLine(notes).map((n) => n.pitch)).toEqual([76, 74]);
  });

  it('keeps a descending legato line whose notes overlap slightly', () => {
    const notes = [
      { pitch: 72, start: 0, end: 0.54 }, // released 40ms after the next onset
      { pitch: 71, start: 0.5, end: 1.04 },
      { pitch: 69, start: 1, end: 1.5 },
    ];
    expect(extractTopLine(notes).map((n) => n.pitch)).toEqual([72, 71, 69]);
  });
});

describe('extractBassLine', () => {
  it('reads a single low note as the bass', () => {
    expect(extractBassLine([{ pitch: 36, start: 0, end: 1 }]).map((n) => n.pitch)).toEqual([36]);
  });

  it('reads an octave as one bass note, the lower of the two', () => {
    const notes = [
      { pitch: 36, start: 0, end: 1 }, // C2
      { pitch: 48, start: 0.01, end: 1 }, // C3
    ];
    expect(extractBassLine(notes).map((n) => n.pitch)).toEqual([36]);
  });

  it('falls back to the lowest note of a chord, when it sits in the bass register', () => {
    const notes = [
      { pitch: 43, start: 0, end: 1 }, // G2
      { pitch: 59, start: 0, end: 1 },
      { pitch: 62, start: 0, end: 1 },
    ];
    expect(extractBassLine(notes).map((n) => n.pitch)).toEqual([43]);
  });

  it('takes nothing from a moment whose lowest note is above the bass register', () => {
    const notes = [
      { pitch: BASS_CEILING_MIDI + 4, start: 0, end: 1 },
      { pitch: BASS_CEILING_MIDI + 7, start: 0, end: 1 },
    ];
    expect(extractBassLine(notes)).toEqual([]);
  });

  it('keeps a held bass note from being replaced by a chord struck above it', () => {
    const notes = [
      { pitch: 36, start: 0, end: 2 }, // C2 held
      { pitch: 55, start: 0.5, end: 1 }, // G3 -- a chord's bottom note, still in range
      { pitch: 59, start: 0.5, end: 1 },
      { pitch: 38, start: 2, end: 3 }, // D2 -- next bass note
    ];
    expect(extractBassLine(notes).map((n) => n.pitch)).toEqual([36, 38]);
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

  it('treats a bass note change as a real change even when root+quality stay the same', () => {
    // A walking (foreign) bass under a held C major -- C, then C/D, then
    // C/F -- is exactly what slash notation exists to show, not a
    // repeat. (An inversion, e.g. C/E, wouldn't produce a different
    // bassPitchClass at all -- see detectChords -- so it isn't a useful
    // example here; this tests genuine foreign-bass slash chords.)
    const chords = [
      { rootPitchClass: 0, quality: 'maj', bassPitchClass: 0, start: 0, end: 4 }, // C
      { rootPitchClass: 0, quality: 'maj', bassPitchClass: 2, start: 4, end: 8 }, // C/D
      { rootPitchClass: 0, quality: 'maj', bassPitchClass: 5, start: 8, end: 12 }, // C/F
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

  it('debounces a same-pitch retrigger with no noteoff in between when it arrives within the bounce window', () => {
    // Regression test: some keyboards' key contacts "bounce," firing a
    // second note-on for the same pitch a few ms after the first with
    // no note-off between them -- previously read as "close the held
    // note, a new one is starting," producing one real note plus a
    // spurious near-zero-length phantom the player never played.
    const messages = [
      { timestamp: 0.0, type: 'noteon', note: 60, velocity: 90 },
      { timestamp: 0.01, type: 'noteon', note: 60, velocity: 85 }, // 10ms later -- contact bounce, not a real re-strike
      { timestamp: 0.5, type: 'noteoff', note: 60, velocity: 0 },
    ];
    expect(messagesToNotes(messages)).toEqual([{ pitch: 60, start: 0.0, end: 0.5, velocity: 90 }]);
  });

  it('still registers a deliberate fast re-strike outside the bounce window', () => {
    const messages = [
      { timestamp: 0.0, type: 'noteon', note: 60, velocity: 90 },
      { timestamp: 0.1, type: 'noteon', note: 60, velocity: 70 }, // 100ms later -- a real, if fast, re-strike
      { timestamp: 0.2, type: 'noteoff', note: 60, velocity: 0 },
    ];
    expect(messagesToNotes(messages)).toEqual([
      { pitch: 60, start: 0.0, end: 0.1, velocity: 90 },
      { pitch: 60, start: 0.1, end: 0.2, velocity: 70 },
    ]);
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
