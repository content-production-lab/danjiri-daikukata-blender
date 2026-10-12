"""X 宣伝用の画像（1200×675）を、ゲームと同じモデルでレンダリングする。

使い方（プロジェクト直下で）:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b --factory-startup -P blender/render_promo.py

構図: 大屋根に立つ大工方の背中越しに、左へ折れる角の家並みが迫る。地車は外へわずかに傾き、
曳き手は先に角を回っている。けが・転落など事故そのものは描かない。
"""

import math
import os
import random
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_all as B  # noqa: E402

OUT = os.path.join(B.ROOT, "promo", "x-post.png")


def place(scene, src, loc, rot_z=0.0, scale=(1, 1, 1)):
    ob = src.copy()
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    ob.scale = scale
    scene.collection.objects.link(ob)
    return ob


def main():
    B.reset()
    B.define_materials()
    scene = bpy.context.scene
    dj_col = B.new_collection("danjiri")
    people_col = B.new_collection("people")
    town_col = B.new_collection("town")
    B.build_danjiri(dj_col)
    for k in range(4):
        B.person(f"run{k}", people_col, phase=k / 4)
    B.person("stand", people_col, phase=None)
    B.build_town(town_col)
    for c in (dj_col, people_col, town_col):
        c.hide_render = True

    # 地面
    g = B.Builder("ground")
    g.box(400, 400, 0.1, Vector((0, 0, -0.05)), "wall_wood")
    ground = g.finish(scene.collection)
    ground.data.materials.clear()
    ground.data.materials.append(B.mat("asphalt_promo", B.srgb("#4d4d52"), 0.95))

    town = {o.name: o for o in town_col.all_objects}
    rnd = random.Random(12)
    kinds = ["machiya_a", "machiya_b", "machiya_c"]
    half = 5.5  # 道幅の半分
    back = half + 1.7 + 5.5  # 家の中心までの距離
    corner_x = 16.0
    # 手前の通り（X 方向）の両側。右側（-Y）は角を越えて続く
    for side in (1, -1):
        x = -50.0
        end = corner_x - half - 1.7 if side > 0 else corner_x + 30
        while x < end:
            w = rnd.uniform(5.5, 8.5)
            w = min(w, end - x)
            if w < 3:
                break
            place(scene, town[rnd.choice(kinds)], (x + w / 2, side * back, 0), 0, (w / 7, 1, rnd.uniform(0.95, 1.15)))
            x += w
    # 角の正面（突き当たり）の家並み
    y = -half - 1.7
    while y < 40:
        w = rnd.uniform(5.5, 8.5)
        place(scene, town[rnd.choice(kinds)], (corner_x + back, y + w / 2, 0), math.pi / 2, (w / 7, 1, rnd.uniform(0.95, 1.15)))
        y += w
    # 左へ折れる通りの奥側（角の内側の家は手前の列が受け持つ）
    y = half + 1.7
    while y < 60:
        w = rnd.uniform(5.5, 8.5)
        place(scene, town[rnd.choice(kinds)], (corner_x - back, y + 5.5 + w / 2, 0), math.pi / 2, (w / 7, 1, rnd.uniform(0.95, 1.15)))
        y += w
    # 角の外側の布団を巻いた電柱、手前の電柱と提灯
    place(scene, town["pole_padded"], (corner_x + half - 0.45, -half + 0.45, 0))
    for x in (-18, 4):
        place(scene, town["pole"], (x, half - 0.3, 0), math.pi / 2)
        place(scene, town["pole"], (x + 9, -half + 0.3, 0), math.pi / 2)
    # 提灯の列は、左へ折れた先の通りに渡す
    for k in range(-8, 9):
        place(scene, town["street_lantern"], (corner_x + k * 0.72, 16, 7.6 - (1 - (k / 8.5) ** 2) * 0.6))

    # 地車: 角の手前で左へ向きを変えはじめ、外（右）へ傾く
    dj = bpy.data.objects.new("dj_root", None)
    scene.collection.objects.link(dj)
    for ob in dj_col.all_objects:
        c = ob.copy()
        c.parent = dj
        scene.collection.objects.link(c)
    dj.location = (6.5, -0.8, 0)
    dj.rotation_euler = (0.07, 0, math.radians(18))  # 左へ曲がり、外（右）へ傾く
    rider = place(scene, people_col.all_objects["stand"], (0, 0, 0))
    rider.parent = dj
    rider.location = (B.RIDER_X - 0.15, 0, B.ROOF_TOP)
    rider.rotation_euler = (0, 0, math.pi / 2 + 0.35)
    rider.data = rider.data.copy()
    rider.data.materials[rider.data.materials.find("happi")] = B.mat("happi_rider", B.srgb("#1f3f8a"), 0.85)

    # 曳き手: 綱の先頭は先に角を回っている
    poses = [o for o in people_col.all_objects if o.name.startswith("run")]
    colors = [B.srgb(c) for c in ("#1f3f8a", "#1f3f8a", "#f2efe6", "#b8231d")]
    path = []
    for i in range(70):
        t = i * 0.6
        if t < 6:
            path.append((Vector((9.5 + t, -0.5, 0)), 0.0))
        else:
            a = min(math.pi / 2, (t - 6) / 7.5)
            r = 6.0
            cx, cy = 15.5, -0.5 + r
            p = Vector((cx + r * math.sin(a), cy - r * math.cos(a), 0)) if a < math.pi / 2 else Vector((cx + r, cy + (t - 6 - 7.5 * math.pi / 2), 0))
            path.append((p, a))
    for k, (p, a) in enumerate(path):
        for side in (1, -1):
            off = Vector((-math.sin(a), math.cos(a), 0)) * side * 0.65
            o = place(scene, poses[(k + (side > 0)) % 4], p + off, a + math.pi / 2)
            o.data = o.data.copy()
            o.data.materials[o.data.materials.find("happi")] = B.mat(f"happi_promo{(k + side) % 4}", colors[(k + side) % 4], 0.85)

    # 夕方の斜めの光
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*B.srgb("#a9c3e3"), 1)
    bg.inputs["Strength"].default_value = 0.8
    scene.world = world
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4.5
    sun.color = B.srgb("#ffd2a0")
    sun.angle = 0.03
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(68), math.radians(8), math.radians(150))
    scene.collection.objects.link(so)

    # カメラ: 大工方の背中越し
    cam = bpy.data.cameras.new("cam")
    cam.lens = 24
    co = bpy.data.objects.new("cam", cam)
    scene.collection.objects.link(co)
    bpy.context.view_layer.update()
    eye = dj.matrix_world @ Vector((B.RIDER_X - 4.2, -1.3, B.ROOF_TOP + 2.9))
    target = Vector((corner_x + 1, 2.0, 1.6))
    co.location = eye
    co.rotation_euler = (target - eye).to_track_quat("-Z", "Y").to_euler()
    co.rotation_euler.y += math.radians(-4)  # わずかに傾けて揺れを出す
    scene.camera = co

    # 文字（カメラに貼る）
    if os.path.exists(B.FONT):
        font = bpy.data.fonts.load(B.FONT)
        for text, size, loc, mname, color in (
            ("その屋根は、命がけ。", 0.045, (-0.34, 0.118), "promo_main", "#fbf3e2"),
            ("だんじり 大工方", 0.022, (-0.335, 0.077), "promo_sub", "#e2b65a"),
        ):
            cu = bpy.data.curves.new(text, "FONT")
            cu.body = text
            cu.font = font
            cu.size = size
            cu.extrude = 0.004
            to = bpy.data.objects.new(text, cu)
            to.data.materials.append(B.mat(mname, B.srgb(color), 0.4, emit=B.srgb(color)))
            scene.collection.objects.link(to)
            to.parent = co
            to.location = (loc[0], loc[1], -0.5)
        plate = B.Builder("plate")
        plate.box(0.52, 0.085, 0.001, Vector((-0.09, 0.107, -0.505)), "tabi")
        po = plate.finish(scene.collection)
        po.parent = co

    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 675
    scene.view_settings.view_transform = "AgX"
    for look in ("AgX - Punchy", "Punchy"):
        try:
            scene.view_settings.look = look
            break
        except TypeError:
            continue
    scene.render.image_settings.file_format = "PNG"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    scene.render.filepath = OUT
    bpy.ops.render.render(write_still=True)
    print(f"[promo] {OUT}")


main()
