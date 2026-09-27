// value = clicks/beat the recording metronome schedules (see
// recordingSession.js's _scheduleAhead) -- 1 clicks only on the beat
// itself, 2 adds a much quieter click on the eighth-note in between.
export const METRONOME_SUBDIVISION_OPTIONS = [
  { value: 1, label: 'Quarter notes' },
  { value: 2, label: '8th notes' },
];

/** Metronome click density picker -- shared by every record screen (chords/melody/bassline), a song-level setting like tempo/time signature. */
export default function MetronomeSubdivisionSelect({ value, onChange }) {
  return (
    <label className="field" style={{ width: 150 }}>
      Metronome
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {METRONOME_SUBDIVISION_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
