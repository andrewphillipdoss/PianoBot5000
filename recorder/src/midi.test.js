import { afterEach, describe, expect, it, vi } from 'vitest';
import { MidiUnsupportedError, isMidiSupported, listInputs, listOutputs, parseMidiMessage, requestMidiAccess, sendNoteOff, sendNoteOn } from './midi.js';

describe('parseMidiMessage', () => {
  it('parses a note-on message', () => {
    expect(parseMidiMessage({ data: [0x90, 60, 90], timeStamp: 123.4 })).toEqual({
      timestamp: 123.4,
      type: 'noteon',
      note: 60,
      velocity: 90,
    });
  });

  it('parses a note-off message', () => {
    expect(parseMidiMessage({ data: [0x80, 60, 0], timeStamp: 456.0 })).toEqual({
      timestamp: 456.0,
      type: 'noteoff',
      note: 60,
      velocity: 0,
    });
  });

  it('ignores the channel nibble -- any of the 16 channels parses the same', () => {
    // 0x93 = note-on, channel 3 (channel is the low nibble, message type is the high nibble).
    expect(parseMidiMessage({ data: [0x93, 60, 90], timeStamp: 0 })?.type).toBe('noteon');
    expect(parseMidiMessage({ data: [0x9f, 60, 90], timeStamp: 0 })?.type).toBe('noteon');
  });

  it('returns null for a non-note message (e.g. sustain pedal / control change)', () => {
    expect(parseMidiMessage({ data: [0xb0, 64, 127], timeStamp: 0 })).toBeNull();
  });
});

describe('isMidiSupported', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is true when navigator.requestMIDIAccess exists', () => {
    vi.stubGlobal('navigator', { requestMIDIAccess: () => {} });
    expect(isMidiSupported()).toBe(true);
  });

  it('is false when it does not (e.g. Safari/Firefox)', () => {
    vi.stubGlobal('navigator', {});
    expect(isMidiSupported()).toBe(false);
  });
});

describe('requestMidiAccess', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws a clear, typed error when Web MIDI is not supported', async () => {
    vi.stubGlobal('navigator', {});
    await expect(requestMidiAccess()).rejects.toBeInstanceOf(MidiUnsupportedError);
  });

  it('delegates to navigator.requestMIDIAccess when supported', async () => {
    const fakeAccess = { inputs: new Map() };
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockResolvedValue(fakeAccess) });
    await expect(requestMidiAccess()).resolves.toBe(fakeAccess);
  });
});

describe('listInputs', () => {
  it('returns plain data for every available input port', () => {
    const fakeAccess = {
      inputs: new Map([
        ['id-1', { id: 'id-1', name: 'USB MIDI Keyboard', manufacturer: 'Some Co' }],
        ['id-2', { id: 'id-2', name: 'IAC Driver Bus 1', manufacturer: 'Apple' }],
      ]),
    };
    expect(listInputs(fakeAccess)).toEqual([
      { id: 'id-1', name: 'USB MIDI Keyboard', manufacturer: 'Some Co' },
      { id: 'id-2', name: 'IAC Driver Bus 1', manufacturer: 'Apple' },
    ]);
  });

  it('returns an empty list when nothing is connected', () => {
    expect(listInputs({ inputs: new Map() })).toEqual([]);
  });
});

describe('listOutputs', () => {
  it('returns plain data for every available output port', () => {
    const fakeAccess = {
      outputs: new Map([['out-1', { id: 'out-1', name: 'USB MIDI Synth', manufacturer: 'Some Co' }]]),
    };
    expect(listOutputs(fakeAccess)).toEqual([{ id: 'out-1', name: 'USB MIDI Synth', manufacturer: 'Some Co' }]);
  });

  it('returns an empty list when nothing is connected', () => {
    expect(listOutputs({ outputs: new Map() })).toEqual([]);
  });
});

describe('sendNoteOn/sendNoteOff', () => {
  it('sends a note-on with the given note/velocity on channel 0 by default', () => {
    const output = { send: vi.fn() };
    sendNoteOn(output, 60, 100);
    expect(output.send).toHaveBeenCalledWith([0x90, 60, 100]);
  });

  it('sends a note-off with velocity 0', () => {
    const output = { send: vi.fn() };
    sendNoteOff(output, 60);
    expect(output.send).toHaveBeenCalledWith([0x80, 60, 0]);
  });

  it('packs the channel into the low nibble of the status byte', () => {
    const output = { send: vi.fn() };
    sendNoteOn(output, 60, 100, 3);
    expect(output.send).toHaveBeenCalledWith([0x93, 60, 100]);
  });

  it('clamps note/velocity to a valid MIDI byte range', () => {
    const output = { send: vi.fn() };
    sendNoteOn(output, 200, -10);
    expect(output.send).toHaveBeenCalledWith([0x90, 127, 0]);
  });

  it('does nothing when no output is selected (null)', () => {
    expect(() => sendNoteOn(null, 60, 100)).not.toThrow();
    expect(() => sendNoteOff(null, 60)).not.toThrow();
  });
});
