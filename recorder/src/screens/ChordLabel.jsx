import { describeChordTones, formatChordSymbol } from '../theory.js';

/**
 * One chord chart entry's label: the plain letter-name symbol (with
 * slash notation when there's a bass note distinct from the root --
 * see theory.js's formatChordSymbol) plus a small secondary line of
 * scale-degree "insignia" underneath it (e.g. "1 3 5 b7" under
 * "Cmaj7") -- what each note in the chord actually *is*, not just the
 * chord's name as a whole. Shared by every screen that renders a chord
 * chart entry (ChordChart everywhere -- the section hub, the record screen's
 * backing panel, SongView),
 * so the two stay visually and behaviorally identical everywhere.
 */
export default function ChordLabel({ rootPitchClass, quality, bassPitchClass = null, align = 'center' }) {
  const degrees = describeChordTones(quality);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, gap: 2 }}>
      <span>{formatChordSymbol(rootPitchClass, quality, bassPitchClass)}</span>
      {degrees.length > 0 && (
        <span style={{ fontFamily: 'system-ui, sans-serif', fontWeight: 400, fontSize: 10, color: 'var(--ink-soft)', letterSpacing: 0.5 }}>
          {degrees.join(' ')}
        </span>
      )}
    </div>
  );
}
