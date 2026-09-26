/**
 * Pure layout logic for the Chord Chart view: split a section's chords
 * into display rows capped at a maximum number of bars each, so a long
 * section reads as several lines instead of one increasingly squeezed
 * row. Independent of how a chord's duration is spelled in whichever
 * screen calls this (internal {start, end} vs. on-disk
 * {duration_beats}) -- callers pass a `durationBeats` accessor.
 */

export const MAX_BARS_PER_ROW = 8;
export const BEATS_PER_BAR = 4;

function defaultDurationBeats(chord) {
  return chord.duration_beats ?? chord.end - chord.start;
}

/**
 * Greedily fill each row up to `maxBarsPerRow` bars' worth of chords,
 * starting a new row rather than overflowing it. A single chord longer
 * than a full row (rare -- a section with one chord the whole way
 * through) still gets its own row alone, rather than being split.
 */
export function layoutChordChartRows(chords, { maxBarsPerRow = MAX_BARS_PER_ROW, beatsPerBar = BEATS_PER_BAR, durationBeats = defaultDurationBeats } = {}) {
  const maxBeatsPerRow = maxBarsPerRow * beatsPerBar;
  const rows = [];
  let currentRow = [];
  let currentBeats = 0;

  for (const chord of chords) {
    const beats = durationBeats(chord);
    if (currentRow.length > 0 && currentBeats + beats > maxBeatsPerRow) {
      rows.push(currentRow);
      currentRow = [];
      currentBeats = 0;
    }
    currentRow.push(chord);
    currentBeats += beats;
  }
  if (currentRow.length > 0) rows.push(currentRow);
  return rows;
}

/**
 * One chord's width, as a percentage of a full row's capacity (NOT of
 * its own row's total, the way flexGrow would give it) -- so a chord
 * spanning 2 bars is always twice as wide as a 1-bar chord and twice
 * as wide as a half-bar chord, consistently across every row, and a
 * short trailing row doesn't stretch to fill the same width as a full
 * one.
 */
export function chordBarWidthStyle(chord, { maxBarsPerRow = MAX_BARS_PER_ROW, beatsPerBar = BEATS_PER_BAR, durationBeats = defaultDurationBeats } = {}) {
  const maxBeatsPerRow = maxBarsPerRow * beatsPerBar;
  return { width: `${(durationBeats(chord) / maxBeatsPerRow) * 100}%` };
}
