# Recorder (in progress)

A browser app (React + Web MIDI) for recording songs straight off a real
piano: play the chords, play the melody along with them, section by
section, and it builds the same chart JSON format `pianobot chart`
already reads -- see the top-level README's "Learning a song by
recording it" section (once written) for the full design.

**Chrome only** -- the Web MIDI API isn't supported in Safari/Firefox.
Runs entirely client-side; no server, no build artifact beyond the
static site `vite build` produces.

## Status

This is being built in verified increments, not all at once. So far:

- [x] Project scaffolded (Vite + React, no extra framework beyond
      React itself -- see the design discussion in this repo's commit
      history for why React over a plain HTML/JS page).
- [x] `theory.js` -- the chord-detection/quantization logic ported
      from `pianobot.theory` (reverse chord recognition from raw pitch
      classes, light beat-grid quantization, the "chords pass is
      authoritative + trim trailing empty bars + round to nearest 4
      bars" rule, and raw-MIDI-message-to-NoteEvent pairing), fully
      unit tested (`npm test`) independent of any real MIDI hardware
      or browser.
- [x] "My Songs" screen (song list + "+ Add a Song"), built from the
      design wireframe, currently wired to placeholder data.
- [ ] Real Web MIDI capture (live note input from a connected keyboard).
- [ ] Live note visual feedback while recording (not full chord
      analysis -- that stays a post-take step; see the design
      discussion for why).
- [ ] The record-a-section flow (chords pass -> review/adjust -> melody
      pass playing the chords back -> section complete).
- [ ] Chart storage via the File System Access API, reading/writing
      the same JSON chart format `pianobot.charts.simple_format` uses,
      directly into this repo (or wherever you point it) -- no export
      step between this tool and the CLI.
- [ ] Lead sheet notation rendering (real note rendering from captured
      data, not the wireframe's hand-drawn placeholder SVG).

## Install / run

```bash
cd recorder
npm install
npm run dev       # http://localhost:5173, open in Chrome
npm test          # theory.js unit tests
```
