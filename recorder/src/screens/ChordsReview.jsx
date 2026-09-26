import { useState } from 'react';
import { processChordsPass } from '../recordingPipeline.js';
import { formatChordSymbol } from '../theory.js';
import ChordChart from './ChordChart.jsx';
import QuantizationSelect from './QuantizationSelect.jsx';
import TempoInput from './TempoInput.jsx';
import './shared.css';

const BAR_STEP_UNIT = 4; // nudge the section length by a 4-bar unit -- the same step the auto-rounding uses

/**
 * "Section A: N bars. Adjust?" -- the chords pass is authoritative
 * for the section's length, computed automatically, but you get one
 * chance to nudge it by a 4-bar unit before the melody pass locks it
 * in (the melody plays back for exactly this many bars).
 *
 * The quantization/tempo pickers here both re-derive this exact take
 * from its still-available raw MIDI (chordsResult.rawMessages) -- no
 * re-recording needed. Quantization can only ever re-round existing
 * chords' boundaries (clustering runs on raw timing independent of the
 * display grid -- see recordingPipeline.js), so it never breaks
 * recognition. Tempo is a bigger change: `captureDurationSeconds` is a
 * fixed real-world duration, so reinterpreting it at a different BPM
 * recomputes *every* beat position (and the section length itself)
 * from scratch -- correcting a wrong tempo typed at setup without
 * re-recording, not just a rounding tweak.
 */
export default function ChordsReview({
  title,
  sectionLabel,
  tempo,
  onTempoChange,
  keySignature,
  chordsResult,
  subdivisionsPerBeat,
  onSubdivisionsPerBeatChange,
  beatsPerBar = 4,
  onReRecord,
  onProceed,
}) {
  const [chords, setChords] = useState(chordsResult.chords);
  const [sectionLengthBeats, setSectionLengthBeats] = useState(chordsResult.sectionLengthBeats);
  const bars = sectionLengthBeats / beatsPerBar;
  const barStepBeats = BAR_STEP_UNIT * beatsPerBar;

  function handleQuantizationChange(newSubdivisionsPerBeat) {
    onSubdivisionsPerBeatChange(newSubdivisionsPerBeat);
    const reprocessed = processChordsPass(chordsResult.rawMessages, tempo, chordsResult.captureDurationSeconds, newSubdivisionsPerBeat, beatsPerBar);
    setChords(reprocessed.chords);
    setSectionLengthBeats(reprocessed.sectionLengthBeats);
  }

  function handleTempoChange(newTempo) {
    onTempoChange(newTempo);
    const reprocessed = processChordsPass(chordsResult.rawMessages, newTempo, chordsResult.captureDurationSeconds, subdivisionsPerBeat, beatsPerBar);
    setChords(reprocessed.chords);
    setSectionLengthBeats(reprocessed.sectionLengthBeats);
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
          <span className="value" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn-ghost" style={{ padding: '2px 10px' }} onClick={() => setSectionLengthBeats((b) => Math.max(barStepBeats, b - barStepBeats))}>
              &minus;
            </button>
            {bars} bars
            <button className="btn-ghost" style={{ padding: '2px 10px' }} onClick={() => setSectionLengthBeats((b) => b + barStepBeats)}>
              +
            </button>
          </span>
        </div>
        <div className="chip">
          <span className="label">Chord changes</span>
          <span className="value">{chords.length}</span>
        </div>
        <TempoInput value={tempo} onChange={handleTempoChange} />
        <QuantizationSelect label="Quantization" value={subdivisionsPerBeat} onChange={handleQuantizationChange} />
      </div>

      <div className="panel">
        <span className="panel-label">Chord chart</span>
        <ChordChart chords={chords} renderLabel={(chord) => formatChordSymbol(chord.rootPitchClass, chord.quality)} beatsPerBar={beatsPerBar} />
      </div>

      <div className="actions-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn-ghost" onClick={onReRecord}>Re-record</button>
        <button className="btn-primary" onClick={() => onProceed({ chords, sectionLengthBeats })}>Record Melody &rarr;</button>
      </div>
    </div>
  );
}
