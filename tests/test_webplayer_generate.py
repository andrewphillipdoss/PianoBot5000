"""Tests for webplayer/generate.py: MIDI -> note data, and safe
injection of that data into the HTML template.

Not part of the `pianobot` package itself (webplayer/ is a standalone
tool, not installed with the rest of the project), so it's imported
directly by file path.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pretty_midi
import pytest

_WEBPLAYER_DIR = Path(__file__).parent.parent / "webplayer"

spec = importlib.util.spec_from_file_location("webplayer_generate", _WEBPLAYER_DIR / "generate.py")
generate = importlib.util.module_from_spec(spec)
sys.modules["webplayer_generate"] = generate
spec.loader.exec_module(generate)


def _tiny_midi(tmp_path) -> Path:
    pm = pretty_midi.PrettyMIDI()
    melody = pretty_midi.Instrument(program=0, name="Melody (RH)")
    melody.notes.append(pretty_midi.Note(velocity=90, pitch=72, start=0.0, end=0.5))
    chords = pretty_midi.Instrument(program=0, name="Chords (LH)")
    chords.notes.append(pretty_midi.Note(velocity=75, pitch=48, start=0.0, end=1.0))
    chords.notes.append(pretty_midi.Note(velocity=75, pitch=52, start=0.0, end=1.0))
    pm.instruments.extend([melody, chords])
    path = tmp_path / "tiny.mid"
    pm.write(str(path))
    return path


def test_notes_from_midi_splits_by_hand(tmp_path):
    song = generate.notes_from_midi(_tiny_midi(tmp_path))
    hands = {n["hand"] for n in song["notes"]}
    assert hands == {"RH", "LH"}
    assert len(song["notes"]) == 3
    assert song["duration"] == pytest.approx(1.0)


def test_notes_from_midi_defaults_unlabeled_tracks_to_left_hand(tmp_path):
    pm = pretty_midi.PrettyMIDI()
    inst = pretty_midi.Instrument(program=0, name="Piano")  # no "melody" in the name
    inst.notes.append(pretty_midi.Note(velocity=90, pitch=60, start=0.0, end=0.5))
    pm.instruments.append(inst)
    path = tmp_path / "unlabeled.mid"
    pm.write(str(path))

    song = generate.notes_from_midi(path)
    assert song["notes"][0]["hand"] == "LH"


def test_build_html_injects_data_exactly_once():
    html = generate.build_html({"title": "Test", "duration": 1.0, "notes": []})
    assert '"title": "Test"' in html
    assert "__SONG_DATA__" not in html
    assert html.count("const SONG = ") == 1


def test_notes_are_sorted_by_start_time(tmp_path):
    pm = pretty_midi.PrettyMIDI()
    inst = pretty_midi.Instrument(program=0, name="Melody (RH)")
    inst.notes.append(pretty_midi.Note(velocity=90, pitch=64, start=1.0, end=1.5))
    inst.notes.append(pretty_midi.Note(velocity=90, pitch=60, start=0.0, end=0.5))
    pm.instruments.append(inst)
    path = tmp_path / "unsorted.mid"
    pm.write(str(path))

    song = generate.notes_from_midi(path)
    assert [n["start"] for n in song["notes"]] == [0.0, 1.0]
