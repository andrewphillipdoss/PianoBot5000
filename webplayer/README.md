# Falling-notes web player

Generates a single self-contained `.html` file -- a Neothesia/Synthesia-style
"falling notes" player -- from any MIDI file, including the ones `pianobot
chart`/`pianobot transcribe` produce. No server, no build step, no
dependencies at runtime: open the file in a browser, or publish it wherever
a static page can go. Audio is synthesized live in the browser via the Web
Audio API (no embedded audio file), scheduled a fraction of a second ahead
of playback so it stays tightly in sync with the falling notes on screen.

## Install

```bash
pip install pretty_midi
```

## Usage

```bash
python3 generate.py song.mid -o falling_notes.html --title "My Song"
```

`-o`/`--output` defaults to the MIDI file's own name with a `.html`
extension; `--title` defaults to the MIDI file's stem. Every note from
every instrument track is included. Which hand a note is drawn as follows
this project's own track-naming convention -- an instrument named
"Melody..." is drawn as the right hand, anything else as the left -- with
a safe fallback (everything left hand) for MIDI files that don't use that
naming at all.

Open the resulting file directly in a browser (`open falling_notes.html`
on macOS, or just double-click it) -- press Play and the notes fall toward
an on-screen keyboard, lighting up and sounding as they arrive.

## How it works

`template.html` is the actual player: a `<canvas>`-based falling-notes
renderer plus a small Web Audio synth, with a `const SONG = __SONG_DATA__;`
placeholder where the song data goes. `generate.py` reads a MIDI file with
`pretty_midi`, turns it into a small JSON structure (`{title, duration,
notes: [{pitch, start, end, hand}, ...]}`), and substitutes it into that
placeholder -- the output is one plain HTML file with the data baked
directly in.

## Known limitations

- Meant for a single rendering of one MIDI file at a time -- there's no
  playlist/multi-song UI, just one player per generated file.
- The keyboard range shown is derived from the song's own lowest/highest
  notes (rounded out to whole octaves), not a fixed 88-key range, so very
  short/narrow-range songs get a correspondingly narrow keyboard.
- Playback timing follows the MIDI file's own note start/end times exactly
  -- there's no separate quantization or humanization step here (that's a
  property of whatever produced the MIDI file, e.g. `pianobot chart`'s
  arrangement style).
