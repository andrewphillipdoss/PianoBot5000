import { useState } from 'react';
import { formatChordSymbol } from '../theory.js';
import './shared.css';

const BAR_STEP_BEATS = 16; // one 4-bar unit -- the same step the auto-rounding uses

/**
 * "Section A: N bars. Adjust?" -- the chords pass is authoritative
 * for the section's length, computed automatically, but you get one
 * chance to nudge it by a 4-bar unit before the melody pass locks it
 * in (the melody plays back for exactly this many bars).
 */
export default function ChordsReview({ title, sectionLabel, keySignature, chordsResult, onReRecord, onProceed }) {
  const [sectionLengthBeats, setSectionLengthBeats] = useState(chordsResult.sectionLengthBeats);
  const bars = sectionLengthBeats / 4;

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
          <span className="value" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn-ghost" style={{ padding: '2px 10px' }} onClick={() => setSectionLengthBeats((b) => Math.max(BAR_STEP_BEATS, b - BAR_STEP_BEATS))}>
              &minus;
            </button>
            {bars} bars
            <button className="btn-ghost" style={{ padding: '2px 10px' }} onClick={() => setSectionLengthBeats((b) => b + BAR_STEP_BEATS)}>
              +
            </button>
          </span>
        </div>
        <div className="chip">
          <span className="label">Chord changes</span>
          <span className="value">{chordsResult.chords.length}</span>
        </div>
      </div>

      <div className="panel">
        <span className="panel-label">Chord chart</span>
        <div className="chord-bar-row">
          {chordsResult.chords.map((chord, i) => (
            <div key={i} className="chord-bar">{formatChordSymbol(chord.rootPitchClass, chord.quality)}</div>
          ))}
        </div>
      </div>

      <div className="actions-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn-ghost" onClick={onReRecord}>Re-record</button>
        <button className="btn-primary" onClick={() => onProceed(sectionLengthBeats)}>Record Melody &rarr;</button>
      </div>
    </div>
  );
}
