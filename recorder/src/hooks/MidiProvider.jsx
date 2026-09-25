import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isMidiSupported, listInputs, parseMidiMessage, requestMidiAccess } from '../midi.js';

const SELECTED_INPUT_STORAGE_KEY = 'pianobot-recorder:selectedMidiInputId';
const MAX_EVENT_LOG = 50;

const MidiContext = createContext(null);

function readPersistedInputId() {
  try {
    return localStorage.getItem(SELECTED_INPUT_STORAGE_KEY);
  } catch {
    return null; // localStorage unavailable (private browsing, etc.) -- just start unselected
  }
}

/**
 * One shared MIDI connection for the whole app -- port access, the
 * selected input, and the raw message stream -- instead of every
 * screen creating its own (which is what this app used to do: each
 * screen picked independently, so the chosen device didn't survive
 * navigating between screens, and the actual recording screens had no
 * way to change it away from whatever got auto-picked at all).
 *
 * `selectedInputId` is persisted to localStorage so it survives a
 * reload too, not just navigation within one session.
 *
 * Multiple things need the live message stream at once -- the
 * diagnostic display (held notes / event log) always does, and
 * whichever recording screen is active also wants a private copy fed
 * into its own recordingSession -- so this exposes `subscribe(fn)`
 * (returns an unsubscribe function) rather than a single baked-in
 * callback.
 */
export function MidiProvider({ children }) {
  const [supported] = useState(isMidiSupported());
  const [status, setStatus] = useState('idle'); // idle | requesting | granted | denied
  const [error, setError] = useState(null);
  const [inputs, setInputs] = useState([]);
  const [selectedInputId, setSelectedInputIdState] = useState(readPersistedInputId);
  const [events, setEvents] = useState([]);
  const [heldNotes, setHeldNotes] = useState(() => new Set());

  const midiAccessRef = useRef(null);
  const nextEventId = useRef(0);
  const subscribersRef = useRef(new Set());

  const setSelectedInputId = useCallback((id) => {
    setSelectedInputIdState(id);
    try {
      if (id) localStorage.setItem(SELECTED_INPUT_STORAGE_KEY, id);
    } catch {
      // Best-effort -- losing the persisted choice isn't fatal, just less convenient next time.
    }
  }, []);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    setStatus('requesting');

    requestMidiAccess()
      .then((access) => {
        if (cancelled) return;
        midiAccessRef.current = access;
        const refreshInputs = () => setInputs(listInputs(access));
        refreshInputs();
        access.onstatechange = refreshInputs;
        setStatus('granted');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setStatus('denied');
      });

    return () => {
      cancelled = true;
    };
  }, [supported]);

  // Keep the persisted/previously-picked device selected as long as
  // it's still connected; only fall back to the first available port
  // if it's genuinely gone (never selected yet, or unplugged).
  useEffect(() => {
    if (inputs.length === 0) {
      setSelectedInputIdState(null);
      return;
    }
    if (!inputs.some((i) => i.id === selectedInputId)) {
      setSelectedInputId(inputs[0].id);
    }
  }, [inputs, selectedInputId, setSelectedInputId]);

  const handleMessage = useCallback((event) => {
    const parsed = parseMidiMessage(event);
    if (!parsed) return;

    nextEventId.current += 1;
    setEvents((prev) => [{ id: nextEventId.current, ...parsed }, ...prev].slice(0, MAX_EVENT_LOG));

    setHeldNotes((prev) => {
      const next = new Set(prev);
      if (parsed.type === 'noteon' && parsed.velocity > 0) next.add(parsed.note);
      else next.delete(parsed.note);
      return next;
    });

    for (const callback of subscribersRef.current) callback(parsed);
  }, []);

  useEffect(() => {
    const access = midiAccessRef.current;
    if (!access || !selectedInputId) return;
    const input = access.inputs.get(selectedInputId);
    if (!input) return;

    input.onmidimessage = handleMessage;
    return () => {
      input.onmidimessage = null;
    };
    // `status` is a dependency because midiAccessRef only becomes
    // non-null once access is granted -- this effect needs to re-run
    // at that point even though the ref itself doesn't trigger renders.
  }, [selectedInputId, handleMessage, status]);

  /** Register a raw-message listener while a component is mounted (e.g. an active recording screen). Returns an unsubscribe function. */
  const subscribe = useCallback((callback) => {
    subscribersRef.current.add(callback);
    return () => subscribersRef.current.delete(callback);
  }, []);

  const value = useMemo(
    () => ({ supported, status, error, inputs, selectedInputId, setSelectedInputId, events, heldNotes, subscribe }),
    [supported, status, error, inputs, selectedInputId, setSelectedInputId, events, heldNotes, subscribe]
  );

  return <MidiContext.Provider value={value}>{children}</MidiContext.Provider>;
}

export function useMidi() {
  const context = useContext(MidiContext);
  if (!context) throw new Error('useMidi() must be used within a <MidiProvider>');
  return context;
}
