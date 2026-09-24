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

That's it — no manual steps first. Chordino (chord detection) is a
compiled Vamp plugin, not a pip package, and its usual download page
(vamp-plugins.org) points at a dead host, so the Dockerfile builds it
from source automatically instead (see `vamp-plugins/README.md` if
you're curious, or want to add a plugin of your own on top).

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
pip install -e ".[structure]"    # allin1 -- pulls torch, downloads weights on first run (see Known issues re: natten)
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
package, so `pip install` alone isn't enough. Its download page
(vamp-plugins.org) links out to a host that no longer resolves at all,
so there's no prebuilt binary left to fetch — build it from source
instead, same as the Dockerfile does:

1. `pip install -e ".[chords]"` installs the `vamp` Python host bindings.
2. Build NNLS Chroma (Linux):
   ```bash
   sudo apt-get install vamp-plugin-sdk libboost-dev   # Debian/Ubuntu
   git clone --depth 1 https://github.com/c4dm/nnls-chroma.git
   cd nnls-chroma
   make -f Makefile.linux VAMP_SDK_DIR=/usr BOOST_ROOT=/usr/include
   mkdir -p ~/vamp
   cp nnls-chroma.so nnls-chroma.n3 ~/vamp/
   ```
   (macOS/Windows: same repo has `Makefile.osx`/`Makefile.mingw` — you'd
   need their respective Vamp SDK + Boost installs instead; honestly,
   Docker is a lot less hassle here.)
3. Verify it's found:
   ```bash
   python -c "import vamp; print('nnls-chroma:chordino' in vamp.list_plugins())"
   ```

If you'd rather avoid the system-plugin step, `pianobot/chords.py` is
written as a single-purpose module behind the same `ChordEvent`
interface everything else consumes — swapping in `madmom` or another
chord estimator later only means rewriting `extract_chords()`.

## Known issues (fixed, documented for context)

**allin1's shipped DiNAT model doesn't import against any installable
`natten` release.** Its `dinat.py` imports specific low-level functions
(`natten1dav`, `natten1dqkrpb`, ...) that were removed from every
`natten` release still capable of installing against a current
PyTorch — `natten`'s older, API-matching releases never shipped
prebuilt Linux wheels at all (always compiled from source against
whatever torch is installed), and their source doesn't build against
modern torch (hardcoded for torch 1.13's C++ extension ABI). This is a
known, actively-discussed upstream issue (allin1's GitHub has several
open issues/PRs about it), not something specific to this project.

**Fixed here** by vendoring an unmerged community fix
(`mir-aidj/all-in-one` PR #39) as `patches/allin1/` — two files the
Dockerfile copies over allin1's installed `dinat.py`, replacing the
`natten` calls with a plain-PyTorch equivalent (einsum + indexing) used
whenever a tensor isn't on CUDA or `natten` isn't importable at all.
Verified by that PR against 54 test cases to produce identical output,
and reportedly *faster* than natten's own CPU kernel. See
`patches/allin1/README.md` for the full rationale and attribution. This
means `natten` is never actually needed in this Dockerfile at all.

Separately, also fixed: allin1's own packaging never declares `madmom`
as a dependency at all, despite needing it at runtime —
`pyproject.toml`'s `structure` extra declares it explicitly.
`madmom`'s last PyPI release also doesn't import on Python 3.10+ (`from
collections import MutableSequence`, removed from `collections` in
3.10), so that declaration points at its fixed-but-never-released
GitHub main branch instead of PyPI.

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
pianobot structure song.mp3   # allin1: prints beat/downbeat count + detected sections
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
*API* access but a restrictive network policy blocking plain `git`/`curl`
to github.com directly, plus some other hosts (model-weight hosts like
huggingface.co/dl.fbaipublicfiles.com, Debian's own package mirrors,
vamp-plugins.org, PyTorch's dedicated wheel index) — specific to that
environment, not a requirement of the project itself:

- All non-ML logic (cleanup, voicing, labeling, MIDI assembly) — unit
  tested, passing (17 tests).
- Basic Pitch — ran end-to-end (its weights ship inside the pip
  package, no separate download needed).
- Demucs, vamp, madmom, allin1 — install and fully import cleanly on
  Linux/Python 3.11 (verified in a bare venv reproducing the
  Dockerfile's exact install sequence, patch included); actual weight
  downloads/plugin binaries blocked in that sandbox specifically,
  expected to work normally elsewhere.
- `docker build` itself wasn't fully run end-to-end in that sandbox
  (its own `apt-get` layer needs Debian's package mirrors, also
  blocked there) — should build normally with regular internet access;
  every pip-level step it runs was verified directly first.
- The Chordino build step (`git clone` + `make` against
  `vamp-plugin-sdk`) is new and untested end-to-end in that sandbox too
  (direct `git`/`curl` to github.com is blocked there specifically,
  even though fetching individual files through other means worked) —
  it's a small, standard C++ build that people have documented doing
  this exact way for years, but it hasn't been run start-to-finish yet.
  If it fails on a real build, the error output is the most useful
  thing to send back.
- On `linux/arm64` (e.g. Docker Desktop on an Apple Silicon Mac), one
  real build failure surfaced on a real machine: `demucs`'s `sphn`
  dependency has no prebuilt wheel for that platform, so pip compiles
  it from source (a Rust build that bootstraps `cargo` on its own),
  which in turn builds the Opus codec via CMake — and CMake 4.0+
  refuses to configure Opus's old `CMakeLists.txt` at all
  ("Compatibility with CMake < 3.5 has been removed"). Fixed by setting
  `CMAKE_POLICY_VERSION_MINIMUM=3.5` in the Dockerfile, CMake's own
  documented opt-back-in for exactly this situation — a known,
  ecosystem-wide issue post-CMake-4.0, not specific to this project.

Next step on a real machine: `docker build -t pianobot5000 .` (or the
native install), then run `pianobot` on a real song file for the first
true end-to-end output.
