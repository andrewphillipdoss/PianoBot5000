import sys
import time

import bpy

blend_path, out_dir, start_frame, end_frame = sys.argv[-4:]
start_frame, end_frame = int(start_frame), int(end_frame)

bpy.ops.wm.open_mainfile(filepath=blend_path)
scene = bpy.context.scene
scene.eevee.taa_render_samples = 6
scene.render.resolution_x = 960
scene.render.resolution_y = 360
scene.render.image_settings.file_format = "PNG"

t0 = time.time()
for frame in range(start_frame, end_frame + 1):
    scene.frame_set(frame)
    scene.render.filepath = f"{out_dir}/frame_{frame:05d}.png"
    bpy.ops.render.render(write_still=True)
    if frame % 20 == 0:
        elapsed = time.time() - t0
        print(f"frame {frame}/{end_frame} -- {elapsed:.0f}s elapsed", flush=True)

print(f"done: {end_frame - start_frame + 1} frames in {time.time() - t0:.0f}s")
