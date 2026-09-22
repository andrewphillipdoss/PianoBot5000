"""Chordino returns Harte-notation chord labels (e.g. "C:maj", "A:min7",
"N"). This parsing logic is pure and testable without the vamp host or
the Chordino plugin binary being installed.
"""

from __future__ import annotations

import pytest

from pianobot.chords import _parse_harte_label


@pytest.mark.parametrize(
    "label,expected_pc,expected_quality",
    [
        ("C:maj", 0, "maj"),
        ("A:min", 9, "min"),
        ("G:7", 7, "maj"),  # dominant 7th -> major triad
        ("D:min7", 2, "min"),
        ("F#:dim", 6, "dim"),
        ("Bb:aug", 10, "aug"),
        ("N", None, "N"),
        ("", None, "N"),
    ],
)
def test_parse_harte_label(label, expected_pc, expected_quality):
    pc, quality = _parse_harte_label(label)
    assert pc == expected_pc
    assert quality == expected_quality
