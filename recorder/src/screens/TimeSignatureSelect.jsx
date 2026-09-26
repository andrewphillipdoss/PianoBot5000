// value = beatsPerBar (the time signature's numerator, treating the
// beat as a quarter note). Compound meters (6/8, 9/8) aren't modeled
// separately -- pick whichever beat count reads naturally for the song.
export const TIME_SIGNATURE_OPTIONS = [
  { value: 2, label: '2/4' },
  { value: 3, label: '3/4' },
  { value: 4, label: '4/4' },
  { value: 5, label: '5/4' },
  { value: 6, label: '6/4' },
];

/** How many beats make a bar -- sets the count-in length, the metronome's accent pattern, and the default pickup-bar length. */
export default function TimeSignatureSelect({ label = 'Time signature', value, onChange }) {
  return (
    <label className="field" style={{ width: 130 }}>
      {label}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {TIME_SIGNATURE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
