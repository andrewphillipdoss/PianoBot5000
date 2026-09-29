/**
 * Turns one completed recording pass (raw captured MIDI messages) into
 * chart data -- the orchestration layer above theory.js's primitives.
 * Still pure: no Web MIDI, no audio, no React, fully testable with
 * fake message arrays. recordingSession.js (the real-time scheduler)
 * calls into this once a pass is done; it never runs mid-recording.
 */

import {
  clipOverlappingNotes,
  clusterOnsets,
  detectChords,
  dropAccidentalTouches,
  extractBassLine,
  extractTopLine,
  mergeConsecutiveChords,
  messagesToNotes,
  quantizeBeat,
  quantizeNotes,
  recognizeSectionBars,
  secondsToBeats,
} from './theory.js';

export const DEFAULT_BEATS_PER_BAR = 4; // a plain quarter-note beat per the time signature's numerator -- 3 for 3/4, 4 for 4/4, etc. (compound meters like 6/8 aren't modeled separately; pick the beat count that reads naturally)
export const BEATS_PER_BAR = DEFAULT_BEATS_PER_BAR; // kept as the fallback default throughout this file/its callers for a song that doesn't say otherwise

// One bar of lead-in captured before the section's downbeat during a
// melody or bassline take (against an existing length), so
// pickup/anacrusis notes have somewhere to go. Capturing already starts
// right when the count-in ends (see recordingSession.js's
// _beginCapturing) -- this is what that gap is *for*, rather than the
// section entering immediately. Notes played in
// it come back with a *negative* beat position (see processLinePass
// below), same as how a pickup measure is normally counted relative
// to the downbeat it leads into.
export const PICKUP_BEATS = BEATS_PER_BAR;

// How finely notes are snapped to the beat grid for display -- chosen
// on the record screen and section hub (quarter/8th/16th/32nd), these defaults
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

// How many metronome clicks per beat during recording (count-in and
// capture both) -- 1 clicks only on the beat itself, 2 (the default)
// adds a much quieter click on the in-between eighth as a subdivision
// guide. A song-level setting (like beatsPerBar), not a chords-vs-
// melody one -- it's about how the click *feels* to play along with,
// not the pass being recorded.
export const DEFAULT_METRONOME_SUBDIVISIONS_PER_BEAT = 2;

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
 * Every take is one of two kinds, decided purely by whether the
 * section already has a length (`sectionLengthBeats` null or not):
 *
 *   - The *first* take recorded in a section -- whichever part it is --
 *     sets the section's length. It runs open-ended until the player
 *     stops it, and the length is recognized from what was played (see
 *     theory.js's recognizeSectionBars): empty bars at either end are
 *     dropped, and the rest is counted in whole bars, preferring a
 *     4-bar (then 2-bar) phrase when a held final chord makes that a
 *     fair reading. `captureDurationSeconds` (how long it actually ran,
 *     from recordingSession.js's own clock) is required here, not
 *     derived from the notes: dead air has no MIDI message at all.
 *   - Every take after that plays back against the section's existing
 *     length and auto-stops there, clipped to it.
 *
 * `beatsPerBar` is the song's time signature (its numerator) -- "a
 * bar" is measured in its terms.
 */
function withRecognizedLength(events, captureDurationSeconds, tempo, beatsPerBar) {
  const { startBar, bars } = recognizeSectionBars(events, captureDurationSeconds * (tempo / 60), beatsPerBar);
  const shift = startBar * beatsPerBar;
  const sectionLengthBeats = bars * beatsPerBar;
  const shifted = events.map((e) => ({ ...e, start: e.start - shift, end: e.end - shift }));
  return { events: clipToSectionLength(shifted, sectionLengthBeats), sectionLengthBeats };
}

/**
 * Drop anything starting at or past the section's end, and cut short
 * anything spilling over it -- including dropping whatever that leaves
 * zero-length, rather than keep an event that lasts no time at all.
 * Works on any {start, end} shape: chords and notes alike.
 */
export function clipToSectionLength(events, sectionLengthBeats) {
  return events
    .filter((e) => e.start < sectionLengthBeats)
    .map((e) => ({ ...e, end: Math.min(e.end, sectionLengthBeats) }))
    .filter((e) => e.end > e.start);
}

/**
 * A completed chords take -> { chords, sectionLengthBeats, skippedClusterCount }.
 * Capturing always starts right on the downbeat (no pickup bar -- a
 * chord change leading into a section isn't a thing the chart models).
 *
 * Notes too brief or too soft to be a deliberately played chord tone
 * (dropAccidentalTouches) are filtered out before clustering; each
 * cluster is then recognized as a chord, denoised if one slipped note
 * spoils it, or dropped if even that can't make sense of it (see
 * theory.js's detectChords) -- `skippedClusterCount` says how many were
 * dropped, so the UI can mention it without failing the take.
 */
export function processChordsPass(
  rawMessages,
  tempo,
  { captureDurationSeconds = null, sectionLengthBeats = null, subdivisionsPerBeat = DEFAULT_CHORDS_SUBDIVISIONS_PER_BEAT, beatsPerBar = DEFAULT_BEATS_PER_BAR } = {}
) {
  const setsLength = sectionLengthBeats === null;
  // A chord still held when the take ends (the normal case) closes at
  // the capture boundary rather than vanishing for lack of a note-off.
  const durationSeconds = captureDurationSeconds ?? sectionLengthBeats * (60 / tempo);
  const rawNotes = secondsToBeats(dropAccidentalTouches(messagesToNotes(rawMessages, durationSeconds)), tempo);
  const detectedChords = detectChords(rawNotes, CHORD_CLUSTER_THRESHOLD_BEATS);
  // detectChords returns one entry per *recognized* cluster -- the gap
  // between that and the total cluster count is exactly how many were
  // dropped.
  const skippedClusterCount = clusterOnsets(rawNotes, CHORD_CLUSTER_THRESHOLD_BEATS).length - detectedChords.length;
  // Only *now*, after clustering has already decided which notes are
  // one chord, does the display grid come in -- purely rounding each
  // chord's boundaries to it, with the same "never round away to
  // nothing" guard quantizeNotes uses.
  const step = 1 / subdivisionsPerBeat;
  const chords = mergeConsecutiveChords(detectedChords).map((c) => {
    const start = quantizeBeat(c.start, subdivisionsPerBeat);
    let end = quantizeBeat(c.end, subdivisionsPerBeat);
    if (end <= start) end = start + step;
    return { ...c, start, end };
  });

  if (setsLength) {
    const recognized = withRecognizedLength(chords, durationSeconds, tempo, beatsPerBar);
    return { chords: recognized.events, sectionLengthBeats: recognized.sectionLengthBeats, skippedClusterCount };
  }
  return { chords: clipToSectionLength(chords, sectionLengthBeats), sectionLengthBeats, skippedClusterCount };
}

/**
 * A completed melody or bassline take -> { notes, sectionLengthBeats }.
 * The same processing for both, differing only in which single voice
 * gets pulled out of whatever was actually played (see theory.js):
 * melody is the top line (extractTopLine), bassline the bottom line
 * (extractBassLine). Either way a take can be as messy as playing
 * naturally with both hands -- the rest of the texture just falls away.
 *
 * A take recorded against an existing length can start with a pickup
 * bar (`pickupBeats`, 0 to skip it) -- capturing begins that far ahead
 * of the section's downbeat, so a pickup note comes back with a
 * *negative* start rather than being lost. The take that sets the
 * section's length never has one: there's no downbeat to lead into yet.
 *
 * `quantizeStrength` (0-1, see theory.js's quantizeBeat) is how hard
 * notes snap to the grid. The line is then enforced monophonic
 * (clipOverlappingNotes) -- a note released a little late, or two
 * boundaries rounding toward each other, otherwise leaves two notes
 * ringing together in a line that's one voice.
 */
export function processLinePass(
  part,
  rawMessages,
  tempo,
  {
    captureDurationSeconds = null,
    sectionLengthBeats = null,
    subdivisionsPerBeat = DEFAULT_MELODY_SUBDIVISIONS_PER_BEAT,
    quantizeStrength = DEFAULT_MELODY_QUANTIZE_STRENGTH,
    pickupBeats = PICKUP_BEATS,
    beatsPerBar = DEFAULT_BEATS_PER_BAR,
  } = {}
) {
  const setsLength = sectionLengthBeats === null;
  const pickup = setsLength ? 0 : pickupBeats;
  const durationSeconds = captureDurationSeconds ?? (pickup + sectionLengthBeats) * (60 / tempo);
  // Extraction works in real seconds, before converting to beats --
  // "struck together" and "legato overlap" are physical-timing
  // questions, not tempo-relative ones.
  const played = messagesToNotes(rawMessages, durationSeconds);
  const line = part === 'bassline' ? extractBassLine(played) : extractTopLine(played);
  const notes = clipOverlappingNotes(quantizeNotes(secondsToBeats(line, tempo), subdivisionsPerBeat, quantizeStrength)).map((n) => ({
    ...n,
    start: n.start - pickup,
    end: n.end - pickup,
  }));

  if (setsLength) {
    const recognized = withRecognizedLength(notes, durationSeconds, tempo, beatsPerBar);
    return { notes: recognized.events, sectionLengthBeats: recognized.sectionLengthBeats };
  }
  return { notes: clipToSectionLength(notes, sectionLengthBeats), sectionLengthBeats };
}

/** One completed take of any part -- the single entry point recordingSession.js and the section hub both use. */
export function processTake(part, rawMessages, tempo, options) {
  return part === 'chords' ? processChordsPass(rawMessages, tempo, options) : processLinePass(part, rawMessages, tempo, options);
}
