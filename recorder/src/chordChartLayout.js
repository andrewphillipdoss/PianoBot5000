/**
 * Pure layout logic for the Chord Chart: a section laid out the way a
 * lead sheet is -- as *measures*, every one the same width, each chord
 * placed at the beat it actually lands on. Where a bar starts and stops
 * is then something you can see at a glance, rather than something to
 * work out from how wide each chord's box happens to be.
 *
 * A chord held across a barline is split into one segment per measure
 * it touches; only the segment where it actually starts is its
 * `isStart` one (the one that gets the chord's name -- the rest just
 * show it continuing, same as an empty measure on a real chart means
 * "keep playing what you were").
 *
 * Works on the internal, section-relative ChordEvent shape ({start,
 * end} in beats from the section's downbeat -- see theory.js); callers
 * holding on-disk entries convert first (songStorage.js's
 * sectionChordsAsInternal).
 */

export const DEFAULT_BEATS_PER_BAR = 4;

/**
 * @returns {{number: number, startBeat: number, segments: {chord: object, from: number, to: number, isStart: boolean}[]}[]}
 *   one entry per measure, in order -- `from`/`to` are beats within that
 *   measure (0 to beatsPerBar). With a `sectionLengthBeats`, that's
 *   exactly how many measures there are (empty ones included, and
 *   anything past the end cut off); without one, just enough to hold
 *   every chord.
 */
export function layoutMeasures(chords, { sectionLengthBeats = null, beatsPerBar = DEFAULT_BEATS_PER_BAR } = {}) {
  const totalBeats = sectionLengthBeats ?? Math.max(0, ...chords.map((c) => c.end));
  const measureCount = Math.max(1, Math.ceil(totalBeats / beatsPerBar - 1e-9));
  const endBeat = measureCount * beatsPerBar;
  const measures = Array.from({ length: measureCount }, (_, i) => ({ number: i + 1, startBeat: i * beatsPerBar, segments: [] }));

  for (const chord of chords) {
    const start = Math.max(0, chord.start);
    const end = Math.min(chord.end, endBeat);
    if (end <= start) continue;
    const firstMeasure = Math.floor(start / beatsPerBar);
    for (let m = firstMeasure; m * beatsPerBar < end; m++) {
      const measureStart = m * beatsPerBar;
      measures[m].segments.push({
        chord,
        from: Math.max(start, measureStart) - measureStart,
        to: Math.min(end, measureStart + beatsPerBar) - measureStart,
        isStart: m === firstMeasure,
      });
    }
  }
  return measures;
}
