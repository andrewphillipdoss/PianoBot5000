# PianoBot5000

A browser app for recording songs straight off a real piano: play the
chords, play the melody along with them, section by section, and it
builds a chart -- the goal being fluency in inversions, transposition,
and eventually a long-form improv-friendly medley, one properly-learned
song at a time.

Everything lives in [`recorder/`](recorder/README.md) -- see its
README for what's built so far and how to run it.

This is a from-scratch rebuild. An earlier Python CLI (chord/melody
chart -> MIDI, plus an audio-transcription mode) exists locally under
`legacy/` for reference; it's intentionally untracked (see
`.gitignore`) and not part of this project going forward.
