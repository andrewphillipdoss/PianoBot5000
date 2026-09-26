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

// Triad intervals in semitones above the root -- the same table
// pianobot5000's theory.py uses to *voice* a chord; here we use it in
// reverse, to *recognize* one from the pitch classes actually played.
export const TRIAD_INTERVALS = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
};

// Seventh-chord intervals -- same idea, one more note. Covers the
// vocabulary that actually shows up in hymns/standards (dominant,
// major, and minor 7ths, half-diminished, diminished); genuinely
// exotic shapes (9ths, sus chords, true slash chords) are left out on
// purpose -- see the recorder's design discussion for why.
export const SEVENTH_INTERVALS = {
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10], // half-diminished
  dim7: [0, 3, 6, 9],
  minMaj7: [0, 3, 7, 11],
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI pitch number -> note name, e.g. 60 -> "C4" (MIDI's own convention: middle C = C4). */
export function midiNoteName(pitch) {
  const octave = Math.floor(pitch / 12) - 1;
  return `${NOTE_NAMES[pitch % 12]}${octave}`;
}

const QUALITY_SUFFIX = {
  maj: '', min: 'm', dim: 'dim', aug: 'aug',
  dom7: '7', maj7: 'maj7', min7: 'm7', m7b5: 'm7b5', dim7: 'dim7', minMaj7: 'm(maj7)',
};

/** (root pitch class, quality) -> a plain lead-sheet chord symbol, e.g. (0, "min") -> "Cm". */
export function formatChordSymbol(rootPitchClass, quality) {
  return `${NOTE_NAMES[rootPitchClass]}${QUALITY_SUFFIX[quality] ?? quality}`;
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
 */
export function parseChordSymbol(symbol) {
  const rootLength = symbol[1] === '#' ? 2 : 1;
  const rootPitchClass = NOTE_NAMES.indexOf(symbol.slice(0, rootLength));
  if (rootPitchClass === -1) return null;
  const quality = QUALITY_FROM_SUFFIX[symbol.slice(rootLength)];
  if (!quality) return null;
  return { rootPitchClass, quality };
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
 * a triad (3 distinct pitch classes, against TRIAD_INTERVALS) or a
 * seventh chord (4, against SEVENTH_INTERVALS). Returns null for
 * anything else (wrong note count, or an interval pattern that
 * doesn't match a known shape) -- there's a real, finite vocabulary
 * of recognized chords, not "any combination of notes."
 *
 * `bassPitchClass` breaks the real ambiguities in that vocabulary:
 * an augmented triad and a diminished 7th are both *symmetric*
 * (every one of their notes is an equally valid "root" by pure
 * interval pattern alone -- e.g. {C, E, G#} is C augmented, E
 * augmented, and G# augmented all at once), so preferring whichever
 * candidate's root is the actual lowest note played resolves it the
 * way a real musician would read it off the keys.
 */
export function detectChordQuality(pitchClasses, bassPitchClass = null) {
  const pcSet = new Set(pitchClasses);
  const intervalTable = pcSet.size === 3 ? TRIAD_INTERVALS : pcSet.size === 4 ? SEVENTH_INTERVALS : null;
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
 * Turn a captured left-hand (chords) take into ChordEvents. Each
 * cluster's pitch classes must form a recognizable triad or seventh
 * chord (see `detectChordQuality`) -- a cluster that doesn't is a
 * real problem with the take (an extra/missing note), so this throws
 * with the beat position and pitches involved rather than silently
 * guessing, so the UI can point at exactly what to re-record.
 */
export function detectChords(notes, thresholdBeats = 0.15) {
  return clusterOnsets(notes, thresholdBeats).map((cluster) => {
    const pitchClasses = cluster.map((n) => n.pitch % 12);
    const bass = cluster.reduce((min, n) => (n.pitch < min.pitch ? n : min));
    const detected = detectChordQuality(pitchClasses, bass.pitch % 12);
    if (!detected) {
      const pitches = [...cluster].sort((a, b) => a.pitch - b.pitch).map((n) => n.pitch);
      throw new Error(
        `couldn't recognize a chord at beat ${cluster[0].start.toFixed(2)}: pitches ` +
          `[${pitches.join(', ')}] (pitch classes [${[...new Set(pitchClasses)].sort((a, b) => a - b).join(', ')}]) -- ` +
          'expected 3 distinct pitch classes forming a maj/min/dim/aug triad, or 4 forming a recognized 7th chord'
      );
    }
    return {
      rootPitchClass: detected.rootPitchClass,
      quality: detected.quality,
      start: Math.min(...cluster.map((n) => n.start)),
      end: Math.max(...cluster.map((n) => n.end)),
    };
  });
}

/**
 * Merge neighboring ChordEvents that are actually the same chord (same
 * root + quality) into one longer entry. A chord re-struck for
 * rhythmic emphasis, or a sustain that happened to get detected as two
 * separate onsets, isn't a real chord *change* -- it shouldn't be
 * counted as one or drawn as a repeat of the same symbol; the merged
 * entry just extends to cover the combined duration. Only ever merges
 * immediate neighbors in the sequence -- the same chord coming back
 * later, with something else in between, is a real repeat, not this.
 */
export function mergeConsecutiveChords(chords) {
  const merged = [];
  for (const chord of chords) {
    const prev = merged[merged.length - 1];
    if (prev && prev.rootPitchClass === chord.rootPitchClass && prev.quality === chord.quality) {
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
 * the melody pass.
 */
export function voiceChordSimple(rootPitchClass, quality, baseOctaveMidi = DEFAULT_VOICING_BASE_MIDI) {
  const intervals = TRIAD_INTERVALS[quality] ?? SEVENTH_INTERVALS[quality];
  if (!intervals) return [];
  const rootMidi = baseOctaveMidi + rootPitchClass;
  return intervals.map((interval) => rootMidi + interval);
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
