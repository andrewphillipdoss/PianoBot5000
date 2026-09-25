import { describe, expect, it } from 'vitest';
import { PICKUP_BEATS, processChordsPass, processMelodyPass } from './recordingPipeline.js';

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

    expect(chords).toEqual([{ rootPitchClass: 0, quality: 'maj', start: 0, end: 8 }]);
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
    expect(chords).toEqual([{ rootPitchClass: 0, quality: 'maj', start: 4, end: 5 }]);
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
      { rootPitchClass: 0, quality: 'maj', start: 0, end: 4 },
      { rootPitchClass: 5, quality: 'maj', start: 20, end: 21 },
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
    expect(chords).toEqual([{ rootPitchClass: 0, quality: 'maj', start: 0, end: 8 }]);
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
    const { notes } = processMelodyPass(messages, TEMPO, 16);

    expect(notes[0]).toEqual({ pitch: 60, start: 0, end: 1, velocity: 90 });
    expect(notes[1].start).toBeCloseTo(15.5, 5); // 15.6 snaps to the nearest 16th-note grid point
    expect(notes[1].end).toBe(16); // clipped to the section boundary, not 16.5
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
    const { notes } = processMelodyPass(messages, TEMPO, 16);
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
});
