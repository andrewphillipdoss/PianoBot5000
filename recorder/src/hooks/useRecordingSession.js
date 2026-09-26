import { useCallback, useEffect, useRef, useState } from 'react';
import { enableAudio } from '../pianoSynth.js';
import { RecordingSession } from '../recordingSession.js';

/**
 * React wrapper around RecordingSession (see that file for why the
 * state machine itself is a plain class, not a hook). Wire the
 * returned `handleMidiMessage` to the shared MidiProvider's
 * `subscribe()` so captured notes reach it, and call
 * `start`/`stop`/`restart` from UI.
 *
 * `tempo`/`mode`/`subdivisionsPerBeat`/`quantizeStrength`/`pickupBeats`/
 * `beatsPerBar` are only read once, at construction -- this hook
 * doesn't react to them changing later. A screen whose idle-screen
 * controls (quantization, snap strength, pickup checkbox, tempo, time
 * signature) can change these *after* it's already mounted -- exactly
 * what RecordChords.jsx/RecordMelody.jsx's own idle-screen pickers
 * invite -- MUST remount when they change (a React `key` keyed on all
 * of them, set by the caller -- see RecordSongFlow.jsx) rather than
 * expect this hook to pick up the change on its own. Skipping that key
 * doesn't error; it just silently keeps using whatever was set when
 * this screen first mounted for the actual take, while the picker
 * itself (and the saved chart) show the new value -- a real bug this
 * project shipped once already.
 */
export function useRecordingSession({ tempo, mode, subdivisionsPerBeat, quantizeStrength, pickupBeats, beatsPerBar }) {
  const [phase, setPhase] = useState('idle');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isPickupBar, setIsPickupBar] = useState(false);
  const sessionRef = useRef(null);

  // Lazy ref-singleton init -- React's own documented pattern for
  // "create this once, on the first render, without useEffect"
  // (react.dev/reference/react/useRef#avoiding-recreating-the-ref-contents).
  // Some lint rules flag any ref access during render on principle;
  // this specific shape is the sanctioned exception.
  if (!sessionRef.current) {
    sessionRef.current = new RecordingSession({
      tempo,
      mode,
      subdivisionsPerBeat,
      quantizeStrength,
      pickupBeats,
      beatsPerBar,
      onPhaseChange: setPhase,
      onPickupBarChange: setIsPickupBar,
      onDone: setResult,
      onError: setError,
    });
  }

  useEffect(() => () => sessionRef.current?.cancel(), []);

  const start = useCallback(async (options) => {
    setResult(null);
    setError(null);
    await enableAudio(); // starting a pass is itself a user gesture (a click or spacebar) -- the right moment to unlock audio
    sessionRef.current.start(options);
  }, []);

  const stop = useCallback(() => sessionRef.current.stop(), []);

  const restart = useCallback(() => {
    setResult(null);
    setError(null);
    sessionRef.current.restart();
  }, []);

  const handleMidiMessage = useCallback((message) => sessionRef.current?.handleMidiMessage(message), []);

  return { phase, result, error, isPickupBar, start, stop, restart, handleMidiMessage };
}
