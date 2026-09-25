import { useState } from 'react';
import { DEFAULT_QUANTIZE_SUBDIVISIONS_PER_BEAT } from '../recordingPipeline.js';
import './shared.css';

// value = subdivisions/beat that theory.js's quantizeNotes expects.
const QUANTIZATION_OPTIONS = [
  { value: 2, label: '8th notes' },
  { value: 4, label: '16th notes' },
  { value: 8, label: '32nd notes' },
];

/**
 * Song-level setup -- title/key/tempo/quantization -- asked once,
 * before the per-section record loop begins (see the design
 * discussion: this is deliberately its own screen, not combined with
 * the chords-recording console, so there's never a text input focused
 * on the same screen spacebar is used to start/stop recording).
 */
export default function SongSetup({ onBack, onSubmit }) {
  const [title, setTitle] = useState('');
  const [key, setKey] = useState('C');
  const [tempo, setTempo] = useState(96);
  const [subdivisionsPerBeat, setSubdivisionsPerBeat] = useState(DEFAULT_QUANTIZE_SUBDIVISIONS_PER_BEAT);

  const canSubmit = title.trim().length > 0 && key.trim().length > 0 && Number(tempo) > 0;

  return (
    <div className="screen">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <a href="#" className="screen__back" onClick={(e) => { e.preventDefault(); onBack(); }}>&larr; My Songs</a>
        <h1 style={{ fontSize: 26, marginTop: 6 }}>Add a Song</h1>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <label className="field" style={{ flexGrow: 1 }}>
          Title
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Amazing Grace" autoFocus />
        </label>
        <label className="field" style={{ width: 90 }}>
          Key
          <input type="text" value={key} onChange={(e) => setKey(e.target.value)} placeholder="C" />
        </label>
        <label className="field" style={{ width: 110 }}>
          Tempo
          <input type="number" value={tempo} onChange={(e) => setTempo(e.target.value)} min="20" max="300" />
        </label>
        <label className="field" style={{ width: 150 }}>
          Quantization
          <select value={subdivisionsPerBeat} onChange={(e) => setSubdivisionsPerBeat(Number(e.target.value))}>
            {QUANTIZATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="actions-row" style={{ justifyContent: 'flex-end', gap: 12 }}>
        {!canSubmit && (
          <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
            {title.trim().length === 0 ? 'Enter a title to continue' : 'Enter a key and a tempo above 0 to continue'}
          </span>
        )}
        <button
          className="btn-primary"
          disabled={!canSubmit}
          onClick={() => onSubmit({ title: title.trim(), key: key.trim(), tempo: Number(tempo), subdivisionsPerBeat })}
        >
          Start Recording Chords &rarr;
        </button>
      </div>
    </div>
  );
}
