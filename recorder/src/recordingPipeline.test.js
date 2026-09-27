import { describe, expect, it } from 'vitest';
import { DEFAULT_MELODY_QUANTIZE_STRENGTH, PICKUP_BEATS, processChordsPass, processMelodyPass } from './recordingPipeline.js';

const TEMPO = 120; // 0.5 seconds per beat -- easy round numbers for test timestamps
const SPB = 60 / TEMPO;

describe('processChordsPass', () => {
  it('detects chords and rounds a clean take (no dead air) up to the nearest 4-bar unit', () => {
    const messages = [
      { timestamp: 0, type: 'noteon', note: 48, velocity: 90 }, // C3
      { timestamp: 0, type: 'noteon', note: 52, velocity: 90 }, // E3
      { timestamp: 0, type: 'noteon', note: 55, velocity: 90 }, // G3
      { timestamp: 8 * SPB, type: 'noteoff', note: 48, velocity: 0 },
      { timestamp: 8 * SPB, type: 'noteoff', note: 52, velocity: 0 },
      { timestamp: 8 * SPB, type: 'noteoff', note: 55, velocity: 0 },
    ];
    // Recording was stopped right as the chord was released -- 8 beats captured, no trailing silence.
    const { chords, sectionLengthBeats } = processChordsPass(messages, TEMPO, 8 * SPB);

    expect(chords).toEqual([{ rootPitchClass: 0, quality: 'maj', bassPitchClass: 0, start: 0, end: 8 }]);
    expect(sectionLengthBeats).toBe(16); // 8 real beats rounds up to one 4-bar (16-beat) unit
  });

  it('still recognizes a rolled chord whose notes quantize onto adjacent 16th-note grid points', () => {
    // A real, natural hand roll -- C3/E3 struck together, G3 landing
    // ~0.15 beats later (75ms at this tempo, an ordinary chord attack
    // spread, not sloppy playing). Quantizing each note independently
    // to the 16th-note grid pushes C3/E3 to beat 4.00 and G3 to the
    // *next* grid point, beat 4.25 -- if the cluster threshold can't
    // bridge that one grid step, this correctly-played chord gets
    // fragmented into two unrecognizable partial clusters and throws.
    const messages = [
      { timestamp: 4.05 * SPB, type: 'noteon', note: 48, velocity: 90 }, // C3
      { timestamp: 4.05 * SPB, type: 'noteon', note: 52, velocity: 90 }, // E3
      { timestamp: 4.2 * SPB, type: 'noteon', note: 55, velocity: 90 }, // G3, rolled in slightly late
      { timestamp: 5 * SPB, type: 'noteoff', note: 48, velocity: 0 },
      { timestamp: 5 * SPB, type: 'noteoff', note: 52, velocity: 0 },
      { timestamp: 5 * SPB, type: 'noteoff', note: 55, velocity: 0 },
    ];
    const { chords } = processChordsPass(messages, TEMPO, 8 * SPB);
    expect(chords).toEqual([{ rootPitchClass: 0, quality: 'maj', bassPitchClass: 0, start: 4, end: 5 }]);
  });

  it('trims trailing dead air before rounding, using the true capture duration -- not the last note-off', () => {
    const messages = [
      { timestamp: 0, type: 'noteon', note: 48, velocity: 90 }, // C3 -- C major, beat 0
      { timestamp: 0, type: 'noteon', note: 52, velocity: 90 },
      { timestamp: 0, type: 'noteon', note: 55, velocity: 90 },
      { timestamp: 4 * SPB, type: 'noteoff', note: 48, velocity: 0 },
      { timestamp: 4 * SPB, type: 'noteoff', note: 52, velocity: 0 },
      { timestamp: 4 * SPB, type: 'noteoff', note: 55, velocity: 0 },
      { timestamp: 20 * SPB, type: 'noteon', note: 53, velocity: 90 }, // F3 -- F major, beat 20
      { timestamp: 20 * SPB, type: 'noteon', note: 57, velocity: 90 },
      { timestamp: 20 * SPB, type: 'noteon', note: 60, velocity: 90 },
      { timestamp: 21 * SPB, type: 'noteoff', note: 53, velocity: 0 },
      { timestamp: 21 * SPB, type: 'noteoff', note: 57, velocity: 0 },
      { timestamp: 21 * SPB, type: 'noteoff', note: 60, velocity: 0 },
      // ...then the player didn't reach for the spacebar until beat 60 -- 39 beats of dead air.
    ];
    const { chords, sectionLengthBeats } = processChordsPass(messages, TEMPO, 60 * SPB);

    expect(chords).toEqual([
      { rootPitchClass: 0, quality: 'maj', bassPitchClass: 0, start: 0, end: 4 },
      { rootPitchClass: 5, quality: 'maj', bassPitchClass: 5, start: 20, end: 21 },
    ]);
    // Last onset (beat 20) is in bar index 5 -> keeps bars 0-5 (24 beats) -> rounds to the nearest 16 -> 32.
    // Trimming this dead air is exactly the point: without it, 60 beats would round to 64.
    expect(sectionLengthBeats).toBe(32);
  });

  it('merges a chord re-struck on consecutive bars into one entry instead of counting it as a change', () => {
    const messages = [
      { timestamp: 0, type: 'noteon', note: 48, velocity: 90 }, // C3 -- C major, beat 0
      { timestamp: 0, type: 'noteon', note: 52, velocity: 90 },
      { timestamp: 0, type: 'noteon', note: 55, velocity: 90 },
      { timestamp: 4 * SPB, type: 'noteoff', note: 48, velocity: 0 },
      { timestamp: 4 * SPB, type: 'noteoff', note: 52, velocity: 0 },
      { timestamp: 4 * SPB, type: 'noteoff', note: 55, velocity: 0 },
      { timestamp: 4 * SPB, type: 'noteon', note: 48, velocity: 90 }, // C major again, re-struck for beat 4
      { timestamp: 4 * SPB, type: 'noteon', note: 52, velocity: 90 },
      { timestamp: 4 * SPB, type: 'noteon', note: 55, velocity: 90 },
      { timestamp: 8 * SPB, type: 'noteoff', note: 48, velocity: 0 },
      { timestamp: 8 * SPB, type: 'noteoff', note: 52, velocity: 0 },
      { timestamp: 8 * SPB, type: 'noteoff', note: 55, velocity: 0 },
    ];
    const { chords } = processChordsPass(messages, TEMPO, 8 * SPB);
    // One merged entry spanning both bars, not two identical "C" entries.
    expect(chords).toEqual([{ rootPitchClass: 0, quality: 'maj', bassPitchClass: 0, start: 0, end: 8 }]);
  });

  it('quantizes onto a coarser grid when a coarser subdivision is requested (8th notes)', () => {
    // Struck slightly after beat 4 -- with the default 16th-note grid
    // this would snap to 4.25, not 4.5.
    const messages = [
      { timestamp: 4.3 * SPB, type: 'noteon', note: 48, velocity: 90 },
      { timestamp: 4.3 * SPB, type: 'noteon', note: 52, velocity: 90 },
      { timestamp: 4.3 * SPB, type: 'noteon', note: 55, velocity: 90 },
      { timestamp: 5 * SPB, type: 'noteoff', note: 48, velocity: 0 },
      { timestamp: 5 * SPB, type: 'noteoff', note: 52, velocity: 0 },
      { timestamp: 5 * SPB, type: 'noteoff', note: 55, velocity: 0 },
    ];
    const { chords } = processChordsPass(messages, TEMPO, 8 * SPB, 2); // 2 subdivisions/beat = 8th notes
    expect(chords[0].start).toBe(4.5); // snaps to the nearest half-beat, not the nearest 16th
  });

  it('does not merge two distinct chords a normal eighth-note apart, even at 8th-note quantization', () => {
    // Regression test: clustering used to run *after* quantization,
    // with a threshold that grew alongside the grid step (to bridge
    // one step of rounding error) -- at 8th-note quantization that
    // threshold (0.6 beats) was wider than the routine half-beat
    // spacing between two different chords, so they'd wrongly merge
    // into one unrecognizable cluster instead of two real ones.
    const messages = [
      { timestamp: 0, type: 'noteon', note: 48, velocity: 90 }, // C major, beat 0
      { timestamp: 0, type: 'noteon', note: 52, velocity: 90 },
      { timestamp: 0, type: 'noteon', note: 55, velocity: 90 },
      { timestamp: 0.5 * SPB, type: 'noteoff', note: 48, velocity: 0 },
      { timestamp: 0.5 * SPB, type: 'noteoff', note: 52, velocity: 0 },
      { timestamp: 0.5 * SPB, type: 'noteoff', note: 55, velocity: 0 },
      { timestamp: 0.5 * SPB, type: 'noteon', note: 53, velocity: 90 }, // F major, beat 0.5 -- a normal eighth-note chord change
      { timestamp: 0.5 * SPB, type: 'noteon', note: 57, velocity: 90 },
      { timestamp: 0.5 * SPB, type: 'noteon', note: 60, velocity: 90 },
      { timestamp: 1 * SPB, type: 'noteoff', note: 53, velocity: 0 },
      { timestamp: 1 * SPB, type: 'noteoff', note: 57, velocity: 0 },
      { timestamp: 1 * SPB, type: 'noteoff', note: 60, velocity: 0 },
    ];
    const { chords } = processChordsPass(messages, TEMPO, 4 * SPB, 2); // 2 subdivisions/beat = 8th notes
    expect(chords).toEqual([
      { rootPitchClass: 0, quality: 'maj', bassPitchClass: 0, start: 0, end: 0.5 },
      { rootPitchClass: 5, quality: 'maj', bassPitchClass: 5, start: 0.5, end: 1 },
    ]);
  });

  it('rounds section length using a non-default time signature\'s own bar length (3/4)', () => {
    const messages = [
      { timestamp: 0, type: 'noteon', note: 48, velocity: 90 },
      { timestamp: 0, type: 'noteon', note: 52, velocity: 90 },
      { timestamp: 0, type: 'noteon', note: 55, velocity: 90 },
      { timestamp: 6 * SPB, type: 'noteoff', note: 48, velocity: 0 },
      { timestamp: 6 * SPB, type: 'noteoff', note: 52, velocity: 0 },
      { timestamp: 6 * SPB, type: 'noteoff', note: 55, velocity: 0 },
    ];
    // 6 beats captured, no dead air. At 4/4 (default) that rounds up to
    // one 16-beat (4-bar) unit; at 3/4 a "bar" is 3 beats, so a 4-bar
    // unit is 12 beats -- 6 beats should round up to that instead.
    const default4_4 = processChordsPass(messages, TEMPO, 6 * SPB);
    const time3_4 = processChordsPass(messages, TEMPO, 6 * SPB, 2, 3);
    expect(default4_4.sectionLengthBeats).toBe(16);
    expect(time3_4.sectionLengthBeats).toBe(12);
  });

  it('ignores an accidentally brushed extra key instead of failing to recognize the chord', () => {
    const messages = [
      { timestamp: 0, type: 'noteon', note: 48, velocity: 90 }, // C3
      { timestamp: 0, type: 'noteon', note: 52, velocity: 90 }, // E3
      { timestamp: 0, type: 'noteon', note: 55, velocity: 90 }, // G3
      { timestamp: 0.01 * SPB, type: 'noteon', note: 49, velocity: 90 }, // C#3 -- an accidental brush, held only 20ms
      { timestamp: 0.02 * SPB, type: 'noteoff', note: 49, velocity: 0 },
      { timestamp: 4 * SPB, type: 'noteoff', note: 48, velocity: 0 },
      { timestamp: 4 * SPB, type: 'noteoff', note: 52, velocity: 0 },
      { timestamp: 4 * SPB, type: 'noteoff', note: 55, velocity: 0 },
    ];
    const { chords } = processChordsPass(messages, TEMPO, 4 * SPB);
    expect(chords).toEqual([{ rootPitchClass: 0, quality: 'maj', bassPitchClass: 0, start: 0, end: 4 }]);
  });

  it('ignores a barely-touched extra key (very low velocity) the same way', () => {
    const messages = [
      { timestamp: 0, type: 'noteon', note: 48, velocity: 90 },
      { timestamp: 0, type: 'noteon', note: 52, velocity: 90 },
      { timestamp: 0, type: 'noteon', note: 55, velocity: 90 },
      { timestamp: 0, type: 'noteon', note: 49, velocity: 2 }, // held the whole chord, but barely touched
      { timestamp: 4 * SPB, type: 'noteoff', note: 48, velocity: 0 },
      { timestamp: 4 * SPB, type: 'noteoff', note: 52, velocity: 0 },
      { timestamp: 4 * SPB, type: 'noteoff', note: 55, velocity: 0 },
      { timestamp: 4 * SPB, type: 'noteoff', note: 49, velocity: 0 },
    ];
    const { chords } = processChordsPass(messages, TEMPO, 4 * SPB);
    expect(chords).toEqual([{ rootPitchClass: 0, quality: 'maj', bassPitchClass: 0, start: 0, end: 4 }]);
  });
});

describe('processMelodyPass', () => {
  // Capturing starts one pickup bar (PICKUP_BEATS) before the chords'
  // own downbeat -- raw message timestamps are relative to that
  // earlier capture start, so "section beat 0" is at PICKUP_BEATS,
  // not 0. Every raw timestamp below is offset by PICKUP_BEATS for
  // exactly that reason.
  it('quantizes captured notes and clips anything spilling past the known section length', () => {
    const messages = [
      { timestamp: PICKUP_BEATS * SPB, type: 'noteon', note: 60, velocity: 90 }, // right on the downbeat
      { timestamp: (PICKUP_BEATS + 1) * SPB, type: 'noteoff', note: 60, velocity: 0 },
      { timestamp: (PICKUP_BEATS + 15.6) * SPB, type: 'noteon', note: 64, velocity: 90 }, // starts just before the section ends...
      { timestamp: (PICKUP_BEATS + 16.5) * SPB, type: 'noteoff', note: 64, velocity: 0 }, // ...and would otherwise run past it
    ];
    // Full strength (1) here -- this test is about which grid point a
    // note snaps to, not the default softened feel (see the strength
    // tests below), so it isolates that from the other.
    const { notes } = processMelodyPass(messages, TEMPO, 16, undefined, 1);

    expect(notes[0]).toEqual({ pitch: 60, start: 0, end: 1, velocity: 90 });
    expect(notes[1].start).toBeCloseTo(15.5, 5); // 15.6 snaps to the nearest 16th-note grid point
    expect(notes[1].end).toBe(16); // clipped to the section boundary, not 16.5
  });

  it('quantizes melody notes onto whatever subdivision is requested (32nd notes)', () => {
    const messages = [
      { timestamp: (PICKUP_BEATS + 2.35) * SPB, type: 'noteon', note: 67, velocity: 90 },
      { timestamp: (PICKUP_BEATS + 3) * SPB, type: 'noteoff', note: 67, velocity: 0 },
    ];
    const { notes } = processMelodyPass(messages, TEMPO, 16, 8, 1); // 8 subdivisions/beat = 32nd notes, full strength
    // 2.35 snaps to 2.375, the nearest 1/8-beat (32nd-note) grid point --
    // with the default 16th-note grid it would instead snap to 2.25.
    expect(notes[0].start).toBeCloseTo(2.375, 5);
  });

  it('drops a note that starts at or after the section boundary entirely', () => {
    const messages = [
      { timestamp: (PICKUP_BEATS + 16) * SPB, type: 'noteon', note: 60, velocity: 90 },
      { timestamp: (PICKUP_BEATS + 16.5) * SPB, type: 'noteoff', note: 60, velocity: 0 },
    ];
    const { notes } = processMelodyPass(messages, TEMPO, 16);
    expect(notes).toEqual([]);
  });

  it('drops a note that quantizes to zero length once clipped to the boundary, rather than keep a ghost note', () => {
    const messages = [
      { timestamp: (PICKUP_BEATS + 15.9) * SPB, type: 'noteon', note: 60, velocity: 90 }, // quantizes to exactly beat 16...
      { timestamp: (PICKUP_BEATS + 17) * SPB, type: 'noteoff', note: 60, velocity: 0 }, // ...so clipping start==end==16
    ];
    const { notes } = processMelodyPass(messages, TEMPO, 16, undefined, 1); // full strength -- see the note on the test above
    expect(notes).toEqual([]);
  });

  it('captures a pickup note played before the downbeat with a negative beat position', () => {
    const messages = [
      { timestamp: 0, type: 'noteon', note: 67, velocity: 90 }, // right at the top of the pickup bar
      { timestamp: (PICKUP_BEATS - 1) * SPB, type: 'noteoff', note: 67, velocity: 0 }, // released a beat before the downbeat
    ];
    const { notes } = processMelodyPass(messages, TEMPO, 16);
    expect(notes).toEqual([{ pitch: 67, start: -PICKUP_BEATS, end: -1, velocity: 90 }]);
  });

  it('closes a pickup note with no note-off at the true capture boundary, not dropped entirely', () => {
    // No note-off at all -- messagesToNotes closes it at the real
    // capture end (the pickup bar plus the full section), which then
    // clips to the section boundary same as any other still-held note.
    const messages = [{ timestamp: (PICKUP_BEATS - 0.5) * SPB, type: 'noteon', note: 67, velocity: 90 }];
    const { notes } = processMelodyPass(messages, TEMPO, 16);
    expect(notes).toEqual([{ pitch: 67, start: -0.5, end: 16, velocity: 90 }]);
  });

  it('defaults to a softened (not full-strength) snap, so a note off-grid stays partway there rather than landing exactly on it', () => {
    const messages = [
      // 2.35 beats -- nearest 16th-note grid point (default subdivision) is 2.25, 0.1 beats away.
      { timestamp: (PICKUP_BEATS + 2.35) * SPB, type: 'noteon', note: 67, velocity: 90 },
      { timestamp: (PICKUP_BEATS + 3) * SPB, type: 'noteoff', note: 67, velocity: 0 },
    ];
    const { notes } = processMelodyPass(messages, TEMPO, 16); // default subdivisions + default (softened) strength
    expect(notes[0].start).not.toBeCloseTo(2.25, 5); // did not fully snap...
    expect(notes[0].start).not.toBeCloseTo(2.35, 5); // ...but isn't untouched raw timing either
    expect(notes[0].start).toBeCloseTo(2.35 + (2.25 - 2.35) * DEFAULT_MELODY_QUANTIZE_STRENGTH, 5);
  });

  it('an explicit strength of 1 reproduces a full snap; 0 leaves timing untouched', () => {
    const messages = [
      { timestamp: (PICKUP_BEATS + 2.35) * SPB, type: 'noteon', note: 67, velocity: 90 },
      { timestamp: (PICKUP_BEATS + 3) * SPB, type: 'noteoff', note: 67, velocity: 0 },
    ];
    const full = processMelodyPass(messages, TEMPO, 16, 4, 1);
    const none = processMelodyPass(messages, TEMPO, 16, 4, 0);
    expect(full.notes[0].start).toBeCloseTo(2.25, 5);
    expect(none.notes[0].start).toBeCloseTo(2.35, 5);
  });

  it('enforces a monophonic melody line -- a held note released a little late gets clipped to the next note\'s start', () => {
    const messages = [
      // A legato take: the first note's release lands after the second note's onset.
      { timestamp: (PICKUP_BEATS + 0) * SPB, type: 'noteon', note: 60, velocity: 90 },
      { timestamp: (PICKUP_BEATS + 1.1) * SPB, type: 'noteoff', note: 60, velocity: 0 }, // released 0.1 beat late
      { timestamp: (PICKUP_BEATS + 1) * SPB, type: 'noteon', note: 64, velocity: 90 },
      { timestamp: (PICKUP_BEATS + 2) * SPB, type: 'noteoff', note: 64, velocity: 0 },
    ];
    const { notes } = processMelodyPass(messages, TEMPO, 16, 4, 1); // full strength -- isolates this from the softened-snap tests above
    expect(notes).toEqual([
      { pitch: 60, start: 0, end: 1, velocity: 90 }, // clipped to pitch 64's start, not left overlapping it
      { pitch: 64, start: 1, end: 2, velocity: 90 },
    ]);
  });

  it('skips the pickup bar entirely when pickupBeats is 0 -- capturing starts right on the downbeat', () => {
    const messages = [
      { timestamp: 0, type: 'noteon', note: 60, velocity: 90 }, // right at the very start of capture -- no pickup bar to land in
      { timestamp: 1 * SPB, type: 'noteoff', note: 60, velocity: 0 },
    ];
    const { notes } = processMelodyPass(messages, TEMPO, 16, 4, 1, 0); // pickupBeats = 0
    expect(notes).toEqual([{ pitch: 60, start: 0, end: 1, velocity: 90 }]); // beat 0 -- not shifted negative the way a pickup note would be
  });
});
