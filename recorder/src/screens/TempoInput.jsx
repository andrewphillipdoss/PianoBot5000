/**
 * A tempo (BPM) field, shared by every screen where tempo is
 * changeable -- not just SongSetup.jsx's one-time initial pick. Only
 * commits a change for a finite, positive number; anything else (an
 * empty/partial field mid-edit, "0", garbage) is left uncommitted
 * rather than pushed upstream.
 */
export default function TempoInput({ value, onChange, disabled = false }) {
  return (
    <label className="field" style={{ width: 90 }}>
      Tempo
      <input
        type="number"
        min="20"
        max="400"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed) && parsed > 0) onChange(parsed);
        }}
      />
    </label>
  );
}
