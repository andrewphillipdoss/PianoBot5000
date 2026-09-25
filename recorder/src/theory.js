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
 * Snap every note's start/end (already in beats) onto the nearest
 * grid point, `subdivisionsPerBeat` steps per beat (4 = 16th-note
 * resolution, matching pianobot5000's own default elsewhere). This is
 * deliberately light -- just enough to remove hand-timing jitter, not
 * enough to erase real rhythmic intent. A note that would collapse to
 * zero length after snapping is nudged to one grid step instead of
 * being dropped, since every captured note was a real keystroke.
 */
export function quantizeNotes(notes, subdivisionsPerBeat = 4) {
  const step = 1 / subdivisionsPerBeat;
  return notes.map((note) => {
    let start = Math.round(note.start / step) * step;
    let end = Math.round(note.end / step) * step;
    if (end <= start) end = start + step;
    return { ...note, start, end };
  });
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

/** Round a beat length to the nearest multiple of `intervalBars` bars (default: 4). */
export function roundToBarInterval(beats, intervalBars = 4, beatsPerBar = 4) {
  const step = intervalBars * beatsPerBar;
  const rounded = Math.round(beats / step) * step;
  return rounded === 0 ? step : rounded;
}

/**
 * Turn a chronological stream of {timestamp, type, note, velocity}
 * MIDI events (timestamps in seconds from the start of a recording
 * pass) into NoteEvents. A "note off" is either an actual `noteoff`
 * message or a `noteon` with velocity 0 (both are standard,
 * interchangeable MIDI conventions -- most real keyboards send the
 * latter). A note-on for a pitch that's already sounding implicitly
 * closes the previous one at the new onset, rather than crashing on a
 * stuck/duplicate note-on.
 */
export function messagesToNotes(messages) {
  const open = new Map(); // pitch -> {onset, velocity}
  const notes = [];

  for (const { timestamp, type, note, velocity } of messages) {
    const isNoteOff = type === 'noteoff' || (type === 'noteon' && velocity === 0);
    if (type === 'noteon' && velocity > 0) {
      if (open.has(note)) {
        const { onset, velocity: v } = open.get(note);
        if (timestamp > onset) notes.push({ pitch: note, start: onset, end: timestamp, velocity: v });
      }
      open.set(note, { onset: timestamp, velocity });
    } else if (isNoteOff && open.has(note)) {
      const { onset, velocity: v } = open.get(note);
      if (timestamp > onset) notes.push({ pitch: note, start: onset, end: timestamp, velocity: v });
      open.delete(note);
    }
  }

  return notes.sort((a, b) => a.start - b.start);
}

/** Convert raw captured notes (seconds) into beats, given the pass's tempo (BPM). */
export function secondsToBeats(notes, tempo) {
  const beatsPerSecond = tempo / 60;
  return notes.map((n) => ({ ...n, start: n.start * beatsPerSecond, end: n.end * beatsPerSecond }));
}
