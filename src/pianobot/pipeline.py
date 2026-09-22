"""Orchestrates the full song -> piano MIDI pipeline.

Mirrors the stages in the architecture diagram:
  stems -> {melody, chords, beats/sections} -> cleanup/voicing/labeling -> assemble MIDI

Each stage's output is cached as JSON under work_dir/analysis/ so you
can inspect (or hand-edit) intermediate results without re-running
upstream models.

Beginner note: every other file in this package (stems.py, melody.py,
chords.py, structure.py, assemble.py) knows how to do exactly one job
and nothing else. This file is the "conductor": it calls each of those
jobs in the right order, passes each one's output into the next one
that needs it, and saves a copy of the intermediate results along the
way. If you want to understand "what does PianoBot5000 actually do,
end to end?", `run_pipeline` below is the function to read.

The caching helpers below (`cache_json`, `to_jsonable`, ...) are
exported (no leading underscore) because cli.py's per-stage debug
commands (`pianobot stems`/`structure`/`melody`/`chords`/`assemble`)
reuse them directly, so a step run individually and a step run as part
of the full `convert` pipeline always read/write the exact same cache
files under work_dir/analysis/.
"""

from __future__ import annotations

# `dataclasses` (the module, not to be confused with the `@dataclass`
# decorator we import elsewhere) gives us `is_dataclass` and `asdict`,
# both used below to convert our dataclass objects into plain
# dictionaries that the `json` module knows how to save.
import dataclasses
# `json` reads and writes the JSON text format -- the same format used
# by countless web APIs -- which we use here just as a convenient,
# human-readable way to cache intermediate results on disk.
import json
from pathlib import Path

# NumPy is a library for fast numeric array math; we use it for a
# single line below, summing two audio tracks together sample-by-sample.
import numpy as np
# `soundfile` reads and writes audio files (.wav, etc).
import soundfile as sf

# Import our own sibling modules -- each one is one stage of the
# pipeline, as described in the module docstring above.
from . import assemble, chords, melody, stems, structure
from .types import Beat, ChordEvent, NoteEvent, Section, SongAnalysis


def analysis_dir_for(work_dir: Path) -> Path:
    """The work_dir/analysis/ folder where cached stage results live,
    creating it if it doesn't exist yet.
    """
    d = Path(work_dir) / "analysis"
    d.mkdir(parents=True, exist_ok=True)
    return d


def run_pipeline(audio_path: Path, work_dir: Path, out_path: Path, tempo: float = 120.0) -> Path:
    """Run every pipeline stage on one song and write out a piano MIDI file.

    audio_path: the input song (e.g. an .mp3 or .wav)
    work_dir: a scratch folder for stems + cached intermediate analysis
    out_path: where to write the final .mid file
    tempo: BPM to record in the output MIDI file's tempo track

    This is exactly the same sequence of calls as running
    `pianobot stems`, `structure`, `melody`, `chords`, then `assemble`
    one at a time from the CLI (see cli.py) -- this function just does
    all five in one go. Because every stage reads/writes the same
    on-disk cache under work_dir/analysis/, running some stages
    individually first and then calling this (e.g. via `pianobot
    convert`) will reuse that cached work instead of redoing it.
    """
    # Normalize all three path-like arguments to real Path objects, in
    # case a caller passed in plain strings instead.
    audio_path = Path(audio_path)
    work_dir = Path(work_dir)
    analysis_dir = analysis_dir_for(work_dir)

    # --- Stage 1: split the song into separate instrument tracks ---
    # See stems.py. This is the most expensive stage, so
    # separate_stems already has its own "skip if already done"
    # caching logic built in (based on whether the expected output
    # files exist), rather than going through the generic `cache_json`
    # helper used below.
    stem_set = stems.separate_stems(audio_path, work_dir)

    # --- Stage 2: figure out the song's beats and sections ---
    # `cache_json(...)` (defined further down) either loads a
    # previously-saved result from disk, or calls the given function
    # and saves its result for next time. `structure.analyze_structure`
    # returns a tuple `(beats, sections)`, which we unpack directly
    # into two separate variables here.
    beats, raw_sections = cache_json(analysis_dir / "structure.json", lambda: structure.analyze_structure(audio_path))
    # Turn allin1's own section labels (like "chorus", "verse_2") into
    # our simplified "A"/"B"/"C" repeat labels.
    sections = structure.label_repeats(raw_sections)

    # --- Stage 3: extract and clean up the melody ---
    # Basic Pitch runs on the isolated vocal stem (not the full mix),
    # so it doesn't get confused by instruments playing at the same time.
    raw_melody = cache_json(analysis_dir / "melody_raw.json", lambda: melody.extract_melody_notes(stem_set.vocals))
    # Collapse Basic Pitch's raw (possibly messy/overlapping) output
    # into a single quantized melody line, using the beat grid from
    # Stage 2.
    clean_melody_notes = melody.clean_melody(raw_melody, beats)

    # --- Stage 4: detect chords and voice them for the left hand ---
    # Chordino works best on a "harmonic" mix (bass + other instruments,
    # no drums/vocals) -- see `write_harmonic_mix` below, which builds
    # that mix once and reuses the cached file on later runs.
    harmonic_mix = write_harmonic_mix(stem_set, work_dir)
    raw_chords = cache_json(analysis_dir / "chords_raw.json", lambda: chords.extract_chords(harmonic_mix))
    # Line the detected chords' start/end times up with the beat grid...
    snapped_chords = chords.snap_chords_to_beats(raw_chords, beats)
    # ...then turn each chord into an actual playable 3-note triad.
    chord_notes = chords.voice_triads(snapped_chords)

    # --- Bundle everything into one SongAnalysis object, for reference ---
    # This isn't strictly needed to build the MIDI file below, but
    # saving one combined "here's everything we figured out about this
    # song" JSON file is handy for debugging or for building other
    # tools later (e.g. a web viewer for the analysis).
    duration = _audio_duration(audio_path)
    analysis = SongAnalysis(
        duration=duration,
        beats=beats,
        sections=sections,
        melody_notes=clean_melody_notes,
        chords=snapped_chords,
    )
    write_json(analysis_dir / "song_analysis.json", to_jsonable(analysis))

    # --- Stage 5: assemble and save the final MIDI file ---
    pm = assemble.assemble_midi(clean_melody_notes, chord_notes, sections, tempo=tempo)
    return assemble.write_midi(pm, out_path)


def write_harmonic_mix(stem_set, work_dir: Path) -> Path:
    """Create (or reuse) a bass+other mix, for feeding into chord detection."""
    out_path = Path(work_dir) / "demucs" / "harmonic_mix.wav"
    # If we've already built this mix on a previous run, reuse it
    # instead of redoing the work.
    if out_path.exists():
        return out_path
    # `harmonic_mix_sources()` (see types.py) returns [bass_path, other_path].
    sources = stem_set.harmonic_mix_sources()
    tracks = []
    sr = None  # will hold the sample rate once we've read the first file
    for path in sources:
        data, this_sr = sf.read(str(path))
        # `sr or this_sr` keeps whatever `sr` already is if it's
        # already set (truthy), otherwise takes `this_sr` -- a compact
        # way of saying "set sr once, from the first file, and leave it
        # alone after that." (In practice all our stems share the same
        # sample rate anyway, since they all came from the same source
        # file via Demucs.)
        sr = sr or this_sr
        tracks.append(data)
    # The two stems should normally be the exact same length (they
    # came from the same source audio), but just in case of an
    # off-by-one-sample difference, trim both down to the shorter of
    # the two before adding them together -- adding arrays of
    # different lengths would otherwise raise an error.
    min_len = min(len(t) for t in tracks)
    # `np.sum([...], axis=0)` adds the two (now equal-length) audio
    # arrays together sample-by-sample -- literally mixing them, the
    # same way playing two tracks over the same speakers at once would.
    audio = np.sum([t[:min_len] for t in tracks], axis=0)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out_path), audio, sr)
    return out_path


def _audio_duration(audio_path: Path) -> float:
    """How long is this audio file, in seconds?"""
    # `sf.info(...)` reads just the audio file's header (fast --
    # doesn't load the actual sound data), giving us its total sample
    # count and sample rate, from which we can compute the duration.
    info = sf.info(str(audio_path))
    return float(info.frames) / float(info.samplerate)


def cache_json(path: Path, compute):
    """Run `compute()` and save its result to `path` as JSON -- unless
    `path` already exists, in which case just load and return that
    instead (skipping `compute()` entirely).

    `compute` is a function that takes no arguments (we always pass it
    in as a `lambda: ...` from the call sites above) -- passing the
    *function itself*, rather than calling it immediately, means we
    only actually run the (potentially slow) computation if we truly
    need to.
    """
    if path.exists():
        return from_jsonable(json.loads(path.read_text()))
    result = compute()
    write_json(path, to_jsonable(result))
    return result


def load_json(path: Path):
    """Load a previously-cached JSON file with no fallback computation
    -- raises FileNotFoundError if it doesn't exist yet.

    Use this (instead of `cache_json`) when you already know the file
    should exist and just want to read it back, e.g. cli.py's
    `assemble` command, which only ever runs after confirming all
    three cache files are present.
    """
    return from_jsonable(json.loads(Path(path).read_text()))


def write_json(path: Path, data) -> None:
    """Pretty-print `data` as JSON text and save it to `path`."""
    # `indent=2` makes the saved file nicely human-readable (each
    # nested level indented by 2 spaces) instead of one giant unbroken
    # line -- handy since one point of caching to JSON is so a human
    # can open the file and look at it.
    path.write_text(json.dumps(data, indent=2))


# --- minimal (de)serialization for the dataclasses in types.py ---
#
# The `json` module only natively understands a handful of plain
# Python types (dict, list, str, int, float, bool, None) -- it doesn't
# know how to save one of our custom NoteEvent/ChordEvent/etc. objects
# directly. The next two functions translate back and forth between
# "our dataclass objects" and "plain JSON-friendly dict/list/etc.",
# tagging each dictionary with a "__type__" field so we know which
# dataclass to rebuild when loading it back.

def to_jsonable(obj):
    """Recursively convert dataclasses/Paths/lists/dicts into plain,
    JSON-savable Python values.
    """
    # `dataclasses.is_dataclass(obj)` checks whether `obj` is an
    # instance of one of our @dataclass-decorated classes (NoteEvent,
    # ChordEvent, Beat, Section, ...).
    if dataclasses.is_dataclass(obj):
        # `dataclasses.asdict(obj)` turns e.g. a NoteEvent into a plain
        # dict like {"pitch": 60, "start": 0.0, "end": 0.5, "velocity": 90}.
        # We add a "__type__" entry recording the class's name (e.g.
        # "NoteEvent"), and recursively convert every field's value too
        # (in case a field itself holds a nested dataclass, list, etc.).
        return {"__type__": type(obj).__name__, **{k: to_jsonable(v) for k, v in dataclasses.asdict(obj).items()}}
    if isinstance(obj, Path):
        # JSON has no concept of a filesystem path -- store it as a
        # plain string instead.
        return str(obj)
    if isinstance(obj, (list, tuple)):
        # Recursively convert every item; note a Python tuple becomes
        # a JSON array (list) either way, since JSON doesn't
        # distinguish between the two.
        return [to_jsonable(v) for v in obj]
    if isinstance(obj, dict):
        return {k: to_jsonable(v) for k, v in obj.items()}
    # Anything else (a plain int, float, str, bool, or None) is
    # already JSON-safe as-is.
    return obj


# A lookup table mapping the class-name strings we stashed under
# "__type__" back to the actual class objects, so `from_jsonable`
# below knows which constructor to call.
_TYPES = {"Beat": Beat, "Section": Section, "NoteEvent": NoteEvent, "ChordEvent": ChordEvent}


def from_jsonable(obj):
    """The reverse of `to_jsonable`: turn plain JSON-loaded data back
    into our dataclass objects wherever a "__type__" tag says to.
    """
    if isinstance(obj, list):
        return [from_jsonable(v) for v in obj]
    if isinstance(obj, dict):
        type_name = obj.get("__type__")
        if type_name in _TYPES:
            # Drop the "__type__" marker itself, then pass every
            # remaining key/value pair as a keyword argument into the
            # matching dataclass's constructor -- e.g.
            # NoteEvent(pitch=60, start=0.0, end=0.5, velocity=90).
            fields = {k: v for k, v in obj.items() if k != "__type__"}
            return _TYPES[type_name](**fields)
        # A plain dictionary with no "__type__" tag (e.g. SongAnalysis
        # doesn't get one, since we never need to reload it as an
        # object) -- just recursively convert its values and leave it
        # as a dict.
        return {k: from_jsonable(v) for k, v in obj.items()}
    # A plain int/float/str/bool/None needs no further conversion.
    return obj
