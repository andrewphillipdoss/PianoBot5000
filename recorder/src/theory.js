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

/**
 * The reverse of chord voicing: given the pitch classes actually
 * played (0-11, octave-independent) plus optionally which one was the
 * physical bass note, figure out which root + triad quality they
 * spell. Returns null if the set isn't a recognizable triad (wrong
 * number of distinct pitch classes, or an interval pattern that
 * doesn't match maj/min/dim/aug).
 *
 * `bassPitchClass` breaks the one real ambiguity here: an augmented
 * triad is symmetric (every one of its 3 notes is a valid "root" by
 * pure interval pattern alone), so {C, E, G#} played as root position
 * vs. its own inversions is otherwise indistinguishable -- preferring
 * whichever candidate's root is the actual lowest note played
 * resolves it the way a real musician would read it.
 */
export function detectChordQuality(pitchClasses, bassPitchClass = null) {
  const pcSet = new Set(pitchClasses);
  if (pcSet.size !== 3) return null;

  const matches = [];
  for (const root of [...pcSet].sort((a, b) => a - b)) {
    for (const quality of Object.keys(TRIAD_INTERVALS)) {
      const [, third, fifth] = TRIAD_INTERVALS[quality];
      const candidate = new Set([root, (root + third) % 12, (root + fifth) % 12]);
      if (candidate.size === pcSet.size && [...candidate].every((pc) => pcSet.has(pc))) {
        matches.push({ rootPitchClass: root, quality });
      }
    }
  }
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
 * cluster's pitch classes must form a recognizable triad (see
 * `detectChordQuality`) -- a cluster that doesn't is a real problem
 * with the take (an extra/missing note), so this throws with the beat
 * position and pitches involved rather than silently guessing, so the
 * UI can point at exactly what to re-record.
 */
export function detectChords(notes, thresholdBeats = 0.15) {
  return clusterOnsets(notes, thresholdBeats).map((cluster) => {
    const pitchClasses = cluster.map((n) => n.pitch % 12);
    const bass = cluster.reduce((min, n) => (n.pitch < min.pitch ? n : min));
    const detected = detectChordQuality(pitchClasses, bass.pitch % 12);
    if (!detected) {
      const pitches = [...cluster].sort((a, b) => a.pitch - b.pitch).map((n) => n.pitch);
      throw new Error(
        `couldn't recognize a triad at beat ${cluster[0].start.toFixed(2)}: pitches ` +
          `[${pitches.join(', ')}] (pitch classes [${[...new Set(pitchClasses)].sort((a, b) => a - b).join(', ')}]) -- ` +
          'expected exactly 3 distinct pitch classes forming a maj/min/dim/aug triad'
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
