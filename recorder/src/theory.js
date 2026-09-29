/**
 * Pure music-theory / signal-processing logic for the recorder: turning
 * raw, live-captured MIDI notes into a Chart's chords/melody. No React,
 * no Web MIDI, no file I/O -- plain functions over plain data, so this
 * is unit-testable without a browser or a real keyboard, same spirit as
 * pianobot5000's own theory.py (this is a JS port of the pieces the
 * recorder specifically needs: chord recognition in reverse, light
 * quantization, and recognizing a section's length from the take
 * that sets it -- not the arranger's voicing/comping logic, which stays
 * server-side in the existing Python CLI).
 */

// Triad ("3-note chord," in the loose sense that includes sus chords
// even though they're not strictly tertian) intervals in semitones
// above the root -- the same table pianobot5000's theory.py uses to
// *voice* a chord; here we use it in reverse, to *recognize* one from
// the pitch classes actually played. sus2/sus4 replace the 3rd with a
// major 2nd/perfect 4th -- standard chord vocabulary (see e.g. Kostka &
// Payne, Tonal Harmony), just not tertian, which is why they're not
// "major/minor/diminished/augmented" like the rest of this table.
//
// sus2 and sus4 are also each other's pitch-class set from a different
// root by construction -- {C,F,G} is both Csus4 (root C, a 4th above)
// and Fsus2 (root F, a 2nd below its own 5th) -- exactly the same
// symmetric-shape ambiguity augmented triads and diminished 7ths
// already have below; `detectChordQuality`'s bassPitchClass tie-break
// resolves it exactly the same way, for free.
export const TRIAD_INTERVALS = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
};

// Four-distinct-pitch-class shapes: the standard 7th chords (dominant,
// major, minor, half-diminished, diminished, minor-major) plus the two
// 6th chords (a major/minor triad with an added 6th instead of a 7th --
// standard in both classical and jazz vocabulary, common as a final
// "home" chord in a way a plain triad sometimes isn't).
export const FOUR_NOTE_INTERVALS = {
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10], // half-diminished
  dim7: [0, 3, 6, 9],
  minMaj7: [0, 3, 7, 11],
  maj6: [0, 4, 7, 9],
  min6: [0, 3, 7, 9],
};

// Five-distinct-pitch-class shapes: 7th chords with an added 9th (a
// major 2nd, an octave up -- 14 semitones, mod 12 = 2) stacked on top.
// The extended-tertian vocabulary genuinely keeps going past this
// (11ths, 13ths -- see e.g. Mark Levine, The Jazz Theory Book), but
// those need 6-7 distinct pitch classes, which a 10-fingered piano
// chord essentially never actually produces in one cluster -- there's
// a real, low ceiling on how much of this vocabulary is worth chasing.
export const FIVE_NOTE_INTERVALS = {
  dom9: [0, 4, 7, 10, 2],
  maj9: [0, 4, 7, 11, 2],
  min9: [0, 3, 7, 10, 2],
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI pitch number -> note name, e.g. 60 -> "C4" (MIDI's own convention: middle C = C4). */
export function midiNoteName(pitch) {
  const octave = Math.floor(pitch / 12) - 1;
  return `${NOTE_NAMES[pitch % 12]}${octave}`;
}

const QUALITY_SUFFIX = {
  maj: '', min: 'm', dim: 'dim', aug: 'aug', sus2: 'sus2', sus4: 'sus4',
  dom7: '7', maj7: 'maj7', min7: 'm7', m7b5: 'm7b5', dim7: 'dim7', minMaj7: 'm(maj7)', maj6: '6', min6: 'm6',
  dom9: '9', maj9: 'maj9', min9: 'm9',
};

/**
 * (root pitch class, quality) -> a plain lead-sheet chord symbol, e.g.
 * (0, "min") -> "Cm". `bassPitchClass`, when given and different from
 * the root, appends standard slash notation, e.g. (0, "maj", 4) ->
 * "C/E" -- a C major triad voiced with E (its own 3rd) in the bass, or
 * just as validly a C triad over some unrelated bass note the player
 * struck underneath it; the symbol alone can't distinguish those (real
 * lead sheets can't either), and doesn't need to.
 */
export function formatChordSymbol(rootPitchClass, quality, bassPitchClass = null) {
  const symbol = `${NOTE_NAMES[rootPitchClass]}${QUALITY_SUFFIX[quality] ?? quality}`;
  return bassPitchClass !== null && bassPitchClass !== rootPitchClass ? `${symbol}/${NOTE_NAMES[bassPitchClass]}` : symbol;
}

const QUALITY_FROM_SUFFIX = Object.fromEntries(Object.entries(QUALITY_SUFFIX).map(([quality, suffix]) => [suffix, quality]));

/**
 * The reverse of `formatChordSymbol` -- a saved chart's chords are
 * stored as plain symbol strings (e.g. "Dm7"), not root/quality, so
 * anything that needs to *voice* an already-saved chord (song
 * playback) has to parse it back first. Returns null for anything
 * that doesn't parse as one of this app's own recognized symbols
 * (e.g. a hand-edited chart file), rather than throwing -- playback
 * skips a chord it can't make sense of instead of crashing outright.
 * `bassPitchClass` on the result is always present -- the root itself,
 * for a plain (non-slash) symbol, so callers that voice a chord never
 * need to special-case "no slash" as a separate shape from "slash."
 */
export function parseChordSymbol(symbol) {
  const [chordPart, bassPart] = symbol.split('/');
  const rootLength = chordPart[1] === '#' ? 2 : 1;
  const rootPitchClass = NOTE_NAMES.indexOf(chordPart.slice(0, rootLength));
  if (rootPitchClass === -1) return null;
  const quality = QUALITY_FROM_SUFFIX[chordPart.slice(rootLength)];
  if (!quality) return null;
  if (bassPart === undefined) return { rootPitchClass, quality, bassPitchClass: rootPitchClass };
  const bassPitchClass = NOTE_NAMES.indexOf(bassPart);
  if (bassPitchClass === -1) return null;
  return { rootPitchClass, quality, bassPitchClass };
}

function matchesAgainst(pcSet, intervalTable) {
  const matches = [];
  for (const root of [...pcSet].sort((a, b) => a - b)) {
    for (const quality of Object.keys(intervalTable)) {
      const candidate = new Set(intervalTable[quality].map((interval) => (root + interval) % 12));
      if (candidate.size === pcSet.size && [...candidate].every((pc) => pcSet.has(pc))) {
        matches.push({ rootPitchClass: root, quality });
      }
    }
  }
  return matches;
}

/**
 * The reverse of chord voicing: given the pitch classes actually
 * played (0-11, octave-independent) plus optionally which one was the
 * physical bass note, figure out which root + quality they spell --
 * a 3-note chord (against TRIAD_INTERVALS), a 4-note chord (against
 * FOUR_NOTE_INTERVALS), or a 5-note chord (against FIVE_NOTE_INTERVALS),
 * purely by how many *distinct* pitch classes were played. Returns null
 * for anything else (wrong note count, or an interval pattern that
 * doesn't match a known shape) -- there's a real, finite vocabulary
 * of recognized chords, not "any combination of notes."
 *
 * `bassPitchClass` breaks the real ambiguities in that vocabulary. Some
 * are one shape being symmetric with itself: an augmented triad, a
 * diminished 7th, and a sus2/sus4 pair are all *symmetric* (every one
 * of their notes is an equally valid "root" by pure interval pattern
 * alone -- e.g. {C, E, G#} is C augmented, E augmented, and G#
 * augmented all at once). Others are two genuinely *different* shapes
 * landing on the same pitch classes from different roots: a
 * half-diminished 7th always shares its 4 notes with the minor 6th
 * chord built a minor 3rd below its root (B-D-F-A is both Bm7b5 and
 * Dm6) -- a real, textbook relationship, not a bug in this table.
 * Either way, preferring whichever candidate's root is the actual
 * lowest note played resolves it the way a real musician would read it
 * off the keys.
 */
export function detectChordQuality(pitchClasses, bassPitchClass = null) {
  const pcSet = new Set(pitchClasses);
  const intervalTable = pcSet.size === 3 ? TRIAD_INTERVALS : pcSet.size === 4 ? FOUR_NOTE_INTERVALS : pcSet.size === 5 ? FIVE_NOTE_INTERVALS : null;
  if (!intervalTable) return null;

  const matches = matchesAgainst(pcSet, intervalTable);
  if (matches.length === 0) return null;
  if (bassPitchClass !== null) {
    const bassMatch = matches.find((m) => m.rootPitchClass === bassPitchClass);
    if (bassMatch) return bassMatch;
  }
  return matches[0];
}

/**
 * Snap one beat value toward the nearest grid point, `subdivisionsPerBeat`
 * steps per beat (4 = 16th-note resolution). `strength` (0-1) controls
 * how hard: 1 (the default) is a full snap, landing exactly on the grid
 * point, same as always; below that, the result is pulled only part of
 * the way there, keeping some of the original timing. A full snap is a
 * *nearest-neighbor* rule -- it has no way to tell "played a little
 * early on purpose" apart from "played a little early because real
 * human timing isn't a metronome," so a note sitting close to the
 * midpoint between two grid points can snap to a "surprising" one purely
 * because it happened to fall a few ms on the far side of that
 * midpoint. A lower strength softens exactly that failure mode, at the
 * cost of the result no longer landing exactly on the grid.
 */
export function quantizeBeat(beat, subdivisionsPerBeat = 4, strength = 1) {
  const step = 1 / subdivisionsPerBeat;
  const grid = Math.round(beat / step) * step;
  return beat + (grid - beat) * strength;
}

/**
 * Snap every note's start/end (already in beats) toward the nearest
 * grid point (see `quantizeBeat`) -- deliberately light at full
 * strength, just enough to remove hand-timing jitter, not enough to
 * erase real rhythmic intent; softer still at a lower `strength` (see
 * `quantizeBeat`). A note that would collapse to zero length after
 * snapping is nudged to one grid step instead of being dropped, since
 * every captured note was a real keystroke.
 */
export function quantizeNotes(notes, subdivisionsPerBeat = 4, strength = 1) {
  const step = 1 / subdivisionsPerBeat;
  return notes.map((note) => {
    let start = quantizeBeat(note.start, subdivisionsPerBeat, strength);
    let end = quantizeBeat(note.end, subdivisionsPerBeat, strength);
    if (end <= start) end = start + step;
    return { ...note, start, end };
  });
}

/**
 * Enforce a single-voice melody line: sorted by start, clip each
 * note's end so it never runs past the start of the next one, rather
 * than leaving two notes overlapping and audibly ringing together.
 * Real playing (a held note released a little late, quantization
 * rounding a boundary the "wrong" way) routinely produces exactly this
 * overlap for a line that's melodically monophonic by intent -- this
 * doesn't re-detect anything, it just makes the data match that
 * intent. Only ever shortens `end`, never touches `start`, so a chain
 * of several overlapping notes is corrected in one pass (each note's
 * clip depends only on the next note's own, unmodified start). A note
 * clipped down to zero length or less (e.g. two notes quantized onto
 * the very same start) is dropped rather than kept as an inaudible
 * sliver.
 */
export function clipOverlappingNotes(notes) {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  return sorted
    .map((note, i) => {
      const next = sorted[i + 1];
      return next && note.end > next.start ? { ...note, end: next.start } : note;
    })
    .filter((note) => note.end > note.start);
}

/**
 * Group notes into "struck together" clusters for chord recognition:
 * sorted by onset, a note joins the current cluster if it starts
 * within `thresholdBeats` of that cluster's *first* note (not the
 * most recently added one, which would let a slow roll drift the
 * cluster arbitrarily far from where it started).
 */
export function clusterOnsets(notes, thresholdBeats = 0.15) {
  const ordered = [...notes].sort((a, b) => a.start - b.start);
  const clusters = [];
  for (const note of ordered) {
    const current = clusters[clusters.length - 1];
    if (current && note.start - current[0].start <= thresholdBeats) {
      current.push(note);
    } else {
      clusters.push([note]);
    }
  }
  return clusters;
}

// A deliberate bass note stands apart from the voicing above it -- more
// than a whole step below it. Anything closer is crowded against the
// chord, which is what a slipped finger looks like, not a bass line.
const FOREIGN_BASS_MIN_GAP_SEMITONES = 3;

/**
 * The pitch class of the bottom note(s) of a cluster, if they read as
 * a deliberate bass note *foreign* to the voicing above: a single low
 * note (or that note doubled an octave or more up) that sits at least
 * FOREIGN_BASS_MIN_GAP_SEMITONES below everything else and doesn't
 * recur anywhere in the voicing above it (if it did, it'd be one of the
 * chord's own tones -- an inversion, not a slash chord). Null otherwise.
 */
function foreignBassPitchClass(sortedPitches) {
  const lowPitchClass = sortedPitches[0] % 12;
  let i = 1;
  while (i < sortedPitches.length && sortedPitches[i] % 12 === lowPitchClass) i++;
  if (i === sortedPitches.length) return null;
  const upper = sortedPitches.slice(i);
  if (upper[0] - sortedPitches[i - 1] < FOREIGN_BASS_MIN_GAP_SEMITONES) return null;
  if (upper.some((p) => p % 12 === lowPitchClass)) return null;
  return lowPitchClass;
}

function spanOf(notes) {
  return { start: Math.min(...notes.map((n) => n.start)), end: Math.max(...notes.map((n) => n.end)) };
}

// Most slip-like first: a slip is rarely the bottom note (the bass is
// the most deliberate note a hand plays), and it's usually a glancing
// blow -- softer and shorter than the notes actually meant.
function compareSlipLikeness(a, b) {
  return a.includesLowest - b.includesLowest || a.velocity - b.velocity || a.duration - b.duration;
}

/**
 * The denoising step: if removing exactly one pitch class from a
 * cluster (a slipped finger, a stray note struck along with the chord)
 * leaves a recognizable chord one size down, that note was noise. When
 * more than one removal works, the most slip-like one wins (see
 * compareSlipLikeness); a genuine tie stays unrecognized rather than
 * guessed at. Returns { match, kept } or null.
 */
function matchWithoutOneSlip(cluster) {
  const distinct = [...new Set(cluster.map((n) => n.pitch % 12))];
  if (distinct.length < 4) return null;
  const lowest = Math.min(...cluster.map((n) => n.pitch));

  const candidates = [];
  for (const pitchClass of distinct) {
    const kept = cluster.filter((n) => n.pitch % 12 !== pitchClass);
    const keptLowest = Math.min(...kept.map((n) => n.pitch));
    const match = detectChordQuality(kept.map((n) => n.pitch % 12), keptLowest % 12);
    if (!match) continue;
    const dropped = cluster.filter((n) => n.pitch % 12 === pitchClass);
    candidates.push({
      match,
      kept,
      includesLowest: dropped.some((n) => n.pitch === lowest) ? 1 : 0,
      velocity: Math.max(...dropped.map((n) => n.velocity ?? 0)),
      duration: Math.max(...dropped.map((n) => n.end - n.start)),
    });
  }

  candidates.sort(compareSlipLikeness);
  if (candidates.length === 0) return null;
  if (candidates.length > 1 && compareSlipLikeness(candidates[0], candidates[1]) === 0) return null;
  return candidates[0];
}

/**
 * One struck cluster -> a ChordEvent, or null if it can't be made sense
 * of. Three readings, most literal first:
 *   1. The whole cluster spells a known chord. Covers inversions and
 *      doubled roots too -- those are the same chord, just voiced
 *      differently, so they're never shown as slash chords.
 *   2. A foreign bass note under a known chord (e.g. a C triad over a
 *      D, written `C/D`) -- see foreignBassPitchClass for what counts.
 *   3. A known chord with one slipped note in it -- see
 *      matchWithoutOneSlip. The slip is dropped entirely: no slash, and
 *      its timing doesn't stretch the chord's own span either.
 */
function recognizeCluster(cluster) {
  const pitches = cluster.map((n) => n.pitch).sort((a, b) => a - b);

  const whole = detectChordQuality(cluster.map((n) => n.pitch % 12), pitches[0] % 12);
  if (whole) return { rootPitchClass: whole.rootPitchClass, quality: whole.quality, bassPitchClass: whole.rootPitchClass, ...spanOf(cluster) };

  const foreignBass = foreignBassPitchClass(pitches);
  if (foreignBass !== null) {
    const upper = detectChordQuality(pitches.filter((p) => p % 12 !== foreignBass).map((p) => p % 12));
    if (upper) return { rootPitchClass: upper.rootPitchClass, quality: upper.quality, bassPitchClass: foreignBass, ...spanOf(cluster) };
  }

  const denoised = matchWithoutOneSlip(cluster);
  if (denoised) {
    const { rootPitchClass, quality } = denoised.match;
    return { rootPitchClass, quality, bassPitchClass: rootPitchClass, ...spanOf(denoised.kept) };
  }

  return null;
}

/**
 * Turn a captured chords take into ChordEvents, one per struck cluster
 * (see recognizeCluster). A cluster that can't be made sense of even
 * after denoising -- a lone stray note between chords, a real hand
 * splat -- is dropped, but never fails the whole take: every other
 * recognizable cluster is still returned. `processChordsPass` in
 * recordingPipeline.js reports how many were dropped this way.
 */
export function detectChords(notes, thresholdBeats = 0.15) {
  return clusterOnsets(notes, thresholdBeats).map(recognizeCluster).filter(Boolean);
}

// Notes struck within this long of each other are one moment, not two
// -- a hand's natural spread when playing several notes "together".
const SIMULTANEOUS_ONSET_SECONDS = 0.05;
// A legato line hands off note to note with a little overlap; a note
// only masks a later one if it keeps sounding well past that.
const LEGATO_OVERLAP_SECONDS = 0.1;
// The top of the bass register -- middle C and below.
export const BASS_CEILING_MIDI = 60;

function extractOuterLine(notes, isMoreOuter, isEligible = () => true) {
  const candidates = clusterOnsets(notes, SIMULTANEOUS_ONSET_SECONDS)
    .map((moment) => moment.reduce((best, n) => (isMoreOuter(n.pitch, best.pitch) ? n : best)))
    .filter(isEligible);
  return candidates.filter(
    (c) => !notes.some((o) => o.start < c.start && o.end > c.start + LEGATO_OVERLAP_SECONDS && isMoreOuter(o.pitch, c.pitch))
  );
}

/**
 * The melody line of a take (NoteEvents, times in seconds): the highest
 * note of each struck moment, unless a still-higher note is already
 * sounding over it (a held melody note with accompaniment moving
 * underneath). Anything played below the melody just falls away, so a
 * melody take can include harmony or accompaniment without polluting it.
 */
export function extractTopLine(notes) {
  return extractOuterLine(notes, (a, b) => a > b);
}

/**
 * The bass line of a take -- the mirror of extractTopLine: the lowest
 * note of each struck moment (a single low note, or an octave, is the
 * clean case; a full chord contributes its bottom note), unless a
 * still-lower note is already sounding under it. Only notes at or
 * below BASS_CEILING_MIDI count at all -- a moment whose lowest note
 * sits above the bass register contributes nothing.
 */
export function extractBassLine(notes) {
  return extractOuterLine(notes, (a, b) => a < b, (n) => n.pitch <= BASS_CEILING_MIDI);
}

/**
 * Merge neighboring ChordEvents that are actually the same chord (same
 * root + quality + bass) into one longer entry. A chord re-struck for
 * rhythmic emphasis, or a sustain that happened to get detected as two
 * separate onsets, isn't a real chord *change* -- it shouldn't be
 * counted as one or drawn as a repeat of the same symbol; the merged
 * entry just extends to cover the combined duration. Only ever merges
 * immediate neighbors in the sequence -- the same chord coming back
 * later, with something else in between, is a real repeat, not this.
 *
 * Bass has to match too, not just root/quality: a walking bass under a
 * held chord (C, then C/E, then C/G) is exactly the kind of thing
 * slash notation exists to show, so it's a real change even though the
 * harmony above it never moved -- `bassPitchClass` being absent on
 * both sides (older data, or a caller not tracking it) compares equal
 * to itself either way, so this doesn't change behavior for anything
 * that never had the concept.
 */
export function mergeConsecutiveChords(chords) {
  const merged = [];
  for (const chord of chords) {
    const prev = merged[merged.length - 1];
    if (prev && prev.rootPitchClass === chord.rootPitchClass && prev.quality === chord.quality && prev.bassPitchClass === chord.bassPitchClass) {
      prev.end = chord.end;
    } else {
      merged.push({ ...chord });
    }
  }
  return merged;
}

// A note let go within this many beats of a barline hasn't really been
// held *into* the next bar -- it's just a legato release a hair late.
const HELD_INTO_BAR_MIN_BEATS = 1;

// Section lengths music tends to come in, most natural first: 4-bar
// phrases (4, 8, 12, 16...), then 2-bar ones.
const PHRASE_BAR_UNITS = [4, 2];

/**
 * Recognize how many bars a section is from the take that sets its
 * length -- what was actually played, not how long the recording ran.
 * `events` are notes or chords ({start, end} in beats from the end of
 * the count-in); `captureBeats` is how long the take ran.
 *
 *   - Whole empty bars at the very start (waiting a moment after the
 *     count-in) and at the very end (dead air while reaching for the
 *     stop key) aren't part of the section. Empty bars in the middle
 *     are -- that's a rest, and removing it would pull everything after
 *     it out of time.
 *   - The section is at least every bar something was *struck* in, and
 *     at most every bar something was still *sounding* in (a final
 *     chord held on). Within that range, a length that falls on a
 *     4-bar phrase wins, then a 2-bar one -- so an 8-bar tune whose last
 *     chord is struck in bar 7 and held through bar 8 reads as 8, while
 *     a 6-bar phrase stays 6, and a 5-bar one stays 5 rather than being
 *     rounded down and losing its last bar.
 *
 * @returns {{startBar: number, bars: number}} the first bar that's part
 *   of the section (bars before it are dropped) and how many there are.
 *   An empty take gives 4 bars, from the start.
 */
export function recognizeSectionBars(events, captureBeats, beatsPerBar = 4) {
  if (events.length === 0) return { startBar: 0, bars: 4 };
  const onsets = events.map((e) => e.start);
  const startBar = Math.max(0, Math.floor(Math.min(...onsets) / beatsPerBar));
  const struckBars = Math.floor(Math.max(...onsets) / beatsPerBar) + 1 - startBar;
  const soundingEnd = Math.min(Math.max(...events.map((e) => e.end)), captureBeats);
  const soundingBars = Math.max(struckBars, Math.ceil((soundingEnd - HELD_INTO_BAR_MIN_BEATS) / beatsPerBar) - startBar);

  for (const unit of PHRASE_BAR_UNITS) {
    for (let bars = struckBars; bars <= soundingBars; bars++) {
      if (bars % unit === 0) return { startBar, bars };
    }
  }
  return { startBar, bars: struckBars };
}

const DEFAULT_VOICING_BASE_MIDI = 48; // C3

/**
 * A plain close-position voicing (root, third, fifth[, seventh]) for
 * a detected chord -- not the arranger's voice-leading logic (that
 * chooses inversions to minimize movement between chords), just
 * enough to make a recorded chord audible when it plays back under
 * another part's take, or in song playback. `bassPitchClass`, when given and different from
 * the root (a slash chord), adds one more note a full octave below
 * `baseOctaveMidi` -- below every other note in the voicing, exactly
 * where a real bass note belongs -- rather than trying to fold it into
 * the close-position voicing itself.
 */
export function voiceChordSimple(rootPitchClass, quality, baseOctaveMidi = DEFAULT_VOICING_BASE_MIDI, bassPitchClass = null) {
  const intervals = TRIAD_INTERVALS[quality] ?? FOUR_NOTE_INTERVALS[quality] ?? FIVE_NOTE_INTERVALS[quality];
  if (!intervals) return [];
  const rootMidi = baseOctaveMidi + rootPitchClass;
  const voicing = intervals.map((interval) => rootMidi + interval);
  if (bassPitchClass !== null && bassPitchClass !== rootPitchClass) {
    voicing.unshift(baseOctaveMidi - 12 + bassPitchClass);
  }
  return voicing;
}

/**
 * Standard scale-degree names ("1", "b3", "5", "b7", "9", ...) for
 * each tone of a recognized chord quality, in the same order as
 * `voiceChordSimple`'s own voicing -- the "insignia" alongside a plain
 * letter-name chord symbol that shows what each note actually *is*
 * within the chord (root, third, fifth, seventh...), not just the
 * chord's name as a whole. Derived straight from this file's own
 * interval tables (a semitone offset only ever means one thing, with
 * exactly two standard exceptions handled explicitly below), so there's
 * one source of truth for a chord's shape, not two tables to keep in
 * sync by hand.
 *
 * The two exceptions: a whole step above the root (2 semitones) is
 * called "2" in a sus2 triad but "9" once there's a 7th somewhere in
 * the chord too (an "upper extension," in jazz-theory terms) -- which
 * one applies is decided by whether `quality` is a 3-note (TRIAD_INTERVALS)
 * or 5-note (FIVE_NOTE_INTERVALS) shape. And a diminished 7th chord's own
 * 7th is a *diminished* 7th (9 semitones, called "bb7" -- a double
 * flat) even though that's the exact same semitone distance as a plain
 * 6th -- true by construction (a fully diminished 7th chord stacks
 * three minor 3rds: 0, 3, 6, 9), not a simplification.
 */
export function describeChordTones(quality) {
  const intervals = TRIAD_INTERVALS[quality] ?? FOUR_NOTE_INTERVALS[quality] ?? FIVE_NOTE_INTERVALS[quality];
  if (!intervals) return [];
  const isTriad = quality in TRIAD_INTERVALS;
  return intervals.map((interval) => {
    if (quality === 'dim7' && interval === 9) return '♭♭7';
    switch (interval) {
      case 0: return '1';
      case 2: return isTriad ? '2' : '9';
      case 3: return '♭3';
      case 4: return '3';
      case 5: return '4';
      case 6: return '♭5';
      case 7: return '5';
      case 8: return '♯5';
      case 9: return '6';
      case 10: return '♭7';
      case 11: return '7';
      default: return `${interval}`;
    }
  });
}

// Some keyboards' key contacts "bounce" -- a single physical press can
// fire a second note-on for the same pitch a handful of milliseconds
// after the first, with no note-off in between. Without this guard,
// messagesToNotes reads that second note-on as "close the held note
// right now, a new one is starting" -- creating one genuine note plus
// a spurious near-zero-length phantom "double hit" the player never
// actually played. No intentional fast repeated note (a trill, a fast
// re-strike) is ever struck this close together, so a retriggering
// note-on inside this window is dropped as noise rather than kept.
const RETRIGGER_DEBOUNCE_SECONDS = 0.03;

/**
 * Turn a chronological stream of {timestamp, type, note, velocity}
 * MIDI events (timestamps in seconds from the start of a recording
 * pass) into NoteEvents. A "note off" is either an actual `noteoff`
 * message or a `noteon` with velocity 0 (both are standard,
 * interchangeable MIDI conventions -- most real keyboards send the
 * latter). A note-on for a pitch that's already sounding implicitly
 * closes the previous one at the new onset, rather than crashing on a
 * stuck/duplicate note-on -- unless it arrives within
 * RETRIGGER_DEBOUNCE_SECONDS of that note's own onset, in which case
 * it's treated as contact bounce (see above) and ignored outright.
 *
 * `endTimestamp`, if given, closes out any note still held when the
 * stream ends -- e.g. recording stopped while a chord was still
 * physically held down, which is the normal case, not an edge case:
 * without this, a note that never got an explicit note-off is
 * silently dropped entirely rather than ending at the true capture
 * boundary, which would lose the last chord of every take.
 */
export function messagesToNotes(messages, endTimestamp = null) {
  const open = new Map(); // pitch -> {onset, velocity}
  const notes = [];

  for (const { timestamp, type, note, velocity } of messages) {
    const isNoteOff = type === 'noteoff' || (type === 'noteon' && velocity === 0);
    if (type === 'noteon' && velocity > 0) {
      if (open.has(note)) {
        const { onset, velocity: v } = open.get(note);
        if (timestamp - onset < RETRIGGER_DEBOUNCE_SECONDS) continue; // bounce, not a real second strike -- keep the note already open
        if (timestamp > onset) notes.push({ pitch: note, start: onset, end: timestamp, velocity: v });
      }
      open.set(note, { onset: timestamp, velocity });
    } else if (isNoteOff && open.has(note)) {
      const { onset, velocity: v } = open.get(note);
      if (timestamp > onset) notes.push({ pitch: note, start: onset, end: timestamp, velocity: v });
      open.delete(note);
    }
  }

  if (endTimestamp !== null) {
    for (const [pitch, { onset, velocity }] of open) {
      if (endTimestamp > onset) notes.push({ pitch, start: onset, end: endTimestamp, velocity });
    }
  }

  return notes.sort((a, b) => a.start - b.start);
}

/**
 * Drop notes too brief or too soft to be a deliberately played chord
 * tone -- an accidentally brushed adjacent key, rather than a stray
 * note recognized *as* a note, tends to be both much shorter and much
 * softer than a note actually meant to be held as part of a chord.
 * Used only for chords (see recordingPipeline.js's processChordsPass):
 * a short, soft note in a melody line is routine (a grace note, a
 * staccato passage) and shouldn't be filtered there.
 */
export function dropAccidentalTouches(notes, { minDurationSeconds = 0.04, minVelocity = 10 } = {}) {
  return notes.filter((n) => n.end - n.start >= minDurationSeconds && n.velocity >= minVelocity);
}

/** Convert raw captured notes (seconds) into beats, given the pass's tempo (BPM). */
export function secondsToBeats(notes, tempo) {
  const beatsPerSecond = tempo / 60;
  return notes.map((n) => ({ ...n, start: n.start * beatsPerSecond, end: n.end * beatsPerSecond }));
}
