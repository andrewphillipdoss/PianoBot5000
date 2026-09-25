/**
 * Turns one completed recording pass (raw captured MIDI messages) into
 * chart data -- the orchestration layer above theory.js's primitives.
 * Still pure: no Web MIDI, no audio, no React, fully testable with
 * fake message arrays. recordingSession.js (the real-time scheduler)
 * calls into this once a pass is done; it never runs mid-recording.
 */

import { detectChords, mergeConsecutiveChords, messagesToNotes, quantizeNotes, roundToBarInterval, secondsToBeats, trimTrailingEmptyBars } from './theory.js';

export const BEATS_PER_BAR = 4;

// One bar of lead-in captured before the chords start playing back
// during a melody pass, so pickup/anacrusis notes have somewhere to
// go. Capturing already starts right when the count-in ends (see
// recordingSession.js's _beginCapturing) -- this is what that gap is
// *for*, rather than the chords entering immediately. Notes played in
// it come back with a *negative* beat position (see processMelodyPass
// below), same as how a pickup measure is normally counted relative
// to the downbeat it leads into.
export const PICKUP_BEATS = BEATS_PER_BAR;

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
  const chords = mergeConsecutiveChords(detectChords(notes, CHORD_CLUSTER_THRESHOLD_BEATS));

  const rawTotalBeats = captureDurationSeconds * (tempo / 60);
  const trimmedBeats = trimTrailingEmptyBars(rawTotalBeats, chords.map((c) => c.start), BEATS_PER_BAR);
  const sectionLengthBeats = roundToBarInterval(trimmedBeats, 4, BEATS_PER_BAR);

  return { chords, sectionLengthBeats };
}

/**
 * A completed melody pass -> { notes }. Capturing runs for one pickup
 * bar (PICKUP_BEATS) plus `sectionLengthBeats` (already fixed by the
 * chords pass, see recordingSession.js) -- notes get rebased so beat 0
 * lines up with the actual downbeat (where the chords start), meaning
 * a pickup note comes back with a *negative* start, not clipped or
 * dropped. Anything at or past the section's own end is clipped the
 * same way a note spilling into the boundary always was.
 */
export function processMelodyPass(rawMessages, tempo, sectionLengthBeats) {
  const totalCaptureBeats = PICKUP_BEATS + sectionLengthBeats;
  // Same reasoning as processChordsPass: a melody note still held
  // when playback auto-stops should close there, not vanish.
  const captureDurationSeconds = totalCaptureBeats * (60 / tempo);
  const notes = quantizeNotes(secondsToBeats(messagesToNotes(rawMessages, captureDurationSeconds), tempo), QUANTIZE_SUBDIVISIONS_PER_BEAT)
    .map((n) => ({ ...n, start: n.start - PICKUP_BEATS, end: n.end - PICKUP_BEATS }))
    .filter((n) => n.start < sectionLengthBeats)
    .map((n) => ({ ...n, end: Math.min(n.end, sectionLengthBeats) }))
    // Clipping to the boundary above can turn a note that quantized
    // right onto it into a zero-length note -- drop those rather than
    // keep a note that plays for no time at all.
    .filter((n) => n.end > n.start);

  return { notes };
}
