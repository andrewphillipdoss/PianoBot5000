# 3D piano visualizer (experimental)

Procedurally builds an 88-key 3D piano in Blender and animates its keys
pressing down in sync with any MIDI file -- including the ones
`pianobot chart`/`pianobot transcribe` produce. Not a downloaded 3D
asset: every key is generated geometry, positioned by the standard
piano key-layout pattern, hinged at its back edge so a simple rotation
presses it down convincingly.

Uses Blender's official headless Python package (`bpy`, on PyPI) --
no Blender application install, no GUI, no display needed. Verified
on Linux; not yet tried on macOS/Windows (their EGL/OpenGL setup for
headless rendering may need different system libraries -- see
"Rendering" below).

## Install

```bash
pip install bpy pretty_midi
```

On Linux, EEVEE (Blender's real-time-ish renderer) needs an EGL
library to render even headlessly:
```bash
sudo apt-get install libegl1 libegl-mesa0   # Debian/Ubuntu
```
Building the scene and writing the `.blend` file works without this;
only `bpy.ops.render.render(...)` needs it.

## Usage

**1. Build the piano scene:**
```bash
python3 build_piano.py
```
Writes `piano.blend` and a still preview render (`preview.png`) next
to this script.

**2. Animate it against a MIDI file:**
```bash
python3 animate_midi.py piano.blend song.mid piano_animated.blend --fps 24
```
Reads every note from every instrument track in `song.mid`, maps each
one to its matching key object (`key_<midi_note>_white` or
`key_<midi_note>_black`), and keyframes that key's hinge rotation down
at the note's start and back up shortly after it ends. Notes on the
same key that overlap or touch get merged into one continuous press
(a key can't be "half pressed" twice at once).

**3. Render frames:**
```bash
mkdir -p frames
python3 render_clip.py piano_animated.blend frames 1 192   # frame range, e.g. 8s at 24fps
```
Tuned for speed (low sample count, modest resolution) over
photorealism -- fine for previewing, raise `taa_render_samples` in the
script for a final render you actually want to keep.

**4. Encode a video, optionally with synced audio:**
```bash
ffmpeg -framerate 24 -i frames/frame_%05d.png -c:v libx264 -pix_fmt yuv420p video.mp4

# Optional: render the MIDI itself to real audio and mux it in --
# needs fluidsynth + a General MIDI soundfont (e.g. apt install
# fluidsynth fluid-soundfont-gm on Debian/Ubuntu):
fluidsynth -ni /usr/share/sounds/sf2/FluidR3_GM.sf2 song.mid -F audio.wav -r 44100
ffmpeg -i video.mp4 -i audio.wav -c:v copy -c:a aac -shortest video_with_audio.mp4
```

## Known limitations

- Only tuned/tested for a single-instrument-agnostic view: all notes
  from every MIDI track hit the same physical keys, same as a real
  piano would if you played the melody and chords with two hands.
- EEVEE render settings in `render_clip.py`-style scripts are tuned
  for *speed* (low sample count, modest resolution) over photorealism
  -- fine for previewing, worth raising `scene.eevee.taa_render_samples`
  for a final render you actually want to keep.
- The key layout/dimensions are a stylized approximation (real black-key
  spacing has small per-note variations this doesn't replicate exactly)
  -- reads clearly as a piano, isn't a precision replica.
