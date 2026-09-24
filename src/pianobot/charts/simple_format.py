"""A simple, hand-writable JSON chart format -- the first of what can
be several importers (see the module docstring in charts/__init__.py);
every importer's job is just to produce a ``pianobot.types.Chart``, so
none of the rest of the chart-based path needs to know or care which
format a given chart originally came from.

Expected shape (see also examples/practice-changes.json for a full example)::

    {
      "title": "Song Title",
      "key": "Eb",
      "tempo": 96,
      "sections": [
        {"label": "A", "start_beat": 0, "end_beat": 32}
      ],
      "chords": [
        {"beat": 0, "duration_beats": 4, "chord": "Ebmaj7"},
        {"beat": 4, "duration_beats": 4, "chord": "Cm7"}
      ],
      "melody": [
        {"beat": 0, "duration_beats": 1, "pitch": "Eb4", "velocity": 90},
        {"beat": 1, "duration_beats": 1, "pitch": "G4"}
      ]
    }

Beginner note: all the "beat"/"duration_beats" fields are in **beats**
from the start of the song, not seconds -- see the docstring on
``pianobot.types.Chart`` for why. "velocity" (how hard a melody note is
struck, 0-127) is optional and defaults to 90 if you leave it out.
Chord symbols use ordinary lead-sheet shorthand ("Cm7", "F#dim", "G7",
"Bbsus4", ...), not Chordino's colon-based "C:min7" notation.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..theory import parse_chord_symbol, parse_note_name
from ..types import Chart, ChordEvent, NoteEvent, Section

_DEFAULT_VELOCITY = 90


def load_chart(path: Path) -> Chart:
    """Load a chart from a JSON file on disk."""
    return chart_from_dict(json.loads(Path(path).read_text()))


def chart_from_dict(data: dict) -> Chart:
    """Build a Chart from an already-parsed JSON dict (split out from
    ``load_chart`` so tests can build one in-memory without a file).
    """
    title = data.get("title", "Untitled")
    key = data["key"]
    tempo = float(data.get("tempo", 120.0))

    sections = [
        Section(
            start=float(s["start_beat"]),
            end=float(s["end_beat"]),
            label=s.get("label", ""),
            source_label=s.get("source_label", s.get("label", "")),
        )
        for s in data.get("sections", [])
    ]

    chords = []
    for c in data.get("chords", []):
        root_pc, quality = parse_chord_symbol(c["chord"])
        start = float(c["beat"])
        chords.append(ChordEvent(
            root_pitch_class=root_pc, quality=quality,
            start=start, end=start + float(c["duration_beats"]),
        ))

    melody = []
    for n in data.get("melody", []):
        pitch = n["pitch"]
        # Accept either a note name ("Eb4") or a raw MIDI number (63) --
        # whichever is easier to hand-write for a given note.
        pitch = parse_note_name(pitch) if isinstance(pitch, str) else int(pitch)
        start = float(n["beat"])
        melody.append(NoteEvent(
            pitch=pitch, start=start, end=start + float(n["duration_beats"]),
            velocity=int(n.get("velocity", _DEFAULT_VELOCITY)),
        ))

    return Chart(title=title, key=key, tempo=tempo, sections=sections, chords=chords, melody=melody)
