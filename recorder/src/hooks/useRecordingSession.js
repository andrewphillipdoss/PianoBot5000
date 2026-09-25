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
 * `tempo`/`mode` are only read once, at construction -- this hook
 * doesn't react to them changing later. If a screen ever needs a
 * different tempo/mode, remount it (e.g. a React `key` keyed on
 * those values) rather than expect this hook to pick up a change.
 */
export function useRecordingSession({ tempo, mode }) {
  const [phase, setPhase] = useState('idle');
  const [result, setResult] = useState(null);
  const sessionRef = useRef(null);

  // Lazy ref-singleton init -- React's own documented pattern for
  // "create this once, on the first render, without useEffect"
  // (react.dev/reference/react/useRef#avoiding-recreating-the-ref-contents).
  // Some lint rules flag any ref access during render on principle;
  // this specific shape is the sanctioned exception.
  if (!sessionRef.current) {
    sessionRef.current = new RecordingSession({ tempo, mode, onPhaseChange: setPhase, onDone: setResult });
  }

  useEffect(() => () => sessionRef.current?.cancel(), []);

  const start = useCallback(async (options) => {
    setResult(null);
    await enableAudio(); // starting a pass is itself a user gesture (a click or spacebar) -- the right moment to unlock audio
    sessionRef.current.start(options);
  }, []);

  const stop = useCallback(() => sessionRef.current.stop(), []);

  const restart = useCallback(() => {
    setResult(null);
    sessionRef.current.restart();
  }, []);

  const handleMidiMessage = useCallback((message) => sessionRef.current?.handleMidiMessage(message), []);

  return { phase, result, start, stop, restart, handleMidiMessage };
}
