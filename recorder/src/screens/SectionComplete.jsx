import { useState } from 'react';
import { processMelodyPass } from '../recordingPipeline.js';
import { formatChordSymbol } from '../theory.js';
import QuantizationSelect from './QuantizationSelect.jsx';
import './shared.css';

/**
 * Chord-Chart view only for now -- real lead-sheet notation rendering
 * is a deliberately separate, later piece; see the design discussion.
 *
 * `onReRecordChords`/`onAddSection` are optional -- omitted entirely
 * (not just handled as a no-op) when the calling flow doesn't support
 * them, so the button for it doesn't render at all rather than sitting
 * there doing nothing (see RecordSongFlow.jsx for which modes omit
 * which).
 *
 * The quantization picker re-derives melody from its still-available
 * raw MIDI (melodyResult.rawMessages) at the new grid, against the
 * section's already-fixed length -- no re-recording needed, same idea
 * as ChordsReview.jsx.
 */
export default function SectionComplete({
  title,
  sectionLabel,
  tempo,
  keySignature,
  chordsResult,
  melodyResult,
  subdivisionsPerBeat,
  onSubdivisionsPerBeatChange,
  finalizeLabel = 'Finalize Song',
  onReRecordChords,
  onReRecordMelody,
  onAddSection,
  onFinalize,
}) {
  const [notes, setNotes] = useState(melodyResult.notes);
  const bars = chordsResult.sectionLengthBeats / 4;

  function handleQuantizationChange(newSubdivisionsPerBeat) {
    onSubdivisionsPerBeatChange(newSubdivisionsPerBeat);
    const reprocessed = processMelodyPass(melodyResult.rawMessages, tempo, chordsResult.sectionLengthBeats, newSubdivisionsPerBeat);
    setNotes(reprocessed.notes);
  }

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
        <QuantizationSelect label="Melody quantization" value={subdivisionsPerBeat} onChange={handleQuantizationChange} />
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
        <span style={{ fontSize: 15 }}>{notes.length} notes captured</span>
      </div>

      <div className="actions-row">
        <div style={{ display: 'flex', gap: 10 }}>
          {onReRecordChords && <button className="btn-ghost" onClick={onReRecordChords}>Re-record Chords</button>}
          <button className="btn-ghost" onClick={onReRecordMelody}>Re-record Melody</button>
          {onAddSection && <button className="btn-ghost" onClick={() => onAddSection(notes)}>+ Add Another Section</button>}
        </div>
        <button className="btn-primary" onClick={() => onFinalize(notes)}>{finalizeLabel}</button>
      </div>
    </div>
  );
}
