// value = the `strength` quantizeBeat/quantizeNotes expect (0-1).
export const QUANTIZE_STRENGTH_OPTIONS = [
  { value: 1, label: 'Full snap' },
  { value: 0.6, label: 'Natural' },
  { value: 0.3, label: 'Light snap' },
  { value: 0, label: 'Off (raw timing)' },
];

/**
 * How hard melody notes snap to the quantization grid -- a full snap
 * is a strict nearest-neighbor rule that can't tell "played a little
 * early on purpose" apart from ordinary human timing looseness (see
 * theory.js's quantizeBeat); softer keeps more of a take's actual feel.
 * Chords don't get this control -- see recordingPipeline.js for why.
 */
export default function QuantizeStrengthSelect({ label = 'Snap strength', value, onChange }) {
  return (
    <label className="field" style={{ width: 150 }}>
      {label}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {QUANTIZE_STRENGTH_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
