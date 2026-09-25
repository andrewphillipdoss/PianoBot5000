"""Procedurally build an 88-key piano keyboard in Blender (bpy), with
each key as its own object hinged for a press-down animation. Run with
the plain `bpy` PyPI package (headless, no Blender install needed):

    python3 build_piano.py

Saves piano.blend and a preview render (preview.png) next to this script.
"""

import math
import os

import bpy
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# --- Key dimensions (meters, roughly real-world proportions) ---------------
WHITE_W = 0.023
WHITE_L = 0.15
WHITE_H = 0.02
BLACK_W = 0.011
BLACK_L = 0.09
BLACK_H = 0.013
GAP = 0.0008  # small visual gap between adjacent white keys

# Standard 88-key piano: MIDI note 21 (A0) through 108 (C8).
FIRST_MIDI = 21
LAST_MIDI = 108

# Which pitch classes (0=C) are white/black, and a black key's horizontal
# offset from the *previous* white key's left edge, as a fraction of one
# white-key width -- the standard "2 black keys / 3 black keys" grouping
# pattern, approximated (this is a stylized model, not a precision replica).
WHITE_PITCH_CLASSES = {0, 2, 4, 5, 7, 9, 11}
BLACK_OFFSET_FRACTION = {1: 0.62, 3: 0.72, 6: 0.58, 8: 0.66, 10: 0.74}


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_material(name, color, roughness=0.15, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def add_key_object(name, width, length, height, material):
    """A box mesh, origin placed at the BACK edge, bottom face -- so
    rotating the object around its own local X axis pivots it exactly
    like a real key hinging down at the back.
    """
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (width / 2, length / 2, height / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Shift the mesh data so the object's origin sits at the back-bottom
    # edge (the hinge line) instead of the box's center.
    for v in obj.data.vertices:
        v.co.y += length / 2  # back edge -> local y=0
        v.co.z += height / 2  # bottom face -> local z=0
    obj.data.update()
    obj.data.materials.append(material)
    return obj


def build_keys():
    white_mat = make_material("WhiteKey", (0.95, 0.94, 0.90), roughness=0.25)
    black_mat = make_material("BlackKey", (0.02, 0.02, 0.02), roughness=0.2)

    keys = {}  # midi_note -> (object, rest_x_rotation placeholder unused, hinge info)
    white_index = 0

    for midi_note in range(FIRST_MIDI, LAST_MIDI + 1):
        pitch_class = midi_note % 12
        is_white = pitch_class in WHITE_PITCH_CLASSES

        if is_white:
            x = white_index * (WHITE_W + GAP)
            obj = add_key_object(f"key_{midi_note}_white", WHITE_W, WHITE_L, WHITE_H, white_mat)
            obj.location = (x, 0.0, 0.0)
            keys[midi_note] = obj
            white_index += 1
        else:
            # Black key sits above and slightly offset from the white key
            # just placed, at the front of the keybed (shorter, raised).
            prev_white_x = (white_index - 1) * (WHITE_W + GAP)
            frac = BLACK_OFFSET_FRACTION[pitch_class]
            x = prev_white_x + frac * WHITE_W - BLACK_W / 2
            obj = add_key_object(f"key_{midi_note}_black", BLACK_W, BLACK_L, BLACK_H, black_mat)
            obj.location = (x, WHITE_L - BLACK_L, WHITE_H)
            keys[midi_note] = obj

    return keys


def build_case(keys):
    xs = [k.location.x for k in keys.values()]
    min_x = min(xs) - WHITE_W
    max_x = max(xs) + WHITE_W * 2
    case_mat = make_material("Case", (0.08, 0.045, 0.03), roughness=0.3)

    bpy.ops.mesh.primitive_cube_add(size=1.0)
    case = bpy.context.active_object
    case.name = "case"
    width = max_x - min_x
    case_depth = 0.05
    case_height = 0.025
    case.scale = (width / 2, case_depth / 2, case_height / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # A slim rim just behind the black keys, its top edge a touch above
    # the white-key surface so it reads as a visible backdrop strip.
    case.location = (min_x + width / 2, WHITE_L - case_depth / 2 + 0.005, WHITE_H - case_height / 2 + 0.008)
    case.data.materials.append(case_mat)
    return case, (min_x, max_x)


def build_lighting_and_camera(x_range):
    min_x, max_x = x_range
    center_x = (min_x + max_x) / 2
    width = max_x - min_x

    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.03, 0.03, 0.04, 1.0)
    bg.inputs["Strength"].default_value = 1.0

    key_light_data = bpy.data.lights.new("KeyLight", type="AREA")
    key_light_data.energy = 25
    key_light_data.size = width * 0.6
    key_light = bpy.data.objects.new("KeyLight", key_light_data)
    key_light.location = (center_x - width * 0.15, -0.25, 0.5)
    key_light.rotation_euler = (math.radians(55), 0, math.radians(-15))
    bpy.context.collection.objects.link(key_light)

    fill_light_data = bpy.data.lights.new("FillLight", type="AREA")
    fill_light_data.energy = 8
    fill_light_data.size = width * 0.8
    fill_light = bpy.data.objects.new("FillLight", fill_light_data)
    fill_light.location = (center_x + width * 0.3, 0.4, 0.35)
    fill_light.rotation_euler = (math.radians(65), 0, math.radians(160))
    bpy.context.collection.objects.link(fill_light)

    # Look-at math instead of hand-picked euler angles: aim explicitly at
    # the center of the keybed from an elevated position, so the camera
    # is always correctly oriented regardless of where we place it --
    # removes an entire class of "which way is 0 degrees" mistakes.
    target = Vector((center_x, WHITE_L * 0.4, WHITE_H))
    elevation = math.radians(50)  # angle above the keybed plane
    distance = width * 0.62
    cam_pos = target + Vector((0, -distance * math.cos(elevation), distance * math.sin(elevation)))

    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 38
    cam = bpy.data.objects.new("Camera", cam_data)
    cam.location = cam_pos
    direction = (target - cam_pos).normalized()
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 600
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = os.path.join(SCRIPT_DIR, "preview.png")


def main():
    clear_scene()
    keys = build_keys()
    _, x_range = build_case(keys)
    build_lighting_and_camera(x_range)
    setup_render()

    blend_path = os.path.join(SCRIPT_DIR, "piano.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print(f"Saved {blend_path} with {len(keys)} keys.")

    bpy.ops.render.render(write_still=True)
    print(f"Rendered preview to {bpy.context.scene.render.filepath}")


if __name__ == "__main__":
    main()
