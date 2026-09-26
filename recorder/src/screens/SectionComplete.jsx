import { useState } from 'react';
import { processMelodyPass } from '../recordingPipeline.js';
import { formatChordSymbol } from '../theory.js';
import ChordChart from './ChordChart.jsx';
import QuantizationSelect from './QuantizationSelect.jsx';
import QuantizeStrengthSelect from './QuantizeStrengthSelect.jsx';
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
 * The quantization/snap-strength pickers re-derive melody from its
 * still-available raw MIDI (melodyResult.rawMessages) at the new
 * grid/strength, against the section's already-fixed length -- no
 * re-recording needed, same idea as ChordsReview.jsx.
 *
 * Deliberately no tempo picker here, unlike ChordsReview.jsx: by this
 * point both chords AND melody are already captured from the same real
 * take, synchronized in real time. Re-deriving only one of them at a
 * new tempo would desync the two (chords staying at the old tempo's
 * beat positions while melody moved to the new one's); re-deriving
 * both consistently would also need to re-check whether the chords
 * pass's own section length still rounds the same way at the new tempo
 * -- a bigger, riskier change than a rounding tweak. ChordsReview is
 * the one place left to fix a wrong tempo without re-recording; past
 * it, re-recording is the answer.
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
  quantizeStrength,
  onQuantizeStrengthChange,
  pickupBeats,
  beatsPerBar = 4,
  finalizeLabel = 'Finalize Song',
  onReRecordChords,
  onReRecordMelody,
  onAddSection,
  onFinalize,
}) {
  const [notes, setNotes] = useState(melodyResult.notes);
  const bars = chordsResult.sectionLengthBeats / beatsPerBar;

  // pickupBeats itself isn't changeable here -- it's whatever was
  // actually used for this real take (see RecordMelody.jsx), not
  // something re-derivable from raw MIDI after the fact the way
  // quantization/strength are.
  function reprocess(newSubdivisionsPerBeat, newQuantizeStrength) {
    const reprocessed = processMelodyPass(melodyResult.rawMessages, tempo, chordsResult.sectionLengthBeats, newSubdivisionsPerBeat, newQuantizeStrength, pickupBeats);
    setNotes(reprocessed.notes);
  }

  function handleQuantizationChange(newSubdivisionsPerBeat) {
    onSubdivisionsPerBeatChange(newSubdivisionsPerBeat);
    reprocess(newSubdivisionsPerBeat, quantizeStrength);
  }

  function handleQuantizeStrengthChange(newQuantizeStrength) {
    onQuantizeStrengthChange(newQuantizeStrength);
    reprocess(subdivisionsPerBeat, newQuantizeStrength);
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
        <QuantizeStrengthSelect value={quantizeStrength} onChange={handleQuantizeStrengthChange} />
      </div>

      <div className="panel">
        <span className="panel-label">Chord chart</span>
        <ChordChart chords={chordsResult.chords} renderLabel={(chord) => formatChordSymbol(chord.rootPitchClass, chord.quality)} beatsPerBar={beatsPerBar} />
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
