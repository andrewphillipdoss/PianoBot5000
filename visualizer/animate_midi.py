"""Load piano.blend, read a MIDI file, and keyframe each pressed key's
hinge rotation to match the notes -- key goes down at a note's start,
stays down for its duration, comes back up shortly after it ends.

Usage:
    python3 animate_midi.py piano.blend song.mid piano_animated.blend [--fps 24]
"""

import argparse
import sys

import bpy
import pretty_midi

FIRST_MIDI = 21
LAST_MIDI = 108

REST_ROTATION = 0.0
PRESSED_ROTATION = -0.075  # radians, ~4.3 degrees -- a visible but not exaggerated dip
ATTACK_TIME = 0.035   # seconds from rest to fully pressed
RELEASE_TIME = 0.06   # seconds from fully pressed back to rest


def load_key_objects():
    """midi_note -> key object, built from whichever of piano.blend's
    key_<note>_white / key_<note>_black objects actually exists.
    """
    keys = {}
    for note in range(FIRST_MIDI, LAST_MIDI + 1):
        obj = bpy.data.objects.get(f"key_{note}_white") or bpy.data.objects.get(f"key_{note}_black")
        if obj is not None:
            keys[note] = obj
    return keys


def collect_note_events(midi_path):
    """All notes across every instrument in the file, as (pitch, start, end),
    sorted by start time. A physical key doesn't care which "voice" (RH
    melody vs LH chords) hit it.
    """
    pm = pretty_midi.PrettyMIDI(midi_path)
    events = [
        (note.pitch, note.start, note.end)
        for instrument in pm.instruments
        for note in instrument.notes
    ]
    events.sort(key=lambda e: e[1])
    return events


def merge_overlapping_same_key(events):
    """Group by pitch, then merge touching/overlapping notes on the same
    key into one continuous press interval -- a key can't be "half
    pressed" for two overlapping notes, it's just down for the whole span.
    """
    by_pitch = {}
    for pitch, start, end in events:
        by_pitch.setdefault(pitch, []).append((start, end))

    merged = {}
    for pitch, spans in by_pitch.items():
        spans.sort()
        out = [list(spans[0])]
        for start, end in spans[1:]:
            if start <= out[-1][1] + 1e-6:
                out[-1][1] = max(out[-1][1], end)
            else:
                out.append([start, end])
        merged[pitch] = out
    return merged


def _iter_fcurves(obj):
    if not (obj.animation_data and obj.animation_data.action):
        return
    action = obj.animation_data.action
    for layer in action.layers:
        for strip in layer.strips:
            for channelbag in strip.channelbags:
                yield from channelbag.fcurves


def animate(keys, merged_spans, fps):
    scene = bpy.context.scene
    scene.render.fps = fps
    scene.frame_start = 1

    max_end = 0.0
    for pitch, spans in merged_spans.items():
        obj = keys.get(pitch)
        if obj is None:
            print(f"warning: MIDI note {pitch} is outside the 88-key range built -- skipping", file=sys.stderr)
            continue

        # Start every key at rest on frame 1.
        obj.rotation_euler.x = REST_ROTATION
        obj.keyframe_insert("rotation_euler", index=0, frame=1)

        for start, end in spans:
            max_end = max(max_end, end)
            f_attack_start = 1 + start * fps
            f_attack_end = 1 + (start + ATTACK_TIME) * fps
            f_release_start = 1 + end * fps
            f_release_end = 1 + (end + RELEASE_TIME) * fps

            obj.rotation_euler.x = REST_ROTATION
            obj.keyframe_insert("rotation_euler", index=0, frame=f_attack_start)
            obj.rotation_euler.x = PRESSED_ROTATION
            obj.keyframe_insert("rotation_euler", index=0, frame=f_attack_end)
            obj.rotation_euler.x = PRESSED_ROTATION
            obj.keyframe_insert("rotation_euler", index=0, frame=f_release_start)
            obj.rotation_euler.x = REST_ROTATION
            obj.keyframe_insert("rotation_euler", index=0, frame=f_release_end)

        # Snap, not ease, so a key hits and releases crisply rather than
        # gliding down like a slow elevator. Blender 4.4+'s "layered
        # actions" moved f-curves down a few levels (Action -> layer ->
        # strip -> channelbag -> fcurves) from the old flat
        # Action.fcurves this used to be.
        for fcurve in _iter_fcurves(obj):
            if fcurve.data_path == "rotation_euler":
                for kp in fcurve.keyframe_points:
                    kp.interpolation = "SINE"

    scene.frame_end = int((max_end + 1.5) * fps)
    return scene.frame_end


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("blend_in")
    parser.add_argument("midi_path")
    parser.add_argument("blend_out")
    parser.add_argument("--fps", type=int, default=24)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])

    bpy.ops.wm.open_mainfile(filepath=args.blend_in)
    keys = load_key_objects()
    events = collect_note_events(args.midi_path)
    merged = merge_overlapping_same_key(events)
    last_frame = animate(keys, merged, args.fps)

    bpy.ops.wm.save_as_mainfile(filepath=args.blend_out)
    print(f"Saved {args.blend_out}: {len(events)} notes animated across {len(merged)} keys, "
          f"{last_frame} frames at {args.fps}fps ({last_frame / args.fps:.1f}s)")


if __name__ == "__main__":
    main()
