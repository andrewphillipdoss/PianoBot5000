/**
 * Pure music-theory / signal-processing logic for the recorder: turning
 * raw, live-captured MIDI notes into a Chart's chords/melody. No React,
 * no Web MIDI, no file I/O -- plain functions over plain data, so this
 * is unit-testable without a browser or a real keyboard, same spirit as
 * pianobot5000's own theory.py (this is a JS port of the pieces the
 * recorder specifically needs: chord recognition in reverse, light
 * quantization, and the "chords pass is authoritative" bar-trimming
 * rule -- not the arranger's voicing/comping logic, which stays
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

/**
 * The pitch class of the note(s) at the very bottom of a cluster, if
 * they're distinguishable as their own "bass note" group -- a single
 * low note, or that same note doubled an octave (or several) up,
 * exactly what a player's left hand plays as a bass note under a chord
 * voiced above it. Concretely: every note from the bottom that shares
 * the lowest note's own pitch class, with nothing of a *different*
 * pitch class below the first note that isn't. Returns null only if
 * the whole cluster is a single pitch class (which isn't a chord at
 * all, so `detectChords` below never actually gets there).
 *
 * This says nothing yet about whether that note is slash-worthy --
 * only that it's *structurally* separate from whatever's played above
 * it. A plain root-position chord (bass note = the chord's own root,
 * doubled or not) passes through this exactly the same way a real
 * slash chord does; `detectChords` decides slash-worthiness by
 * comparing this against the chord's actual detected root afterward.
 */
function isolatedBassPitchClass(sortedPitches) {
  const lowPitchClass = sortedPitches[0] % 12;
  let i = 1;
  while (i < sortedPitches.length && sortedPitches[i] % 12 === lowPitchClass) i++;
  return i < sortedPitches.length ? lowPitchClass : null;
}

/**
 * Turn a captured left-hand (chords) take into ChordEvents. A cluster
 * whose pitch classes don't form a recognizable chord shape (see
 * `detectChordQuality`) -- a single stray note from an accidental
 * melodic run mixed into the take, an incomplete voicing, whatever --
 * is dropped rather than kept as a guess, but does NOT fail the whole
 * take: every other, genuinely recognizable cluster is still returned.
 * One bad cluster costing an entire otherwise-good take (re-recording
 * every real chord in it just to fix one moment) is worse than a small
 * gap in the chart at that one spot; `processChordsPass` in
 * recordingPipeline.js surfaces how many clusters were skipped this
 * way, for the UI to mention without blocking on it.
 *
 * `bassPitchClass` on the result names the isolated bass note (see
 * above) whenever the cluster has one -- `formatChordSymbol` shows it
 * as a slash chord only when it differs from the detected root, so a
 * plain root-position voicing (by far the common case) is unaffected.
 * Two whole-cluster shapes are recognized:
 *   - The bass note *is* one of the chord's own tones, just voiced
 *     lowest (a genuine inversion, e.g. E-G-C read as C/E) or simply
 *     doubled under a root-position chord (no slash, same as always)
 *     -- the combined pitch-class set alone already spells a known
 *     triad/7th, so this is tried first and covers both.
 *   - The bass note is *foreign* to the chord above it entirely (e.g.
 *     a C triad over a D bass, common in hymns/pop) -- the combined
 *     set doesn't spell anything recognizable, but the notes *above*
 *     the isolated bass, on their own, might.
 */
export function detectChords(notes, thresholdBeats = 0.15) {
  const chords = [];
  for (const cluster of clusterOnsets(notes, thresholdBeats)) {
    const pitches = cluster.map((n) => n.pitch).sort((a, b) => a - b);
    const pitchClasses = cluster.map((n) => n.pitch % 12);
    const isolatedBass = isolatedBassPitchClass(pitches);

    let detected = detectChordQuality(pitchClasses, pitches[0] % 12);
    if (!detected && isolatedBass !== null) {
      const upperPitchClasses = [...new Set(pitches.filter((p) => p % 12 !== isolatedBass).map((p) => p % 12))];
      detected = detectChordQuality(upperPitchClasses);
    }

    if (!detected) continue; // not a recognizable shape -- skip this one cluster, keep the rest of the take

    chords.push({
      rootPitchClass: detected.rootPitchClass,
      quality: detected.quality,
      bassPitchClass: isolatedBass ?? detected.rootPitchClass,
      start: Math.min(...cluster.map((n) => n.start)),
      end: Math.max(...cluster.map((n) => n.end)),
    });
  }
  return chords;
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

/**
 * Walk backward from the end of a raw take, dropping any trailing bar
 * with no chord onset in it -- the fix for "there's dead air before I
 * can get back to the spacebar" (see the project's own design
 * discussion): only *trailing* bars are ever dropped, never one in
 * the middle, since removing time from the middle would desync every
 * later chord from what was actually played next.
 */
export function trimTrailingEmptyBars(totalBeats, chordOnsetsBeats, beatsPerBar = 4) {
  const totalBars = Math.ceil(totalBeats / beatsPerBar);
  let lastNonEmptyBar = -1;
  for (const onset of chordOnsetsBeats) {
    const bar = Math.floor(onset / beatsPerBar);
    if (bar > lastNonEmptyBar) lastNonEmptyBar = bar;
  }
  if (lastNonEmptyBar === -1) return 0;
  const keptBars = Math.min(lastNonEmptyBar + 1, totalBars);
  return keptBars * beatsPerBar;
}

const DEFAULT_VOICING_BASE_MIDI = 48; // C3

/**
 * A plain close-position voicing (root, third, fifth[, seventh]) for
 * a detected chord -- not the arranger's voice-leading logic (that
 * chooses inversions to minimize movement between chords), just
 * enough to make a recorded chord audible when it plays back during
 * the melody pass. `bassPitchClass`, when given and different from
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

/** Round a beat length to the nearest multiple of `intervalBars` bars (default: 4). */
export function roundToBarInterval(beats, intervalBars = 4, beatsPerBar = 4) {
  const step = intervalBars * beatsPerBar;
  const rounded = Math.round(beats / step) * step;
  return rounded === 0 ? step : rounded;
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
