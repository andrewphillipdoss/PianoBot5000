# PianoBot5000

Chord/melody chart in, piano-arrangement MIDI out: left hand plays
voice-led chord triads, right hand plays the melody, and song sections
are written in as MIDI markers. The chart can be rendered in any key
you like, regardless of what key it was written in.

```
Chart (chords + melody + sections, in beats, in a known key)
  -> [transpose to any key]  (pure pitch-shift, no re-voicing needed)
  -> voice-led triads (left hand) + melody as-is (right hand)
  -> pretty_midi assembly -> piano MIDI file
```

This project used to start from a song *recording* and guess a chart
from it (stem separation + Basic Pitch + Chordino + allin1 -- see
"Transcribe mode" below). That's still here, but it's no longer the
primary path: guessing chords/melody from audio is inherently lossy
(that's exactly the "tunings are off" problem this pivot was made to
get away from), and the actual goal is learning standards -- which
means starting from a *known-correct* chart, not a machine's best
guess at one.

## Project layout

```
src/pianobot/
  types.py          data contracts shared everywhere (NoteEvent, ChordEvent, Beat, Section, Chart, ...)
  theory.py         chord-symbol parsing, triad voicing/voice-leading, transposition -- no audio dependency
  assemble.py       pretty_midi assembly -> .mid file
  cli.py            `pianobot` CLI entrypoint (Typer) -- the `chart` command + the `transcribe` sub-app
  charts/
    simple_format.py  hand-writable JSON chart format -> Chart
    transpose.py       shift a Chart to a different key
    arrange.py         Chart -> MIDI-ready (melody, chords, sections), with the arrangement "style" knob
  transcribe/        the optional, legacy audio-to-MIDI pipeline (see below), moved here out of the way
    stems.py, melody.py, chords.py, structure.py, pipeline.py, synth.py, cli.py
tests/               unit tests for both paths
examples/
  practice-changes.json   a small worked example chart (see "Usage" below)
```

Also usable as a library, not just a CLI (`from pianobot import theory, assemble; from pianobot.charts import simple_format, ...`).

## Install

```bash
pip install pianobot5000
```

That's it -- the chart-based path needs nothing beyond `pretty_midi`,
`typer`, and `rich`. No torch, no audio libraries, nothing to compile,
no Docker. (Transcribe mode has its own, much heavier install story --
see its own section below.)

## Usage

```bash
pianobot chart examples/practice-changes.json -o out.mid
```

Options: `--key Eb` (transpose to a different key before rendering --
defaults to the chart's own key), `--tempo 96` (override the chart's
own tempo), `--style simple` (left-hand arrangement style -- only
`simple`, plain voice-led block triads, is implemented so far; see
`charts/arrange.py`'s docstring for where more styles like a comping
rhythm or a walking bass line would plug in later).

### Chart format

A chart is a small JSON file: chords over time, melody over time, and
song sections, all in **beats** from the start (not seconds -- tempo
only matters at the very end, when rendering to MIDI). Chord symbols
use ordinary lead-sheet shorthand (`"Cm7"`, `"F#dim"`, `"Bbsus4"`, ...);
melody pitches can be a note name (`"Eb4"`) or a raw MIDI number.

```json
{
  "title": "Practice Changes",
  "key": "C",
  "tempo": 96,
  "sections": [
    {"label": "A", "start_beat": 0, "end_beat": 32}
  ],
  "chords": [
    {"beat": 0, "duration_beats": 4, "chord": "Cmaj7"},
    {"beat": 4, "duration_beats": 4, "chord": "Am7"}
  ],
  "melody": [
    {"beat": 0, "duration_beats": 1, "pitch": "C4"},
    {"beat": 1, "duration_beats": 1, "pitch": "E4", "velocity": 90}
  ]
}
```

See `examples/practice-changes.json` for a full 8-bar example, and
`pianobot/charts/simple_format.py`'s docstring for the exact schema.
This is meant to be the first of several importers -- anything that
can produce a `pianobot.types.Chart` (chords/melody/sections in beats)
plugs into the rest of the pipeline (transposition, arranging,
MIDI-writing) without changes; a chart source with a murkier
redistribution license (e.g. community iReal Pro playlists) is
something to parse for personal practice use rather than to bundle
into this repo directly.

### Transposing without rendering

Transposition is a pure pitch-class/MIDI-pitch shift (see
`theory.key_semitone_offset`/`transpose_chords`/`transpose_notes`) --
no re-parsing, no re-voicing, no timing math. `--key` on the `chart`
command applies it before rendering; `pianobot.charts.transpose_chart`
is also directly importable if you want a transposed `Chart` object
without writing a MIDI file at all (e.g. to practice the same tune in
several keys in one sitting).

## Testing

```bash
pip install -e ".[dev]"
pytest
```

Everything is unit tested without needing any model, plugin binary, or
audio file: chart JSON parsing, transposition, beats->seconds
rendering, chord-symbol/Harte-label parsing, triad voicing/voice
leading, section labeling, and MIDI assembly.

---

## Transcribe mode (optional, legacy)

```
Song audio
  -> Demucs (stem separation: vocals / drums / bass / other)
      -> Basic Pitch on vocals -> monophonic, beat-quantized melody   (right hand)
      -> Chordino on bass+other -> triads snapped to the beat grid    (left hand)
      -> allin1 -> beats + sections, sections grouped into A/B/C...   (markers)
  -> pretty_midi assembly -> piano MIDI file
```

`pianobot transcribe convert song.mp3 -o song.mid` runs this whole
pipeline and writes a MIDI file, guessing a chart from a real
recording instead of starting from a known one. It's kept around for
when that's actually what you want (there's no hand-written chart for
the song, or you want to compare a real recording against one) -- but
expect real audio-transcription error: an ML chord/melody guess is
never going to be as reliable as a known-correct chart, which is the
whole reason the chart-based path above exists.

See [`docs/pipeline-roadmap.html`](docs/pipeline-roadmap.html) for two
ideas that were scoped for *this* path specifically (swing-aware
quantization, and consolidating repeated sections into one learned
pattern) before the project's focus moved to charts instead. Download
and open it in a browser to view it rendered -- GitHub only shows its
source.

### Running via Docker (recommended for transcribe mode)

The real ML stack here (PyTorch, numba, TensorFlow, ...) is only
reliably installable on a **current Linux** environment. `Dockerfile.transcribe`
gives everyone -- whatever machine they're on -- the same known-good
Linux environment:

```bash
docker build -f Dockerfile.transcribe -t pianobot5000-transcribe .
```

That's it -- no manual steps first. Chordino (chord detection) is a
compiled Vamp plugin, not a pip package, and its usual download page
(vamp-plugins.org) points at a dead host, so the Dockerfile builds it
from source automatically instead (see `vamp-plugins/README.md` if
you're curious, or want to add a plugin of your own on top).

Run it against a song on your host machine by mounting a folder in:

```bash
docker run --rm -v "$(pwd)/data:/data" -w /data pianobot5000-transcribe \
    pianobot transcribe convert song.mp3 -o song.mid
```

(put `song.mp3` in a local `./data/` folder first; `song.mid` shows up
there too once it's done). Swap `pianobot transcribe convert ...` for
any of the per-stage debug commands below, or `pytest` / `bash` to poke
around inside the image.

### Native install (Linux, or if you'd rather not use Docker)

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"          # core + pretty_midi/typer/rich + pytest, no ML models yet
```

Each model stage is an optional extra, since they have very different
weight and install stories:

```bash
pip install -e ".[transcribe-melody]"       # Basic Pitch -- CPU-friendly, weights ship in the pip package
pip install -e ".[transcribe-stems]"        # Demucs -- pulls torch + numpy/soundfile, downloads ~80-300MB of weights on first run
pip install -e ".[transcribe-structure]"    # allin1 -- pulls torch, downloads weights on first run (see Known issues re: natten)
pip install -e ".[transcribe-chords]"       # vamp python bindings only -- see Chordino setup below
pip install -e ".[transcribe]"              # all four
```

`vamp` and `transcribe-structure`'s `madmom` dependency both need
`--no-build-isolation` (their setup scripts import numpy/Cython
directly without declaring them as *build* dependencies, so pip's
isolated build environment doesn't have them):
```bash
pip install --no-build-isolation vamp
pip install --no-build-isolation "madmom @ git+https://github.com/CPJKU/madmom.git"
pip install -e ".[transcribe]"   # now sees both as already satisfied
```

### Chordino setup (extra step, not pip-installable)

Chord detection uses **Chordino**, part of the NNLS Chroma **Vamp
plugin** -- this is a compiled audio-analysis plugin, not a Python
package, so `pip install` alone isn't enough. Its download page
(vamp-plugins.org) links out to a host that no longer resolves at all,
so there's no prebuilt binary left to fetch -- build it from source
instead, same as the Dockerfile does:

1. `pip install -e ".[transcribe-chords]"` installs the `vamp` Python host bindings.
2. Build NNLS Chroma (Linux):
   ```bash
   sudo apt-get install vamp-plugin-sdk libboost-dev   # Debian/Ubuntu
   git clone --depth 1 https://github.com/c4dm/nnls-chroma.git
   cd nnls-chroma
   make -f Makefile.linux VAMP_SDK_DIR=/usr BOOST_ROOT=/usr/include
   mkdir -p ~/vamp
   cp nnls-chroma.so nnls-chroma.n3 ~/vamp/
   ```
   (macOS/Windows: same repo has `Makefile.osx`/`Makefile.mingw` -- you'd
   need their respective Vamp SDK + Boost installs instead; honestly,
   Docker is a lot less hassle here.)
3. Verify it's found:
   ```bash
   python -c "import vamp; print('nnls-chroma:chordino' in vamp.list_plugins())"
   ```

### Debugging: run one stage at a time

If `pianobot transcribe convert` doesn't produce what you expect, run
each stage on its own and inspect its output before moving to the
next -- much faster than guessing which of the four models is at
fault:

```bash
pianobot transcribe stems     song.mp3   # Demucs: prints where vocals/drums/bass/other.wav landed
pianobot transcribe structure song.mp3   # allin1: prints beat/downbeat count + detected sections
pianobot transcribe melody    song.mp3   # Basic Pitch: prints the raw, then cleaned-up melody notes
pianobot transcribe chords    song.mp3   # Chordino: prints the raw, then beat-snapped/voiced chords
pianobot transcribe assemble  song.mp3 -o song.mid   # no models -- just builds the MIDI from what's cached
```

Every one of these (plus `convert`) reads and writes the same on-disk
cache under `<work-dir>/analysis/`, so you can run them in any order,
any number of times, and mix them freely with full `convert` runs --
whatever's already cached gets reused instead of recomputed.

### No song file yet? Generate a synthetic one

```bash
python -c "from pianobot.transcribe.synth import generate_synthetic_song; generate_synthetic_song('synthetic.wav')"
pianobot transcribe convert synthetic.wav -o synthetic.mid
```

`synth.py` generates a short toy "song" (a vibrato melody line over a
chord pad and a kick pulse) at a known tempo/chord progression, so you
can sanity-check each model's output against ground truth instead of
just "it didn't crash."

### Known issues (fixed, documented for context)

**allin1's shipped DiNAT model doesn't import against any installable
`natten` release.** Its `dinat.py` imports specific low-level functions
(`natten1dav`, `natten1dqkrpb`, ...) that were removed from every
`natten` release still capable of installing against a current
PyTorch -- `natten`'s older, API-matching releases never shipped
prebuilt Linux wheels at all (always compiled from source against
whatever torch is installed), and their source doesn't build against
modern torch (hardcoded for torch 1.13's C++ extension ABI). This is a
known, actively-discussed upstream issue (allin1's GitHub has several
open issues/PRs about it), not something specific to this project.

**Fixed here** by vendoring an unmerged community fix
(`mir-aidj/all-in-one` PR #39) as `patches/allin1/` -- two files the
Dockerfile copies over allin1's installed `dinat.py`, replacing the
`natten` calls with a plain-PyTorch equivalent (einsum + indexing) used
whenever a tensor isn't on CUDA or `natten` isn't importable at all.
Verified by that PR against 54 test cases to produce identical output,
and reportedly *faster* than natten's own CPU kernel. See
`patches/allin1/README.md` for the full rationale and attribution. This
means `natten` is never actually needed in this Dockerfile at all.

Separately, also fixed: allin1's own packaging never declares `madmom`
as a dependency at all, despite needing it at runtime --
`pyproject.toml`'s `transcribe-structure` extra declares it explicitly.
`madmom`'s last PyPI release also doesn't import on Python 3.10+ (`from
collections import MutableSequence`, removed from `collections` in
3.10), so that declaration points at its fixed-but-never-released
GitHub main branch instead of PyPI.

### Status / what's been verified so far (transcribe mode)

Built and tested in a sandboxed, no-GPU dev container with PyPI/GitHub
*API* access but a restrictive network policy blocking plain `git`/`curl`
to github.com directly, plus some other hosts (model-weight hosts like
huggingface.co/dl.fbaipublicfiles.com, Debian's own package mirrors,
vamp-plugins.org, PyTorch's dedicated wheel index) -- specific to that
environment, not a requirement of the project itself:

- All non-ML logic (cleanup, voicing, labeling, MIDI assembly) -- unit
  tested, passing.
- Basic Pitch -- ran end-to-end (its weights ship inside the pip
  package, no separate download needed).
- Demucs, vamp, madmom, allin1 -- install and fully import cleanly on
  Linux/Python 3.11 (verified in a bare venv reproducing the
  Dockerfile's exact install sequence, patch included); actual weight
  downloads/plugin binaries blocked in that sandbox specifically,
  expected to work normally elsewhere.
- The Chordino build step (`git clone` + `make` against
  `vamp-plugin-sdk`) and the `docker build` itself have both since been
  confirmed working end-to-end on a real machine (Apple Silicon Mac,
  Docker Desktop) -- see the CMake note below, the one real issue that
  surfaced there.
- On `linux/arm64` (e.g. Docker Desktop on an Apple Silicon Mac), one
  real build failure surfaced on a real machine: `demucs`'s `sphn`
  dependency has no prebuilt wheel for that platform, so pip compiles
  it from source (a Rust build that bootstraps `cargo` on its own),
  which in turn builds the Opus codec via CMake -- and CMake 4.0+
  refuses to configure Opus's old `CMakeLists.txt` at all
  ("Compatibility with CMake < 3.5 has been removed"). Fixed by setting
  `CMAKE_POLICY_VERSION_MINIMUM=3.5` in the Dockerfile, CMake's own
  documented opt-back-in for exactly this situation -- a known,
  ecosystem-wide issue post-CMake-4.0, not specific to this project.
