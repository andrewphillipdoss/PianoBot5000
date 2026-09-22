"""Orchestrates the full song -> piano MIDI pipeline.

Mirrors the stages in the architecture diagram:
  stems -> {melody, chords, beats/sections} -> cleanup/voicing/labeling -> assemble MIDI

Each stage's output is cached as JSON under work_dir/analysis/ so you
can inspect (or hand-edit) intermediate results without re-running
upstream models.
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import numpy as np
import soundfile as sf

from . import assemble, chords, melody, stems, structure
from .types import Beat, ChordEvent, NoteEvent, Section, SongAnalysis


def run_pipeline(audio_path: Path, work_dir: Path, out_path: Path, tempo: float = 120.0) -> Path:
    audio_path = Path(audio_path)
    work_dir = Path(work_dir)
    analysis_dir = work_dir / "analysis"
    analysis_dir.mkdir(parents=True, exist_ok=True)

    stem_set = stems.separate_stems(audio_path, work_dir)

    beats, raw_sections = _cached(analysis_dir / "structure.json", lambda: structure.analyze_structure(audio_path))
    sections = structure.label_repeats(raw_sections)

    raw_melody = _cached(analysis_dir / "melody_raw.json", lambda: melody.extract_melody_notes(stem_set.vocals))
    clean_melody_notes = melody.clean_melody(raw_melody, beats)

    harmonic_mix = _write_harmonic_mix(stem_set, work_dir)
    raw_chords = _cached(analysis_dir / "chords_raw.json", lambda: chords.extract_chords(harmonic_mix))
    snapped_chords = chords.snap_chords_to_beats(raw_chords, beats)
    chord_notes = chords.voice_triads(snapped_chords)

    duration = _audio_duration(audio_path)
    analysis = SongAnalysis(
        duration=duration,
        beats=beats,
        sections=sections,
        melody_notes=clean_melody_notes,
        chords=snapped_chords,
    )
    _write_json(analysis_dir / "song_analysis.json", _to_jsonable(analysis))

    pm = assemble.assemble_midi(clean_melody_notes, chord_notes, sections, tempo=tempo)
    return assemble.write_midi(pm, out_path)


def _write_harmonic_mix(stem_set, work_dir: Path) -> Path:
    out_path = Path(work_dir) / "demucs" / "harmonic_mix.wav"
    if out_path.exists():
        return out_path
    sources = stem_set.harmonic_mix_sources()
    tracks = []
    sr = None
    for path in sources:
        data, this_sr = sf.read(str(path))
        sr = sr or this_sr
        tracks.append(data)
    min_len = min(len(t) for t in tracks)
    audio = np.sum([t[:min_len] for t in tracks], axis=0)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out_path), audio, sr)
    return out_path


def _audio_duration(audio_path: Path) -> float:
    info = sf.info(str(audio_path))
    return float(info.frames) / float(info.samplerate)


def _cached(path: Path, compute):
    if path.exists():
        return _from_jsonable(json.loads(path.read_text()))
    result = compute()
    _write_json(path, _to_jsonable(result))
    return result


def _write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2))


# --- minimal (de)serialization for the dataclasses in types.py ---

def _to_jsonable(obj):
    if dataclasses.is_dataclass(obj):
        return {"__type__": type(obj).__name__, **{k: _to_jsonable(v) for k, v in dataclasses.asdict(obj).items()}}
    if isinstance(obj, Path):
        return str(obj)
    if isinstance(obj, (list, tuple)):
        return [_to_jsonable(v) for v in obj]
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    return obj


_TYPES = {"Beat": Beat, "Section": Section, "NoteEvent": NoteEvent, "ChordEvent": ChordEvent}


def _from_jsonable(obj):
    if isinstance(obj, list):
        return [_from_jsonable(v) for v in obj]
    if isinstance(obj, dict):
        type_name = obj.get("__type__")
        if type_name in _TYPES:
            fields = {k: v for k, v in obj.items() if k != "__type__"}
            return _TYPES[type_name](**fields)
        return {k: _from_jsonable(v) for k, v in obj.items()}
    return obj
