// value = subdivisions/beat that theory.js's quantizeBeat/quantizeNotes expect.
export const QUANTIZATION_OPTIONS = [
  { value: 2, label: '8th notes' },
  { value: 4, label: '16th notes' },
  { value: 8, label: '32nd notes' },
];

/** A quantization picker -- shared between the record screens (chosen before/while recording) and their review screens (re-quantizes an already-captured take live). */
export default function QuantizationSelect({ label, value, onChange }) {
  return (
    <label className="field" style={{ width: 150 }}>
      {label}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {QUANTIZATION_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
