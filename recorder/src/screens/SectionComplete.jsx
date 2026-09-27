import { useState } from 'react';
import { processMelodyPass } from '../recordingPipeline.js';
import ChordChart from './ChordChart.jsx';
import ChordLabel from './ChordLabel.jsx';
import QuantizationSelect from './QuantizationSelect.jsx';
import QuantizeStrengthSelect from './QuantizeStrengthSelect.jsx';
import './shared.css';

/**
 * Chord-Chart view only for now -- real lead-sheet notation rendering
 * is a deliberately separate, later piece; see the design discussion.
 *
 * `onReRecordChords`/`onReRecordBassline`/`onAddSection` are optional --
 * omitted entirely (not just handled as a no-op) when the calling flow
 * doesn't support them, so the button for it doesn't render at all
 * rather than sitting there doing nothing (see RecordSongFlow.jsx for
 * which modes omit which). `basslineResult` is `null` for a song that
 * never recorded a bassline pass at all -- its whole panel/controls
 * are omitted the same way, not just disabled.
 *
 * The quantization/snap-strength pickers re-derive melody/bassline from
 * their still-available raw MIDI (`{melody,bassline}Result.rawMessages`)
 * at the new grid/strength, against the section's already-fixed length
 * -- no re-recording needed, same idea as ChordsReview.jsx. That only
 * works when this screen was reached with a *fresh* take actually
 * captured just now; a bassline (or melody) carried forward unchanged
 * from re-recording a *different* part of the section (see
 * RecordSongFlow.jsx's reRecordMelody/reRecordBassline modes) has no
 * raw MIDI to re-derive from, so its controls show read-only instead.
 *
 * Deliberately no tempo picker here, unlike ChordsReview.jsx: by this
 * point chords and every voice actually just captured are already
 * synchronized in real time at one tempo. Re-deriving only one of them
 * at a new tempo would desync the rest (staying at the old tempo's beat
 * positions while one voice moved to the new one's); re-deriving all of
 * them consistently would also need to re-check whether the chords
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
  basslineResult = null,
  basslineSubdivisionsPerBeat,
  onBasslineSubdivisionsPerBeatChange,
  basslineQuantizeStrength,
  onBasslineQuantizeStrengthChange,
  basslinePickupBeats,
  beatsPerBar = 4,
  finalizeLabel = 'Finalize Song',
  onReRecordChords,
  onReRecordMelody,
  onReRecordBassline,
  onAddSection,
  onFinalize,
}) {
  const [notes, setNotes] = useState(melodyResult.notes);
  const [basslineNotes, setBasslineNotes] = useState(basslineResult?.notes ?? []);
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

  function reprocessBassline(newSubdivisionsPerBeat, newQuantizeStrength) {
    const reprocessed = processMelodyPass(basslineResult.rawMessages, tempo, chordsResult.sectionLengthBeats, newSubdivisionsPerBeat, newQuantizeStrength, basslinePickupBeats);
    setBasslineNotes(reprocessed.notes);
  }

  function handleBasslineQuantizationChange(newSubdivisionsPerBeat) {
    onBasslineSubdivisionsPerBeatChange(newSubdivisionsPerBeat);
    reprocessBassline(newSubdivisionsPerBeat, basslineQuantizeStrength);
  }

  function handleBasslineQuantizeStrengthChange(newQuantizeStrength) {
    onBasslineQuantizeStrengthChange(newQuantizeStrength);
    reprocessBassline(basslineSubdivisionsPerBeat, newQuantizeStrength);
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
          <span className="value" style={{ color: 'var(--good)' }}>
            Chords + Melody{basslineResult ? ' + Bassline' : ''} &#10003;
          </span>
        </div>
        {melodyResult.rawMessages ? (
          <>
            <QuantizationSelect label="Melody quantization" value={subdivisionsPerBeat} onChange={handleQuantizationChange} />
            <QuantizeStrengthSelect value={quantizeStrength} onChange={handleQuantizeStrengthChange} />
          </>
        ) : (
          <div className="chip">
            <span className="label">Melody</span>
            <span className="value">unchanged</span>
          </div>
        )}
        {basslineResult && (
          basslineResult.rawMessages ? (
            <>
              <QuantizationSelect label="Bassline quantization" value={basslineSubdivisionsPerBeat} onChange={handleBasslineQuantizationChange} />
              <QuantizeStrengthSelect value={basslineQuantizeStrength} onChange={handleBasslineQuantizeStrengthChange} />
            </>
          ) : (
            <div className="chip">
              <span className="label">Bassline</span>
              <span className="value">unchanged</span>
            </div>
          )
        )}
      </div>

      <div className="panel">
        <span className="panel-label">Chord chart</span>
        <ChordChart chords={chordsResult.chords} renderLabel={(chord) => <ChordLabel {...chord} />} beatsPerBar={beatsPerBar} />
      </div>

      <div className="panel">
        <span className="panel-label">Melody</span>
        <span style={{ fontSize: 15 }}>{notes.length} notes captured</span>
      </div>

      {basslineResult && (
        <div className="panel">
          <span className="panel-label">Bassline</span>
          <span style={{ fontSize: 15 }}>{basslineNotes.length} notes captured</span>
        </div>
      )}

      <div className="actions-row">
        <div style={{ display: 'flex', gap: 10 }}>
          {onReRecordChords && <button className="btn-ghost" onClick={onReRecordChords}>Re-record Chords</button>}
          <button className="btn-ghost" onClick={onReRecordMelody}>Re-record Melody</button>
          {basslineResult && onReRecordBassline && <button className="btn-ghost" onClick={onReRecordBassline}>Re-record Bassline</button>}
          {onAddSection && <button className="btn-ghost" onClick={() => onAddSection({ melody: notes, bassline: basslineNotes })}>+ Add Another Section</button>}
        </div>
        <button className="btn-primary" onClick={() => onFinalize({ melody: notes, bassline: basslineNotes })}>{finalizeLabel}</button>
      </div>
    </div>
  );
}
