# PianoBot5000

Song audio in, piano-arrangement MIDI out: left hand plays beat-snapped
chord triads, right hand plays a cleaned-up monophonic melody line, and
song sections are written in as MIDI markers.

```
Song audio
  -> Demucs (stem separation: vocals / drums / bass / other)
      -> Basic Pitch on vocals -> monophonic, beat-quantized melody   (right hand)
      -> Chordino on bass+other -> triads snapped to the beat grid    (left hand)
      -> allin1 -> beats + sections, sections grouped into A/B/C...   (markers)
  -> pretty_midi assembly -> piano MIDI file
```

Each ML stage is an existing open-source model wrapped in its own
module; each "code we'd write" box (cleanup, voicing, labeling,
assembly) is plain Python with no ML dependency, so it can be unit
tested without any model installed.

See [`docs/pipeline-roadmap.html`](docs/pipeline-roadmap.html) for two
concrete, not-yet-built next steps (swing-aware quantization, and
consolidating repeated sections into one learned pattern) and the
longer-term idea behind them. Download and open it in a browser to
view it rendered — GitHub only shows its source.

## Project layout

```
src/pianobot/
  types.py        data contracts shared between stages (NoteEvent, ChordEvent, Beat, Section, ...)
  stems.py         Demucs wrapper
  melody.py        Basic Pitch wrapper + monophonic/quantize cleanup
  chords.py        Chordino (vamp) wrapper + beat-snapped, voice-led triad voicing
  structure.py     allin1 wrapper + A/B/C repeat labeling
  assemble.py      pretty_midi assembly -> .mid file
  pipeline.py      orchestrates the stages, caches intermediate JSON per stage
  cli.py           `pianobot` CLI entrypoint (Typer)
  synth.py         synthetic test-song generator (no real audio file needed)
tests/             unit tests for the non-ML stages + chord-label parsing
```

Also usable as a library — every stage module is a plain function you
can import and call directly (`from pianobot import melody, chords, ...`).

## Install

### Running via Docker (recommended)

The real ML stack here (PyTorch, numba, TensorFlow, ...) is only
reliably installable on a **current Linux** environment — several of
these projects have dropped support for older/less-common
OS+architecture combinations (Intel macOS in particular; see "Known
issues" below) in their recent releases, and chasing version ceilings
on a native host OS is a losing game. The Dockerfile gives everyone —
whatever machine they're on — the same known-good Linux environment:

```bash
docker build -t pianobot5000 .
```

Chordino needs one manual step first (a compiled plugin binary, not a
pip package — see `vamp-plugins/README.md`): download the Linux NNLS
Chroma build from
https://www.vamp-plugins.org/download.html#nnls-chroma and place its
files in `./vamp-plugins/` before building. Skipping it still builds
fine — `pianobot chords` will just report the plugin isn't installed.

Run it against a song on your host machine by mounting a folder in:

```bash
docker run --rm -v "$(pwd)/data:/data" -w /data pianobot5000 \
    pianobot convert song.mp3 -o song.mid
```

(put `song.mp3` in a local `./data/` folder first; `song.mid` shows up
there too once it's done). Swap `pianobot convert ...` for any of the
per-stage debug commands below, or `pytest` / `bash` to poke around
inside the image.

### Native install (Linux, or if you'd rather not use Docker)

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"          # core + pretty_midi/typer/rich + pytest, no ML models yet
```

Each model stage is an optional extra, since they have very different
weight and install stories:

```bash
pip install -e ".[melody]"       # Basic Pitch -- CPU-friendly, weights ship in the pip package
pip install -e ".[stems]"        # Demucs -- pulls torch, downloads ~80-300MB of weights on first run
pip install -e ".[structure]"    # allin1 -- pulls torch, downloads weights on first run (see Known issues)
pip install -e ".[chords]"       # vamp python bindings only -- see Chordino setup below
pip install -e ".[all]"          # all four
```

`vamp` and `structure`'s `madmom` dependency both need
`--no-build-isolation` (their setup scripts import numpy/Cython
directly without declaring them as *build* dependencies, so pip's
isolated build environment doesn't have them):
```bash
pip install --no-build-isolation vamp
pip install --no-build-isolation "madmom @ git+https://github.com/CPJKU/madmom.git"
pip install -e ".[all]"   # now sees both as already satisfied
```

### Chordino setup (extra step, not pip-installable)

Chord detection uses **Chordino**, part of the NNLS Chroma **Vamp
plugin** — this is a compiled audio-analysis plugin, not a Python
package, so `pip install` alone isn't enough:

1. `pip install -e ".[chords]"` installs the `vamp` Python host bindings.
2. Download and install the NNLS Chroma Vamp plugin for your OS from
   https://www.vamp-plugins.org/download.html#nnls-chroma into your
   system's Vamp plugin path:
   - Linux: `~/vamp/` or `/usr/local/lib/vamp/`
   - macOS: `~/Library/Audio/Plug-Ins/Vamp/`
   - Windows: `%ProgramFiles%\Vamp Plugins\`
3. Verify it's found:
   ```bash
   python -c "import vamp; print('nnls-chroma:chordino' in vamp.list_plugins())"
   ```

If you'd rather avoid the system-plugin step, `pianobot/chords.py` is
written as a single-purpose module behind the same `ChordEvent`
interface everything else consumes — swapping in `madmom` or another
chord estimator later only means rewriting `extract_chords()`.

## Known issues

**`structure` (allin1) installs but doesn't currently work.** Its
DiNAT model imports specific low-level functions
(`natten1dav`, `natten1dqkrpb`, ...) from the `natten` package that
were removed from every `natten` release still capable of installing
against a current PyTorch — `natten`'s older, API-matching releases
never shipped prebuilt Linux wheels at all (always compiled from
source against whatever torch is installed), and their source doesn't
build against modern torch (hardcoded for torch 1.13's C++ extension
ABI). `pianobot structure` fails with a clear `ModuleNotFoundError:
natten` rather than crashing confusingly, but there's currently no
version of `natten` that's both installable and compatible. A real fix
means pinning `allin1`/`natten`/`torch` to whatever versions were
current when allin1 was released (~mid-2023) — which would hold back
every other extra sharing that same environment, since there's only
one installed `torch` at a time. Worth its own isolated environment if
picked up later, not a default-install fix.

Separately (already fixed, not something you need to do anything
about): allin1's own packaging never declares `madmom` as a dependency
at all, despite needing it at runtime — `pyproject.toml`'s `structure`
extra declares it explicitly. `madmom`'s last PyPI release also
doesn't import on Python 3.10+ (`from collections import
MutableSequence`, removed from `collections` in 3.10), so that
declaration points at its fixed-but-never-released GitHub main branch
instead of PyPI.

## Usage

```bash
pianobot convert path/to/song.mp3 -o song.mid
```

Options: `--work-dir` (where stems + intermediate analysis JSON are
cached, default `./.pianobot/<song-name>/`), `--tempo` (BPM written
into the MIDI file), `--subdivisions-per-beat` (melody quantization
grid resolution — default 4, i.e. 16th notes; raise it if a fast vocal
run is getting collapsed/dropped, lower it if the melody sounds
fussy/jittery from picking up transcription noise as real rhythm; see
`melody.clean_melody`'s docstring for the full tradeoff). Note this
grid is always "straight" (evenly subdivided) — it doesn't attempt to
detect or preserve a swing feel.

Re-running on the same song reuses cached stems/analysis instead of
re-running the models — handy for iterating on `assemble.py` or the
cleanup/voicing logic without waiting on Demucs/allin1 again. Delete
the relevant file under `<work-dir>/analysis/` (or the whole work dir)
to force a stage to re-run.

### Debugging: run one stage at a time

If `convert` doesn't produce what you expect, run each stage on its
own and inspect its output before moving to the next — much faster
than guessing which of the four models is at fault:

```bash
pianobot stems     song.mp3   # Demucs: prints where vocals/drums/bass/other.wav landed
pianobot structure song.mp3   # allin1: currently broken, see "Known issues" above
pianobot melody    song.mp3   # Basic Pitch: prints the raw, then cleaned-up melody notes
pianobot chords    song.mp3   # Chordino: prints the raw, then beat-snapped/voiced chords
pianobot assemble  song.mp3 -o song.mid   # no models -- just builds the MIDI from what's cached
```

Every one of these (plus `convert`) reads and writes the same on-disk
cache under `<work-dir>/analysis/`, so you can run them in any order,
any number of times, and mix them freely with full `convert` runs —
whatever's already cached gets reused instead of recomputed. `melody`
and `chords` will show you raw model output immediately even before
`structure` has run; they just can't show the beat-quantized/snapped
version until there's a beat grid to snap onto. `assemble` is the odd
one out: it never touches a model, so it's instant and is the fastest
way to experiment with the final MIDI-writing step, as long as
`structure`, `melody`, and `chords` have each been run at least once
first (in any order).

### No song file yet? Generate a synthetic one

```bash
python -c "from pianobot.synth import generate_synthetic_song; generate_synthetic_song('synthetic.wav')"
pianobot convert synthetic.wav -o synthetic.mid
```

`synth.py` generates a short toy "song" (a vibrato melody line over a
chord pad and a kick pulse) at a known tempo/chord progression, so you
can sanity-check each model's output against ground truth instead of
just "it didn't crash."

## Testing

```bash
pytest
```

The test suite only covers the non-ML stages (melody cleanup, chord
snapping/voicing, section labeling, MIDI assembly) plus the Chordino
label parser — these run anywhere, no models or plugin binaries
required. There isn't yet an end-to-end test that runs the real
Demucs/Basic Pitch/Chordino/allin1 models, since that needs all four
installed (see above).

## Status / what's been verified so far

Built and tested in a sandboxed, no-GPU dev container with PyPI/GitHub
access but a restrictive network policy blocking some other hosts
(model-weight hosts like huggingface.co/dl.fbaipublicfiles.com, Debian's
own package mirrors, vamp-plugins.org, PyTorch's dedicated wheel index)
— specific to that environment, not a requirement of the project itself:

- All non-ML logic (cleanup, voicing, labeling, MIDI assembly) — unit
  tested, passing (17 tests).
- Basic Pitch — ran end-to-end (its weights ship inside the pip
  package, no separate download needed).
- Demucs, vamp, madmom — install and import cleanly on Linux/Python
  3.11 (verified in a bare venv reproducing the Dockerfile's exact
  install sequence); actual weight downloads/plugin binaries blocked
  in that sandbox specifically, expected to work normally elsewhere.
- allin1 — installs cleanly but doesn't import successfully; see
  "Known issues" above (a real, current upstream incompatibility
  between allin1's model code and every installable `natten` release,
  unrelated to this project's own code).
- `docker build` itself wasn't fully run end-to-end in that sandbox
  (its own `apt-get` layer needs Debian's package mirrors, also
  blocked there) — should build normally with regular internet access;
  every pip-level step it runs was verified directly first.

Next step on a real machine: `docker build -t pianobot5000 .` (or the
native install), then run `pianobot` on a real song file for the first
true end-to-end output.
