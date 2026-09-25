/**
 * Turns one completed recording pass (raw captured MIDI messages) into
 * chart data -- the orchestration layer above theory.js's primitives.
 * Still pure: no Web MIDI, no audio, no React, fully testable with
 * fake message arrays. recordingSession.js (the real-time scheduler)
 * calls into this once a pass is done; it never runs mid-recording.
 */

import { detectChords, messagesToNotes, quantizeNotes, roundToBarInterval, secondsToBeats, trimTrailingEmptyBars } from './theory.js';

export const BEATS_PER_BAR = 4;

// Notes are quantized onto a 16th-note grid (quantizeNotes' own default,
// 4 subdivisions/beat = 0.25 beats/step) before chord clustering ever
// sees them. A cluster threshold smaller than that grid step is a real
// bug, not just tight: two notes struck genuinely together can still
// round to *adjacent* grid points (rounding can push them up to half a
// step apart each, so up to a full step apart from each other), and a
// threshold that can't bridge one grid step will then see them as two
// separate, unrecognizable partial chords instead of one real one.
// 0.35 clears that with real margin left over for an actual hand roll,
// while still being tight enough not to smear together a genuinely fast
// chord change.
const QUANTIZE_SUBDIVISIONS_PER_BEAT = 4;
const CHORD_CLUSTER_THRESHOLD_BEATS = 0.35;

/**
 * A completed chords pass -> { chords, sectionLengthBeats }. The
 * chords pass is authoritative for a section's length (see this
 * project's own design discussion for why, not melody): trailing
 * empty bars -- dead air while reaching for the stop key -- are
 * trimmed first, then what's left rounds to the nearest 4-bar
 * interval, which is also the section length the following melody
 * pass plays back against and is bounded by.
 *
 * `captureDurationSeconds` -- how long the pass was actually
 * recording, count-in excluded, from recordingSession.js's own clock
 * -- is a required, separate input, not derived from the notes
 * played: dead air has no MIDI message at all, so "the last note's
 * end time" would silently throw away exactly the trailing-silence
 * information trimming needs.
 */
export function processChordsPass(rawMessages, tempo, captureDurationSeconds) {
  // endTimestamp = the capture boundary itself, so a chord still held
  // when stop() was pressed (the normal case) closes there instead of
  // being dropped for never getting an explicit note-off.
  const notes = quantizeNotes(secondsToBeats(messagesToNotes(rawMessages, captureDurationSeconds), tempo), QUANTIZE_SUBDIVISIONS_PER_BEAT);
  const chords = detectChords(notes, CHORD_CLUSTER_THRESHOLD_BEATS);

  const rawTotalBeats = captureDurationSeconds * (tempo / 60);
  const trimmedBeats = trimTrailingEmptyBars(rawTotalBeats, chords.map((c) => c.start), BEATS_PER_BAR);
  const sectionLengthBeats = roundToBarInterval(trimmedBeats, 4, BEATS_PER_BAR);

  return { chords, sectionLengthBeats };
}

/**
 * A completed melody pass -> { notes }. Its length is already fixed
 * by the chords pass (it's recorded playing back for exactly
 * `sectionLengthBeats`, see recordingSession.js), so there's no
 * length calculation here -- just quantize, then clip anything that
 * spilled past the known section boundary (a note started right at
 * the edge and got cut off by playback stopping).
 */
export function processMelodyPass(rawMessages, tempo, sectionLengthBeats) {
  // Same reasoning as processChordsPass: a melody note still held
  // when playback auto-stops should close there, not vanish.
  const captureDurationSeconds = sectionLengthBeats * (60 / tempo);
  const notes = quantizeNotes(secondsToBeats(messagesToNotes(rawMessages, captureDurationSeconds), tempo), QUANTIZE_SUBDIVISIONS_PER_BEAT)
    .filter((n) => n.start < sectionLengthBeats)
    .map((n) => ({ ...n, end: Math.min(n.end, sectionLengthBeats) }))
    // Clipping to the boundary above can turn a note that quantized
    // right onto it into a zero-length note -- drop those rather than
    // keep a note that plays for no time at all.
    .filter((n) => n.end > n.start);

  return { notes };
}
