import { midiNoteName } from '../theory.js';

const PIXELS_PER_BEAT = 24;
const ROW_HEIGHT = 8; // px per semitone
const PITCH_PADDING = 2; // semitones of headroom above/below the notes actually played

/**
 * A simple piano-roll view of a section's captured melody -- not real
 * lead-sheet notation (staff/clef rendering is a deliberately separate,
 * later piece; see the README), just enough of a visual to see the
 * melody's shape: time left-to-right, pitch low-to-high, note length
 * as bar width. A shaded band covers any pickup-bar beats (negative
 * beat positions, before the section's own downbeat at beat 0).
 */
export default function MelodyRoll({ notes, sectionLengthBeats }) {
  if (notes.length === 0) {
    return <span style={{ color: 'var(--ink-soft)', fontSize: 14 }}>No melody recorded</span>;
  }

  const minBeat = Math.min(0, ...notes.map((n) => n.beat));
  const maxBeat = sectionLengthBeats;
  const totalBeats = maxBeat - minBeat;

  const pitches = notes.map((n) => n.pitch);
  const minPitch = Math.min(...pitches) - PITCH_PADDING;
  const maxPitch = Math.max(...pitches) + PITCH_PADDING;
  const pitchRange = maxPitch - minPitch;

  const width = totalBeats * PIXELS_PER_BEAT;
  const height = pitchRange * ROW_HEIGHT;

  const xForBeat = (beat) => (beat - minBeat) * PIXELS_PER_BEAT;
  const yForPitch = (pitch) => (maxPitch - pitch) * ROW_HEIGHT;

  const barLines = [];
  for (let beat = Math.ceil(minBeat / 4) * 4; beat <= maxBeat; beat += 4) {
    barLines.push(beat);
  }

  const octaveLines = [];
  for (let pitch = Math.ceil(minPitch / 12) * 12; pitch <= maxPitch; pitch += 12) {
    octaveLines.push(pitch);
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={width} height={height} style={{ display: 'block' }}>
        <rect x={0} y={0} width={width} height={height} fill="var(--bg)" />

        {minBeat < 0 && <rect x={0} y={0} width={xForBeat(0)} height={height} fill="var(--line)" opacity={0.4} />}

        {octaveLines.map((pitch) => (
          <g key={pitch}>
            <line x1={0} x2={width} y1={yForPitch(pitch)} y2={yForPitch(pitch)} stroke="var(--line)" strokeWidth={1} />
            <text x={2} y={yForPitch(pitch) - 2} fontSize={9} fill="var(--ink-soft)">{midiNoteName(pitch)}</text>
          </g>
        ))}

        {barLines.map((beat) => (
          <line
            key={beat}
            x1={xForBeat(beat)}
            x2={xForBeat(beat)}
            y1={0}
            y2={height}
            stroke={beat === 0 ? 'var(--accent-dark)' : 'var(--line)'}
            strokeWidth={beat === 0 ? 2 : 1}
          />
        ))}

        {notes.map((note, i) => (
          <rect
            key={i}
            x={xForBeat(note.beat)}
            y={yForPitch(note.pitch)}
            width={Math.max(2, note.duration_beats * PIXELS_PER_BEAT - 1)}
            height={ROW_HEIGHT - 2}
            rx={2}
            fill="var(--accent)"
          />
        ))}
      </svg>
    </div>
  );
}
