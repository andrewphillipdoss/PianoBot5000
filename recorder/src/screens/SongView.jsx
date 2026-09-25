import { useEffect, useState } from 'react';
import { readChartFile } from '../songStorage.js';
import './shared.css';

/**
 * Read-only view of one already-recorded song -- reads its chart JSON
 * straight off disk (via the file handle listSongs already handed
 * back in the song summary), so it always reflects whatever's
 * actually saved rather than a stale in-memory copy. Chord Chart view
 * only, same scope as the rest of this pass -- see the README's
 * "deliberately out of scope" note on real notation rendering.
 */
export default function SongView({ song, onBack }) {
  const [chartData, setChartData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setChartData(null);
    setError(null);
    readChartFile(song.fileHandle)
      .then((data) => {
        if (!cancelled) setChartData(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [song]);

  return (
    <div className="screen">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <a href="#" className="screen__back" onClick={(e) => { e.preventDefault(); onBack(); }}>&larr; My Songs</a>
        <h1 style={{ fontSize: 26, marginTop: 6 }}>{chartData ? chartData.title : song.title}</h1>
      </div>

      {error && (
        <div className="panel" style={{ borderColor: 'var(--live)', color: 'var(--live)' }}>
          Couldn't read this song's file -- {error.message}
        </div>
      )}

      {!chartData && !error && <span style={{ color: 'var(--ink-soft)' }}>Loading...</span>}

      {chartData && (
        <>
          <div className="chip-row">
            <div className="chip">
              <span className="label">Key</span>
              <span className="value">{chartData.key}</span>
            </div>
            <div className="chip">
              <span className="label">Tempo</span>
              <span className="value">{chartData.tempo} bpm</span>
            </div>
            <div className="chip">
              <span className="label">Sections</span>
              <span className="value">{chartData.sections.length}</span>
            </div>
          </div>

          {chartData.sections.map((section) => {
            const sectionChords = chartData.chords.filter((c) => c.beat >= section.start_beat && c.beat < section.end_beat);
            const sectionMelodyCount = chartData.melody.filter((n) => n.beat >= section.start_beat && n.beat < section.end_beat).length;
            const bars = (section.end_beat - section.start_beat) / 4;

            return (
              <div key={section.label} className="panel">
                <span className="panel-label">Section {section.label} &mdash; {bars} bars</span>
                <div className="chord-bar-row">
                  {sectionChords.length === 0 ? (
                    <span style={{ color: 'var(--ink-soft)', fontSize: 14 }}>No chords recorded</span>
                  ) : (
                    sectionChords.map((c, i) => <div key={i} className="chord-bar">{c.chord}</div>)
                  )}
                </div>
                <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                  {sectionMelodyCount} melody note{sectionMelodyCount === 1 ? '' : 's'}
                </span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
