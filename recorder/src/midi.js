/**
 * The one place this app talks to the Web MIDI API directly -- access
 * requests, port listing, raw-byte message parsing (input), and
 * raw-byte message sending (output). Deliberately thin and
 * framework-free (no React here) so it stays testable with fake data;
 * the stateful "listen while recording, and let any screen pick an
 * output port" piece lives in a React hook (MidiProvider.jsx) built on
 * top of this, not in here.
 *
 * Web MIDI is Chrome-only (not Safari/Firefox) -- see isMidiSupported.
 */

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const MAX_MIDI_BYTE = 127;

function clampByte(value) {
  return Math.max(0, Math.min(MAX_MIDI_BYTE, Math.round(value)));
}

export class MidiUnsupportedError extends Error {}

export function isMidiSupported() {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}

/** Prompt for MIDI access (the browser asks permission the first time). */
export async function requestMidiAccess() {
  if (!isMidiSupported()) {
    throw new MidiUnsupportedError(
      "Web MIDI isn't supported in this browser -- use Chrome (or another Chromium-based " +
        "browser); Safari and Firefox don't implement the Web MIDI API."
    );
  }
  return navigator.requestMIDIAccess();
}

/** The available MIDI input ports, as plain data (no live MIDIInput objects). */
export function listInputs(midiAccess) {
  return [...midiAccess.inputs.values()].map((input) => ({
    id: input.id,
    name: input.name,
    manufacturer: input.manufacturer,
  }));
}

/** Same idea, for output ports -- a real MIDI device/DAW to send notes to, as an alternative to this app's own synthesized voice. */
export function listOutputs(midiAccess) {
  return [...midiAccess.outputs.values()].map((output) => ({
    id: output.id,
    name: output.name,
    manufacturer: output.manufacturer,
  }));
}

/**
 * Send a note-on/note-off straight to a live MIDIOutput (the object
 * Web MIDI itself hands back from `midiAccess.outputs`, not the plain
 * `{id, name, manufacturer}` shape `listOutputs` returns -- callers
 * that only have an id look it up via `midiAccess.outputs.get(id)`
 * first, same as input selection already does). Velocity/note are
 * clamped to a valid MIDI byte (0-127) rather than left to produce a
 * malformed message if a caller passes something out of range.
 */
export function sendNoteOn(output, note, velocity = 100, channel = 0) {
  output?.send([NOTE_ON | (channel & 0x0f), clampByte(note), clampByte(velocity)]);
}

export function sendNoteOff(output, note, channel = 0) {
  output?.send([NOTE_OFF | (channel & 0x0f), clampByte(note), 0]);
}

/**
 * Parse one raw Web MIDI message into the {timestamp, type, note,
 * velocity} shape `theory.js`'s `messagesToNotes` expects -- or null
 * for anything that isn't a note-on/note-off (sustain pedal, program
 * change, clock, ...), which this app has no use for.
 *
 * A MIDI message's first byte (the "status byte") packs two things:
 * its high nibble says what kind of message it is (0x90 = note-on,
 * 0x80 = note-off, ...), its low nibble says which of the 16 MIDI
 * channels it's on -- we don't care which channel, so channel is
 * masked off and ignored.
 */
export function parseMidiMessage({ data, timeStamp }) {
  const status = data[0];
  const messageType = status & 0xf0;
  if (messageType !== NOTE_ON && messageType !== NOTE_OFF) return null;

  return {
    timestamp: timeStamp,
    type: messageType === NOTE_ON ? 'noteon' : 'noteoff',
    note: data[1],
    velocity: data[2] ?? 0,
  };
}
