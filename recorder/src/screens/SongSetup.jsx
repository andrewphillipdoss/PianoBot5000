import { useState } from 'react';
import TimeSignatureSelect from './TimeSignatureSelect.jsx';
import './shared.css';

/**
 * Song-level setup -- title/key/tempo -- asked once, before the
 * per-section record loop begins (see the design discussion: this is
 * deliberately its own screen, not combined with the chords-recording
 * console, so there's never a text input focused on the same screen
 * spacebar is used to start/stop recording). Quantization lives on the
 * record screens themselves instead (RecordChords/RecordMelody, and
 * their review screens) -- it needs to be changeable there anyway
 * (including in re-record flows, which skip this screen entirely), so
 * asking for it twice here too would be redundant.
 *
 * `initial`, when given, pre-fills every field from an already-submitted
 * song -- RecordSongFlow passes its own `song` state back in here so
 * navigating back to this screen (from RecordChords, the very next
 * step) doesn't throw away title/key/tempo/time-signature the player
 * already typed in and re-show this screen blank, forcing them to
 * retype everything just to get back to where they were.
 */
export default function SongSetup({ initial = null, onBack, onSubmit }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [key, setKey] = useState(initial?.key ?? 'C');
  const [tempo, setTempo] = useState(initial?.tempo ?? 96);
  const [beatsPerBar, setBeatsPerBar] = useState(initial?.beatsPerBar ?? 4);
  const [hasBassline, setHasBassline] = useState(initial?.hasBassline ?? false);
  const [basslineFirst, setBasslineFirst] = useState(initial?.basslineFirst ?? false);

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
        <TimeSignatureSelect value={beatsPerBar} onChange={setBeatsPerBar} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-soft)' }}>
          <input type="checkbox" checked={hasBassline} onChange={(e) => setHasBassline(e.target.checked)} />
          Record a separate bass line, in addition to chords and melody
        </label>
        {hasBassline && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-soft)', marginLeft: 22 }}>
            <input type="checkbox" checked={basslineFirst} onChange={(e) => setBasslineFirst(e.target.checked)} />
            Record the bass line before the melody, not after
          </label>
        )}
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
          onClick={() => onSubmit({ title: title.trim(), key: key.trim(), tempo: Number(tempo), beatsPerBar, hasBassline, basslineFirst })}
        >
          Start Recording Chords &rarr;
        </button>
      </div>
    </div>
  );
}
