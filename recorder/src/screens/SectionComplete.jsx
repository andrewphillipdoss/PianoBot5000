import { formatChordSymbol } from '../theory.js';
import './shared.css';

/**
 * Chord-Chart view only for now -- real lead-sheet notation rendering
 * (and the multi-section "Song with N Sections" view) are a
 * deliberately separate, later piece; see the design discussion.
 */
export default function SectionComplete({ title, sectionLabel, keySignature, chordsResult, melodyResult, onReRecordChords, onReRecordMelody, onFinalize }) {
  const bars = chordsResult.sectionLengthBeats / 4;

  return (
    <div className="screen">
      <h1 style={{ fontSize: 26 }}>{title} &mdash; Section {sectionLabel}</h1>

      <div className="chip-row">
        <div className="chip">
          <span className="label">Key</span>
          <span className="value">{keySignature}</span>
        </div>
        <div className="chip">
          <span className="label">Section length</span>
          <span className="value">{bars} bars</span>
        </div>
        <div className="chip" style={{ borderColor: 'var(--good)' }}>
          <span className="label">Status</span>
          <span className="value" style={{ color: 'var(--good)' }}>Chords + Melody &#10003;</span>
        </div>
      </div>

      <div className="panel">
        <span className="panel-label">Chord chart</span>
        <div className="chord-bar-row">
          {chordsResult.chords.map((chord, i) => (
            <div key={i} className="chord-bar" style={{ flexGrow: chord.end - chord.start }}>
              {formatChordSymbol(chord.rootPitchClass, chord.quality)}
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <span className="panel-label">Melody</span>
        <span style={{ fontSize: 15 }}>{melodyResult.notes.length} notes captured</span>
      </div>

      <div className="actions-row">
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-ghost" onClick={onReRecordChords}>Re-record Chords</button>
          <button className="btn-ghost" onClick={onReRecordMelody}>Re-record Melody</button>
        </div>
        <button className="btn-primary" onClick={onFinalize}>Finalize Song</button>
      </div>
    </div>
  );
}
