import { useCallback, useEffect, useRef, useState } from 'react';
import { isMidiSupported, listInputs, parseMidiMessage, requestMidiAccess } from '../midi.js';

const MAX_EVENT_LOG = 50;

/**
 * React glue around midi.js: requests access once, tracks the
 * available input ports (live, if one gets plugged/unplugged), lets
 * the caller pick which one to listen to, and exposes both a rolling
 * event log and the currently-held notes -- everything a live
 * diagnostic/feedback screen needs, with no music-theory analysis
 * happening here (that stays a deliberate post-recording step; see
 * theory.js and the design discussion in this repo's history for why).
 */
export function useMidiInput() {
  const [supported] = useState(isMidiSupported());
  const [status, setStatus] = useState('idle'); // idle | requesting | granted | denied
  const [error, setError] = useState(null);
  const [inputs, setInputs] = useState([]);
  const [selectedInputId, setSelectedInputId] = useState(null);
  const [events, setEvents] = useState([]);
  const [heldNotes, setHeldNotes] = useState(() => new Set());

  const midiAccessRef = useRef(null);
  const nextEventId = useRef(0);

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

  // Default to the first available port once inputs show up, and drop
  // the selection if that port disappears (e.g. unplugged).
  useEffect(() => {
    if (inputs.length === 0) {
      setSelectedInputId(null);
    } else if (!inputs.some((i) => i.id === selectedInputId)) {
      setSelectedInputId(inputs[0].id);
    }
  }, [inputs, selectedInputId]);

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

  return { supported, status, error, inputs, selectedInputId, setSelectedInputId, events, heldNotes };
}
