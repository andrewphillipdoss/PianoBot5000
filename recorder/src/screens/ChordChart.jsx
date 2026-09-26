import { chordBarWidthStyle, layoutChordChartRows } from '../chordChartLayout.js';

/**
 * The Chord Chart view, shared by every screen that shows one
 * (ChordsReview, SectionComplete, SongView, RecordMelody's playback
 * panel) -- wraps into multiple rows capped at `maxBarsPerRow` bars
 * each (see chordChartLayout.js) rather than one long row that just
 * keeps squeezing every chord narrower as a section gets longer.
 */
export default function ChordChart({ chords, renderLabel, maxBarsPerRow, emptyMessage = 'No chords recorded', barStyle }) {
  if (chords.length === 0) {
    return <span style={{ color: 'var(--ink-soft)', fontSize: 14 }}>{emptyMessage}</span>;
  }

  const rows = layoutChordChartRows(chords, { maxBarsPerRow });

  return (
    <div className="chord-chart-rows">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="chord-bar-row">
          {row.map((chord, i) => (
            <div key={i} className="chord-bar" style={{ ...chordBarWidthStyle(chord, { maxBarsPerRow }), ...barStyle }}>
              {renderLabel(chord)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
