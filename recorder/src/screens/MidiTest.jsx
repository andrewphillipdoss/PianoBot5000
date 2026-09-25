import { useEffect, useMemo, useRef, useState } from 'react';
import { useMidiInput } from '../hooks/useMidiInput.js';
import { enableAudio, playNote, stopAllNotes, stopNote } from '../pianoSynth.js';
import { detectChordQuality, formatChordSymbol, midiNoteName } from '../theory.js';
import './MidiTest.css';

/**
 * A diagnostic screen, not a real app screen: pick a MIDI input, see
 * (and hear) every note you play show up live. This exists to answer
 * one question -- "does this browser actually see my keyboard?" --
 * before any real recording UI gets built on top of Web MIDI.
 */
export default function MidiTest() {
  const { supported, status, error, inputs, selectedInputId, setSelectedInputId, events, heldNotes } = useMidiInput();
  const [soundOn, setSoundOn] = useState(false);
  const lastPlayedEventId = useRef(0);

  // Reacts to the live event stream to trigger sound -- deliberately
  // separate from useMidiInput itself, which stays a generic
  // MIDI-in-to-events hook with no audio-playback opinion baked in.
  useEffect(() => {
    if (!soundOn || events.length === 0) return;
    const newest = events[0];
    if (newest.id <= lastPlayedEventId.current) return;
    lastPlayedEventId.current = newest.id;
    if (newest.type === 'noteon' && newest.velocity > 0) playNote(newest.note, newest.velocity);
    else stopNote(newest.note);
  }, [events, soundOn]);

  // Recognizes triads and 7th chords (this app's current vocabulary --
  // see theory.js) from whichever pitch classes are currently held,
  // octave doublings collapsed and ignored, lowest held note as the
  // tiebreaking bass for the real ambiguities (augmented triads and
  // diminished 7ths are both symmetric shapes).
  const heldChord = useMemo(() => {
    const held = [...heldNotes];
    const pitchClasses = held.map((p) => p % 12);
    const distinctCount = new Set(pitchClasses).size;
    if (distinctCount !== 3 && distinctCount !== 4) return { chord: null, distinctCount };
    const bassPitchClass = held.reduce((min, p) => Math.min(min, p), Infinity) % 12;
    return { chord: detectChordQuality(pitchClasses, bassPitchClass), distinctCount };
  }, [heldNotes]);

  if (!supported) {
    return (
      <div className="midi-test">
        <h1>MIDI Test</h1>
        <div className="midi-test__status midi-test__status--warn">
          Web MIDI isn't supported in this browser. Use Chrome (or another Chromium-based browser) -- Safari and Firefox don't implement it.
        </div>
      </div>
    );
  }

  return (
    <div className="midi-test">
      <h1>MIDI Test</h1>

      {status === 'requesting' && (
        <div className="midi-test__status midi-test__status--warn">Requesting MIDI access -- check for a browser permission prompt.</div>
      )}
      {status === 'denied' && (
        <div className="midi-test__status midi-test__status--warn">
          MIDI access denied{error ? `: ${error.message}` : ''}. Reload and allow the permission prompt to try again.
        </div>
      )}
      {status === 'granted' && inputs.length === 0 && (
        <div className="midi-test__status midi-test__status--warn">
          MIDI access granted, but no input devices found -- check that your keyboard/interface is plugged in.
        </div>
      )}
      {status === 'granted' && inputs.length > 0 && (
        <div className="midi-test__status midi-test__status--ok">MIDI access granted -- {inputs.length} input port(s) found.</div>
      )}

      <div className="midi-test__panel">
        <span className="midi-test__panel-label">Sound feedback</span>
        <button
          className="midi-test__select"
          onClick={() => {
            if (soundOn) {
              stopAllNotes();
              setSoundOn(false);
            } else {
              enableAudio().then(() => setSoundOn(true));
            }
          }}
        >
          {soundOn ? 'Sound on (tap to mute)' : 'Enable sound'}
        </button>
      </div>

      {inputs.length > 0 && (
        <div className="midi-test__panel">
          <span className="midi-test__panel-label">Input device</span>
          <select className="midi-test__select" value={selectedInputId ?? ''} onChange={(e) => setSelectedInputId(e.target.value)}>
            {inputs.map((input) => (
              <option key={input.id} value={input.id}>
                {input.name} {input.manufacturer ? `(${input.manufacturer})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="midi-test__panel">
        <span className="midi-test__panel-label">Currently held</span>
        <div className="midi-test__held-notes">
          {heldNotes.size === 0 ? (
            <span className="midi-test__held-empty">Play a note...</span>
          ) : (
            [...heldNotes]
              .sort((a, b) => a - b)
              .map((pitch) => (
                <span key={pitch} className="midi-test__held-note">{midiNoteName(pitch)}</span>
              ))
          )}
        </div>
      </div>

      <div className="midi-test__panel">
        <span className="midi-test__panel-label">Chord</span>
        {heldChord.chord ? (
          <span className="midi-test__chord-symbol">{formatChordSymbol(heldChord.chord.rootPitchClass, heldChord.chord.quality)}</span>
        ) : (
          <span className="midi-test__chord-hint">
            {heldChord.distinctCount === 0 && 'Hold a chord (3-4 notes)...'}
            {heldChord.distinctCount > 0 && heldChord.distinctCount < 3 && `${heldChord.distinctCount} of 3 notes held`}
            {(heldChord.distinctCount === 3 || heldChord.distinctCount === 4) && 'Not a recognizable chord -- check for a wrong/extra note'}
            {heldChord.distinctCount > 4 && `${heldChord.distinctCount} distinct notes held -- only triads/7th chords are recognized`}
          </span>
        )}
      </div>

      <div className="midi-test__panel">
        <span className="midi-test__panel-label">Recent events</span>
        <div className="midi-test__log">
          {events.length === 0 ? (
            <div className="midi-test__log-empty">Nothing captured yet.</div>
          ) : (
            events.map((event) => (
              <div key={event.id} className={`midi-test__log-row midi-test__log-row--${event.type === 'noteon' ? 'on' : 'off'}`}>
                <span>{event.timestamp.toFixed(0)}ms</span>
                <span>{midiNoteName(event.note)}</span>
                <span>{event.type === 'noteon' ? 'note on' : 'note off'}</span>
                <span>vel {event.velocity}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
