"""Generate a self-contained "falling notes" HTML player (Neothesia-style:
a note highway scrolling down onto a 2D keyboard) from any MIDI file --
in particular, whatever `pianobot chart`/`pianobot transcribe` produces.

    python3 generate.py song.mid -o falling_notes.html [--title "My Song"]

The output is one plain .html file with the note data embedded directly
in it (no server, no build step) -- open it in a browser, or publish it
wherever an artifact/static page can go. Every note from every
instrument track is included; which hand a note is drawn as follows
this project's own convention (an instrument named "Melody..." is RH,
anything else is LH) with a safe fallback for MIDI files that don't
use that naming at all.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pretty_midi

_TEMPLATE_PATH = Path(__file__).parent / "template.html"


def notes_from_midi(midi_path: Path) -> dict:
    pm = pretty_midi.PrettyMIDI(str(midi_path))
    notes = []
    for instrument in pm.instruments:
        hand = "RH" if "melody" in instrument.name.lower() else "LH"
        for note in instrument.notes:
            notes.append({
                "pitch": note.pitch,
                "start": round(note.start, 3),
                "end": round(note.end, 3),
                "hand": hand,
            })
    notes.sort(key=lambda n: n["start"])
    return {"notes": notes, "duration": pm.get_end_time()}


def build_html(song: dict) -> str:
    template = _TEMPLATE_PATH.read_text()
    song_json = json.dumps(song)
    html, count = re.subn(r"__SONG_DATA__", lambda _: song_json, template, count=1)
    if count != 1:
        raise RuntimeError(f"expected exactly one __SONG_DATA__ placeholder in {_TEMPLATE_PATH}, found {count}")
    return html


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("midi_path", type=Path)
    parser.add_argument("-o", "--output", type=Path, default=None, help="Output HTML path (default: <midi-stem>.html)")
    parser.add_argument("--title", default=None, help="Song title shown in the player (default: the MIDI file's stem)")
    args = parser.parse_args()

    song = notes_from_midi(args.midi_path)
    song["title"] = args.title or args.midi_path.stem

    output = args.output or args.midi_path.with_suffix(".html")
    output.write_text(build_html(song))
    print(f"Wrote {output}: {len(song['notes'])} notes, {song['duration']:.1f}s")


if __name__ == "__main__":
    main()
