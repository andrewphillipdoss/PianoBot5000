import { layoutMeasures } from '../chordChartLayout.js';
import ChordLabel from './ChordLabel.jsx';

/**
 * The Chord Chart, shared by every screen that shows one: a lead-sheet
 * style grid of equal-width measures (four to a line, two on a narrow
 * screen), each with its bar number, barlines on both sides, faint
 * ticks on each beat, and every chord placed at the beat it lands on
 * with a band showing how long it lasts -- continuing across a barline
 * where it's held. The section ends on a double barline. See
 * chordChartLayout.js for the layout itself.
 *
 * `chords` are internal, section-relative ChordEvents ({rootPitchClass,
 * quality, bassPitchClass, start, end}); `sectionLengthBeats` sets how
 * many measures to draw (empty ones included), or leave it null to fit
 * the chords.
 */
export default function ChordChart({ chords, sectionLengthBeats = null, beatsPerBar = 4, emptyMessage = 'No chords recorded' }) {
  if (chords.length === 0 && sectionLengthBeats === null) {
    return <span style={{ color: 'var(--ink-soft)', fontSize: 14 }}>{emptyMessage}</span>;
  }

  const measures = layoutMeasures(chords, { sectionLengthBeats, beatsPerBar });
  const percent = (beats) => `${(beats / beatsPerBar) * 100}%`;

  return (
    <div className="measure-grid" role="list" aria-label="Chord chart">
      {measures.map((measure, i) => (
        <div key={measure.number} role="listitem" className={`measure${i === measures.length - 1 ? ' measure--final' : ''}`}>
          <span className="measure__number">{measure.number}</span>
          {Array.from({ length: beatsPerBar - 1 }, (_, b) => (
            <span key={b} className="measure__beat-tick" style={{ left: percent(b + 1) }} />
          ))}
          {measure.segments.map((segment, s) => (
            <div key={s} className="measure__segment" style={{ left: percent(segment.from), width: percent(segment.to - segment.from) }}>
              {segment.isStart && (
                <div className="measure__label">
                  <ChordLabel {...segment.chord} align="start" />
                </div>
              )}
              <span className={`measure__band${segment.isStart ? '' : ' measure__band--held'}`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
