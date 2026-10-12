"""画像に宣伝用の文字（その屋根は、命がけ。／だんじり 大工方）を重ね、1200×675 で書き出す。

使い方（プロジェクト直下で）:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b --factory-startup -P blender/overlay_caption.py -- <入力画像> <出力画像> [tl|tr]

画像は 16:9 の枠いっぱいに収め（はみ出しは切る）、色は変換せずそのまま出す。
文字は左上（tl、既定）か右上（tr）に置く。
"""

import os
import sys

import bpy

FONT = r"C:\Windows\Fonts\BIZ-UDMinchoM.ttc"
W, H = 1200, 675


def emission_mat(name, color=None, image=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(em.outputs[0], out.inputs[0])
    if image:
        tx = nt.nodes.new("ShaderNodeTexImage")
        tx.image = image
        nt.links.new(tx.outputs[0], em.inputs[0])
    else:
        em.inputs[0].default_value = (*color, 1)
    return m


def srgb(hexstr):
    h = hexstr.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def main():
    args = sys.argv[sys.argv.index("--") + 1 :]
    src, dst = args[:2]
    dx = 7.1 if len(args) > 2 and args[2] == "tr" else 0.0  # 右上に置くときのずらし
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    img = bpy.data.images.load(os.path.abspath(src))
    iw, ih = img.size

    # 正投影カメラ: 横幅 16、縦 9 の範囲を写す
    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    cam.ortho_scale = 16
    co = bpy.data.objects.new("cam", cam)
    co.location = (0, 0, 10)
    scene.collection.objects.link(co)
    scene.camera = co

    # 画像の板（16:9 を覆うように拡大）
    scale = max(16 / iw, 9 / ih)
    bpy.ops.mesh.primitive_plane_add(size=1)
    plane = bpy.context.active_object
    plane.scale = (iw * scale, ih * scale, 1)
    plane.data.materials.append(emission_mat("photo", image=img))

    # 文字の下地と文字（左上）
    bpy.ops.mesh.primitive_plane_add(size=1, location=(-3.55 + dx, 3.0, 0.1))
    plate = bpy.context.active_object
    plate.scale = (8.4, 1.75, 1)
    pm = emission_mat("plate", color=srgb("#0b0b0e"))
    plate.data.materials.append(pm)
    font = bpy.data.fonts.load(FONT)
    for text, size, loc, color in (
        ("その屋根は、命がけ。", 0.74, (-7.5, 3.05), "#fbf3e2"),
        ("だんじり 大工方", 0.36, (-7.45, 2.35), "#e2b65a"),
    ):
        cu = bpy.data.curves.new(text, "FONT")
        cu.body = text
        cu.font = font
        cu.size = size
        to = bpy.data.objects.new(text, cu)
        to.location = (loc[0] + dx, loc[1], 0.2)
        to.data.materials.append(emission_mat(text, color=srgb(color)))
        scene.collection.objects.link(to)

    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x = W
    scene.render.resolution_y = H
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = os.path.abspath(dst)
    bpy.ops.render.render(write_still=True)
    print(f"[caption] {dst}")


main()
