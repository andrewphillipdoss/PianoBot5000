/**
 * Turns one completed recording pass (raw captured MIDI messages) into
 * chart data -- the orchestration layer above theory.js's primitives.
 * Still pure: no Web MIDI, no audio, no React, fully testable with
 * fake message arrays. recordingSession.js (the real-time scheduler)
 * calls into this once a pass is done; it never runs mid-recording.
 */

import {
  clipOverlappingNotes,
  detectChords,
  dropAccidentalTouches,
  mergeConsecutiveChords,
  messagesToNotes,
  quantizeBeat,
  quantizeNotes,
  roundToBarInterval,
  secondsToBeats,
  trimTrailingEmptyBars,
} from './theory.js';

export const DEFAULT_BEATS_PER_BAR = 4; // a plain quarter-note beat per the time signature's numerator -- 3 for 3/4, 4 for 4/4, etc. (compound meters like 6/8 aren't modeled separately; pick the beat count that reads naturally)
export const BEATS_PER_BAR = DEFAULT_BEATS_PER_BAR; // kept as the fallback default throughout this file/its callers for a song that doesn't say otherwise

// One bar of lead-in captured before the chords start playing back
// during a melody pass, so pickup/anacrusis notes have somewhere to
// go. Capturing already starts right when the count-in ends (see
// recordingSession.js's _beginCapturing) -- this is what that gap is
// *for*, rather than the chords entering immediately. Notes played in
// it come back with a *negative* beat position (see processMelodyPass
// below), same as how a pickup measure is normally counted relative
// to the downbeat it leads into.
export const PICKUP_BEATS = BEATS_PER_BAR;

// How finely notes are snapped to the beat grid for display -- chosen
// per-song at setup (8th/16th/32nd; see SongSetup.jsx), these defaults
// if a caller doesn't say. Chords and melody default *differently*:
// chord changes are rarely faster than an 8th note and a coarser grid
// reads cleaner on the chord chart, while a melody line wants the
// finer 16th-note grid to keep its actual rhythm recognizable. Passed
// through explicitly rather than each pipeline function defaulting it
// separately, so a chart's saved `chordsQuantization`/
// `melodyQuantization` fields (songStorage.js's buildChartData)
// round-trip through re-recording without silently drifting.
export const DEFAULT_CHORDS_SUBDIVISIONS_PER_BEAT = 2;
export const DEFAULT_MELODY_SUBDIVISIONS_PER_BEAT = 4;

// How hard melody quantization snaps to that grid (see theory.js's
// quantizeBeat) -- full strength (1) is a strict nearest-neighbor snap,
// which has no way to tell "played a little early on purpose" apart
// from ordinary human timing looseness; this default softens that so a
// real take's own feel comes through instead of being flattened onto
// grid lines. Chords don't get this treatment (processChordsPass never
// takes a strength) -- a chord *change* is a discrete decision already
// made by clustering, and its boundary benefits more from landing
// exactly on the grid (a clean chart) than from preserving hand-timing.
export const DEFAULT_MELODY_QUANTIZE_STRENGTH = 0.6;

// Whether two notes were "struck together" as one chord is a real-time
// question -- a natural hand roll's spread doesn't change just because
// the chosen *display* quantization grid is coarser or finer -- so
// clustering runs on raw, unquantized timing with this fixed threshold,
// entirely independent of subdivisionsPerBeat. Quantizing *before*
// clustering (this pipeline's old behavior) was a real bug: at a coarse
// grid (8th notes, 0.5 beats/step) a threshold wide enough to bridge
// one grid step of rounding error is *wider than a normal chord-change
// spacing*, so two genuinely different chords a routine eighth-note
// apart would get merged into one unrecognizable cluster. Clustering
// first and quantizing the result afterward (below) sidesteps that
// tension completely: this threshold only ever has to reason about a
// real hand roll, never about the display grid.
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
 *
 * Notes too brief or too soft to be a deliberately played chord tone
 * (dropAccidentalTouches) are filtered out before clustering -- an
 * accidentally brushed adjacent key otherwise either gets folded into
 * the chord as a wrong extra pitch class, or breaks recognition
 * outright (detectChords throws on a cluster that doesn't form a
 * recognized shape).
 *
 * `beatsPerBar` is the song's time signature (its numerator, treating
 * the beat as a quarter note) -- defaults to 4/4, but the trailing-
 * silence trim and the 4-bar rounding both measure "a bar" in these
 * terms, so a 3/4 song's bars/pickup/count-in are 3 beats long, not 4.
 */
export function processChordsPass(
  rawMessages,
  tempo,
  captureDurationSeconds,
  subdivisionsPerBeat = DEFAULT_CHORDS_SUBDIVISIONS_PER_BEAT,
  beatsPerBar = DEFAULT_BEATS_PER_BAR
) {
  // endTimestamp = the capture boundary itself, so a chord still held
  // when stop() was pressed (the normal case) closes there instead of
  // being dropped for never getting an explicit note-off.
  const rawNotes = secondsToBeats(dropAccidentalTouches(messagesToNotes(rawMessages, captureDurationSeconds)), tempo);
  const rawChords = mergeConsecutiveChords(detectChords(rawNotes, CHORD_CLUSTER_THRESHOLD_BEATS));
  // Only *now*, after clustering has already decided which notes are
  // one chord, does the display grid come in -- purely rounding each
  // chord's boundaries to it, same as any note (including the same
  // "never round away to nothing" guard quantizeNotes uses).
  const step = 1 / subdivisionsPerBeat;
  const chords = rawChords.map((c) => {
    const start = quantizeBeat(c.start, subdivisionsPerBeat);
    let end = quantizeBeat(c.end, subdivisionsPerBeat);
    if (end <= start) end = start + step;
    return { ...c, start, end };
  });

  const rawTotalBeats = captureDurationSeconds * (tempo / 60);
  const trimmedBeats = trimTrailingEmptyBars(rawTotalBeats, chords.map((c) => c.start), beatsPerBar);
  const sectionLengthBeats = roundToBarInterval(trimmedBeats, 4, beatsPerBar);

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
 *
 * `quantizeStrength` (0-1, see theory.js's quantizeBeat) is how hard
 * notes snap to the grid -- full strength is a strict nearest-neighbor
 * snap, softer preserves more of the actual take's timing.
 *
 * `pickupBeats` defaults to PICKUP_BEATS (a full bar) but can be 0 --
 * a song that never needs a lead-in can skip the pickup bar entirely;
 * capturing then starts right on the downbeat, same as the chords pass.
 *
 * The melody is enforced monophonic (clipOverlappingNotes) right after
 * quantizing -- a held note released a little late, or quantization
 * rounding two notes' boundaries toward each other, routinely leaves
 * one note's end just past the next one's start, which is two notes
 * audibly ringing together in a line that's melodically one voice.
 */
export function processMelodyPass(
  rawMessages,
  tempo,
  sectionLengthBeats,
  subdivisionsPerBeat = DEFAULT_MELODY_SUBDIVISIONS_PER_BEAT,
  quantizeStrength = DEFAULT_MELODY_QUANTIZE_STRENGTH,
  pickupBeats = PICKUP_BEATS
) {
  const totalCaptureBeats = pickupBeats + sectionLengthBeats;
  // Same reasoning as processChordsPass: a melody note still held
  // when playback auto-stops should close there, not vanish.
  const captureDurationSeconds = totalCaptureBeats * (60 / tempo);
  const notes = clipOverlappingNotes(quantizeNotes(secondsToBeats(messagesToNotes(rawMessages, captureDurationSeconds), tempo), subdivisionsPerBeat, quantizeStrength))
    .map((n) => ({ ...n, start: n.start - pickupBeats, end: n.end - pickupBeats }))
    .filter((n) => n.start < sectionLengthBeats)
    .map((n) => ({ ...n, end: Math.min(n.end, sectionLengthBeats) }))
    // Clipping to the boundary above can turn a note that quantized
    // right onto it into a zero-length note -- drop those rather than
    // keep a note that plays for no time at all.
    .filter((n) => n.end > n.start);

  return { notes };
}
