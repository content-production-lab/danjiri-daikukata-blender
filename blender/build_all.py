"""地車・人・町並みのモデルを作り、glTF（.glb）と OGP 画像を書き出す。

使い方（プロジェクト直下で）:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b --factory-startup -P blender/build_all.py

座標: Blender は +X = 前、+Y = 左、+Z = 上。glTF 書き出しで three.js の +X = 前、+Z = 右、+Y = 上になる。
人は three.js の +Z（Blender の -Y）を向くように作る。
材質は名前で three.js 側のテクスチャと対応させる。Blender 側の色は OGP のレンダリング用。
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_MODELS = os.path.join(ROOT, "public", "models")
OUT_OG = os.path.join(ROOT, "public", "og.png")
FONT = r"C:\Windows\Fonts\BIZ-UDMinchoM.ttc"

# 既存版と同じ寸法（挙動計算と合わせる）
ROOF_TOP = 4.05
RIDER_X = 0.25

random.seed(20261012)


# ---------------------------------------------------------------- 基本


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()


MATS = {}


def mat(name, color, rough=0.6, metal=0.0, emit=None):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1.0)
        b.inputs["Emission Strength"].default_value = 1.5
    MATS[name] = m
    return m


def srgb(hexstr):
    h = hexstr.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def define_materials():
    mat("wood", srgb("#a8794a"), 0.6)
    mat("wood_dark", srgb("#5a3a22"), 0.7)
    mat("carving", srgb("#7a522c"), 0.75)
    mat("roof_wood", srgb("#b88d60"), 0.5)
    mat("brass", srgb("#c9a44a"), 0.3, 0.85)
    mat("iron", srgb("#2a2622"), 0.55, 0.5)
    mat("cloth_red", srgb("#b8231d"), 0.9)
    mat("lantern", srgb("#d63a22"), 0.6, emit=srgb("#ff6a2a"))
    mat("drum_skin", srgb("#e7dcc4"), 0.6)
    mat("happi", srgb("#ffffff"), 0.85)
    mat("skin", srgb("#c99a76"), 0.7)
    mat("pants", srgb("#23232b"), 0.9)
    mat("tabi", srgb("#141414"), 0.8)
    mat("band", srgb("#f4f1ea"), 0.8)
    mat("hair", srgb("#1a1714"), 0.7)
    mat("facade", srgb("#d9d2c3"), 0.85)
    mat("plaster", srgb("#e4dccb"), 0.9)
    mat("wall_wood", srgb("#3d2a1c"), 0.85)
    mat("tile", srgb("#3a3d44"), 0.6)
    mat("concrete", srgb("#8f8b84"), 0.8)
    mat("pad", srgb("#d14b3c"), 0.95)
    mat("torii_red", srgb("#c8361f"), 0.6)
    mat("torii_black", srgb("#1d1d1d"), 0.7)
    mat("shrine_wood", srgb("#6b4a30"), 0.8)
    mat("shrine_roof", srgb("#6f8a6a"), 0.6, 0.3)


class Builder:
    """1つのオブジェクト分のメッシュを bmesh に積み上げる。"""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        # 向きを自分で決めた開いた面（法線の再計算から外す）
        self.fixed = set()
        # 頂点ごとの陰影（彫りの凹みを暗くする）。無い頂点は白
        self.shade = {}

    def mi(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def _tag(self, verts, m, smooth=False):
        faces = {f for v in verts for f in v.link_faces}
        idx = self.mi(m)
        for f in faces:
            f.material_index = idx
            f.smooth = smooth
        return faces

    def box(self, sx, sy, sz, loc, m, rot=(0.0, 0.0, 0.0)):
        M = Matrix.Translation(loc) @ euler(rot) @ Matrix.Diagonal((sx, sy, sz, 1.0))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=M)
        self._tag(r["verts"], m)

    def cyl(self, r1, r2, depth, loc, m, rot=(0.0, 0.0, 0.0), segs=12, smooth=True, caps=True):
        M = Matrix.Translation(loc) @ euler(rot)
        r = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth, matrix=M)
        self._tag(r["verts"], m, smooth)

    def sphere(self, radius, loc, m, scale=(1.0, 1.0, 1.0), u=10, v=7):
        M = Matrix.Translation(loc) @ Matrix.Diagonal((*scale, 1.0))
        r = bmesh.ops.create_uvsphere(self.bm, u_segments=u, v_segments=v, radius=radius, matrix=M)
        self._tag(r["verts"], m, True)

    def lathe(self, profile, loc, m, segs=12, rot=(0.0, 0.0, 0.0)):
        """(半径, 高さ) の列を Z 軸まわりに回す。"""
        M = Matrix.Translation(loc) @ euler(rot)
        rings = []
        for rr, zz in profile:
            ring = []
            for k in range(segs):
                a = 2 * math.pi * k / segs
                ring.append(self.bm.verts.new(M @ Vector((rr * math.cos(a), rr * math.sin(a), zz))))
            rings.append(ring)
        verts = [v for ring in rings for v in ring]
        for i in range(len(rings) - 1):
            for k in range(segs):
                a, b = rings[i][k], rings[i][(k + 1) % segs]
                c, d = rings[i + 1][(k + 1) % segs], rings[i + 1][k]
                self.bm.faces.new((a, b, c, d))
        self.bm.faces.new(list(reversed(rings[0])))
        self.bm.faces.new(rings[-1])
        self._tag(verts, m, True)

    def sheet(self, fn, nu, nv, m, thickness=0.0, smooth=True, shade=None):
        """fn(u, v) -> Vector（u, v は 0..1）の面。thickness > 0 なら下へ厚みを付ける。shade(u, v) は 0..1 の陰影。"""
        top = [[self.bm.verts.new(fn(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
        if shade:
            for i in range(nu + 1):
                for j in range(nv + 1):
                    self.shade[top[i][j]] = shade(i / nu, j / nv)
        verts = [v for row in top for v in row]
        for i in range(nu):
            for j in range(nv):
                f = self.bm.faces.new((top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1]))
                if thickness <= 0:
                    self.fixed.add(f)
        if thickness > 0:
            bot = [[self.bm.verts.new(top[i][j].co - Vector((0, 0, thickness))) for j in range(nv + 1)] for i in range(nu + 1)]
            verts += [v for row in bot for v in row]
            for i in range(nu):
                for j in range(nv):
                    self.bm.faces.new((bot[i][j + 1], bot[i + 1][j + 1], bot[i + 1][j], bot[i][j]))
            edge = [(i, 0) for i in range(nu)] + [(nu, j) for j in range(nv)] + [(i, nv) for i in range(nu, 0, -1)] + [(0, j) for j in range(nv, 0, -1)]
            for k in range(len(edge)):
                i0, j0 = edge[k]
                i1, j1 = edge[(k + 1) % len(edge)]
                self.bm.faces.new((top[i1][j1], top[i0][j0], bot[i0][j0], bot[i1][j1]))
        self._tag(verts, m, smooth)

    def prism(self, outline, axis_pos, thickness, m, axis="x", smooth=False):
        """2D の輪郭を押し出す。axis='x' なら輪郭は (y, z) で、x 方向へ厚み。"""

        def P(a, b, t):
            if axis == "x":
                return Vector((t, a, b))
            if axis == "y":
                return Vector((a, t, b))
            return Vector((a, b, t))

        f0 = [self.bm.verts.new(P(a, b, axis_pos - thickness / 2)) for a, b in outline]
        f1 = [self.bm.verts.new(P(a, b, axis_pos + thickness / 2)) for a, b in outline]
        self.bm.faces.new(list(reversed(f0)))
        self.bm.faces.new(f1)
        n = len(outline)
        for k in range(n):
            self.bm.faces.new((f0[k], f0[(k + 1) % n], f1[(k + 1) % n], f1[k]))
        self._tag(f0 + f1, m, smooth)

    def band(self, pts, height, thick, m):
        """点列に沿った帯（断面は高さ×厚み）。点は帯の上端、法線は X 方向に厚み。"""
        tops_f, tops_b, bots_f, bots_b = [], [], [], []
        for p in pts:
            tops_f.append(self.bm.verts.new(p + Vector((thick / 2, 0, 0))))
            tops_b.append(self.bm.verts.new(p + Vector((-thick / 2, 0, 0))))
            bots_f.append(self.bm.verts.new(p + Vector((thick / 2, 0, -height))))
            bots_b.append(self.bm.verts.new(p + Vector((-thick / 2, 0, -height))))
        for k in range(len(pts) - 1):
            self.bm.faces.new((bots_f[k], bots_f[k + 1], tops_f[k + 1], tops_f[k]))
            self.bm.faces.new((tops_b[k], tops_b[k + 1], bots_b[k + 1], bots_b[k]))
            self.bm.faces.new((tops_f[k], tops_f[k + 1], tops_b[k + 1], tops_b[k]))
            self.bm.faces.new((bots_b[k], bots_b[k + 1], bots_f[k + 1], bots_f[k]))
        for e in (0, len(pts) - 1):
            q = [tops_f[e], tops_b[e], bots_b[e], bots_f[e]]
            self.bm.faces.new(q if e else list(reversed(q)))
        self._tag(tops_f + tops_b + bots_f + bots_b, m, True)

    def finish(self, collection, uv_scale=1.0):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=[f for f in bm.faces if f not in self.fixed])
        bm.normal_update()
        uv = bm.loops.layers.uv.verify()
        for f in bm.faces:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for loop in f.loops:
                c = loop.vert.co
                if ax == 0:
                    loop[uv].uv = (c.y * uv_scale, c.z * uv_scale)
                elif ax == 1:
                    loop[uv].uv = (c.x * uv_scale, c.z * uv_scale)
                else:
                    loop[uv].uv = (c.x * uv_scale, c.y * uv_scale)
        col = bm.loops.layers.color.new("Col")
        for f in bm.faces:
            for loop in f.loops:
                v = self.shade.get(loop.vert, 1.0)
                loop[col] = (v, v, v, 1.0)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        # glTF 書き出しで使われるよう、陰影の色を有効な色にする
        if "Col" in me.color_attributes:
            me.color_attributes.active_color = me.color_attributes["Col"]
            me.color_attributes.render_color_index = me.color_attributes.find("Col")
        bm.free()
        for name in self.mats:
            me.materials.append(MATS[name])
        ob = bpy.data.objects.new(self.name, me)
        collection.objects.link(ob)
        return ob


def euler(rot):
    return (Matrix.Rotation(rot[2], 4, "Z") @ Matrix.Rotation(rot[1], 4, "Y") @ Matrix.Rotation(rot[0], 4, "X"))


def empty(name, loc, collection):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    collection.objects.link(e)
    return e


def new_collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


# ---------------------------------------------------------------- 地車


def karahafu_z(x, y, x0, x1, hw, base, rise):
    """唐破風の屋根面の高さ。横断面は丸い起り、軒先と前後の端は反り上がる。"""
    u = min(1.0, abs(y) / hw)
    L = (x1 - x0) / 2
    xc = (x0 + x1) / 2
    w = abs(x - xc) / L
    return base + rise * (1 - u**1.6) + 0.14 * u**6 + 0.16 * w**5 * (0.6 + 0.4 * (1 - u))


def roof(b, x0, x1, hw, base, rise, m="roof_wood"):
    fn = lambda u, v: Vector((x0 + (x1 - x0) * u, -hw + 2 * hw * v, karahafu_z(x0 + (x1 - x0) * u, -hw + 2 * hw * v, x0, x1, hw, base, rise)))
    b.sheet(fn, 14, 26, m, thickness=0.09)
    # 屋根板の目地（前後方向の細い桟）
    for k in range(1, 10):
        y = -hw + 2 * hw * k / 10
        pts = [Vector((x0 + (x1 - x0) * i / 12, y, karahafu_z(x0 + (x1 - x0) * i / 12, y, x0, x1, hw, base, rise) + 0.012)) for i in range(13)]
        for i in range(12):
            a, c = pts[i], pts[i + 1]
            mid = (a + c) / 2
            d = c - a
            b.box(d.length, 0.025, 0.02, mid, "wood_dark", rot=(0, -math.atan2(d.z, d.x), 0))
    # 破風板（前後の端の弓なりの板）と金具
    for xe, s in ((x1, 1), (x0, -1)):
        pts = [Vector((xe + 0.03 * s, -hw + 2 * hw * j / 30, karahafu_z(xe, -hw + 2 * hw * j / 30, x0, x1, hw, base, rise) + 0.02)) for j in range(31)]
        b.band(pts, 0.2, 0.07, "wood")
        b.band([p + Vector((0.035 * s, 0, 0.012)) for p in pts], 0.04, 0.02, "brass")
    # 棟と鬼板
    ridge_z = base + rise
    b.box(x1 - x0, 0.16, 0.12, Vector(((x0 + x1) / 2, 0, ridge_z + 0.04)), "wood_dark")
    b.box(x1 - x0, 0.17, 0.03, Vector(((x0 + x1) / 2, 0, ridge_z + 0.11)), "brass")
    for xe in (x1, x0):
        outline = []
        for k in range(25):
            a = math.pi * k / 24
            r = 0.38 * (1 + 0.16 * math.sin(6 * a) ** 2)
            outline.append((r * math.cos(a), ridge_z + 0.02 + r * math.sin(a) * 0.9))
        b.prism(outline, xe, 0.09, "carving", axis="x")
        b.prism([(y * 0.55, ridge_z + 0.06 + (z - ridge_z - 0.02) * 0.5) for y, z in outline], xe + (0.05 if xe == x1 else -0.05), 0.03, "brass", axis="x")
    # 懸魚（破風の下の飾り）
    hz = karahafu_z(x1, 0, x0, x1, hw, base, rise) - 0.22
    outline = [(0.18 * math.cos(a), hz - 0.18 * abs(math.sin(a)) ** 0.7) for a in [math.pi * k / 16 for k in range(17)]]
    outline += [(0.0, hz + 0.02)]
    b.prism(outline, x1 + 0.02, 0.05, "brass", axis="x")


def relief(b, w, h, depth, M, seed, m="carving", nu=36, nv=18):
    """彫物のパネル。M はパネルの局所座標（u: 幅, v: 高さ, 法線 +z）から世界座標への行列。"""
    rnd = random.Random(seed)
    figures = [(rnd.uniform(0.12, 0.88), rnd.uniform(0.3, 0.7), rnd.uniform(0.07, 0.11), rnd.uniform(-0.4, 0.4)) for _ in range(5)]
    off = Vector((seed * 3.1, seed * 1.7, 0))

    def height(u, v):
        edge = min(u, 1 - u, v * 2, (1 - v) * 2)
        if edge < 0.04:
            return 0.0
        mask = min(1.0, (edge - 0.04) / 0.05)
        wave = 0.5 + 0.5 * math.sin(u * 34 + 3 * math.sin(v * 11))
        hh = 0.3 * min(1.0, max(0.0, (wave - 0.45) * 4))  # 波（段のある彫り）
        hh += 0.3 * max(0.0, noise.fractal(Vector((u * 9, v * 5, 0)) + off, 0.8, 2.0, 3))  # 雲・岩
        hh += 0.12 * noise.noise(Vector((u * 60, v * 30, 1)) + off)  # 細かな鑿（のみ）跡
        for fu, fv, fr, tilt in figures:  # 武者の群像（平らな面と切り立った縁）
            du = (u - fu) * w / h
            dv = v - fv
            body = math.exp(-((du + tilt * dv) ** 2) / (2 * (fr * 0.55) ** 2) - (dv**2) / (2 * (fr * 2.2) ** 2))
            head = math.exp(-((du + tilt * 0.35) ** 2 + (v - fv - fr * 3.2) ** 2) / (2 * (fr * 0.45) ** 2))
            hh = max(hh, 1.1 * min(1.0, max(0.0, (body - 0.3) * 3)), 1.0 * min(1.0, max(0.0, (head - 0.3) * 3)))
        return max(0.0, hh) * mask

    fn = lambda u, v: M @ Vector(((u - 0.5) * w, (v - 0.5) * h, depth * min(1.6, height(u, v))))
    b.sheet(fn, nu, nv, m, smooth=True, shade=lambda u, v: 0.36 + 0.64 * min(1.0, height(u, v) / 1.0))
    # 枠
    for (cx, cy, sx, sy) in ((0, h / 2, w, 0.05), (0, -h / 2, w, 0.05), (w / 2, 0, 0.05, h), (-w / 2, 0, 0.05, h)):
        p = M @ Vector((cx, cy, 0.02))
        rot = M.to_euler()
        b.box(sx, sy, 0.06, p, "wood_dark", rot=(rot.x, rot.y, rot.z))


def build_danjiri(col):
    b = Builder("body")
    # 台木・枠
    for y in (0.95, -0.95):
        b.box(4.3, 0.26, 0.28, Vector((0, y, 0.78)), "wood_dark")
    for x in (1.95, -1.95):
        b.box(0.3, 2.2, 0.26, Vector((x, 0, 0.78)), "wood_dark")
    # 後梃子（後ろへ長く出る梃子）
    b.box(2.6, 0.16, 0.16, Vector((-3.2, 0, 0.82)), "wood_dark")
    b.box(0.16, 1.6, 0.16, Vector((-4.45, 0, 0.82)), "wood_dark")
    # 土呂幕（下段の彫物）
    b.box(3.6, 2.24, 0.98, Vector((0, 0, 1.06)), "wood_dark")
    for s in (1, -1):
        M = Matrix.Translation((0, s * 1.13, 1.08)) @ Matrix.Rotation(-s * math.pi / 2, 4, "X")
        relief(b, 3.4, 0.82, 0.08, M, seed=1 + (s > 0), nu=64, nv=24)
    M = Matrix.Translation((1.81, 0, 1.08)) @ Matrix.Rotation(math.pi / 2, 4, "Y") @ Matrix.Rotation(math.pi / 2, 4, "Z")
    relief(b, 2.1, 0.82, 0.08, M, seed=3, nu=26, nv=20)
    # 土呂幕の上下の見切り（真鍮の帯）
    for z in (0.58, 1.56):
        b.box(3.66, 2.3, 0.05, Vector((0, 0, z)), "brass")
    # 縁・高欄
    b.box(3.9, 2.6, 0.08, Vector((0, 0, 1.6)), "wood")
    for y in (1.28, -1.28):
        b.cyl(0.035, 0.035, 3.8, Vector((0, y, 1.93)), "brass", rot=(0, math.pi / 2, 0), segs=8)
        for k in range(9):
            x = -1.8 + k * 0.45
            b.box(0.06, 0.06, 0.32, Vector((x, y, 1.78)), "wood")
            b.sphere(0.045, Vector((x, y, 1.97)), "brass", u=8, v=5)
    for x in (1.9, -1.9):
        b.cyl(0.035, 0.035, 2.56, Vector((x, 0, 1.93)), "brass", rot=(math.pi / 2, 0, 0), segs=8)
    # 柱と枡合（中段の彫物）
    for x in (1.25, -1.25):
        for y in (0.82, -0.82):
            b.box(0.2, 0.2, 1.5, Vector((x, y, 2.4)), "wood")
            b.box(0.26, 0.26, 0.1, Vector((x, y, 1.7)), "brass")
    for s in (1, -1):
        M = Matrix.Translation((0, s * 0.84, 2.45)) @ Matrix.Rotation(-s * math.pi / 2, 4, "X")
        relief(b, 2.3, 0.9, 0.08, M, seed=10 + (s > 0), nu=34, nv=16)
    M = Matrix.Translation((-1.3, 0, 2.45)) @ Matrix.Rotation(-math.pi / 2, 4, "Y") @ Matrix.Rotation(math.pi / 2, 4, "Z")
    relief(b, 1.5, 0.9, 0.08, M, seed=12, nu=20, nv=14)
    # 舞台の太鼓
    b.lathe([(0.0, -0.26), (0.3, -0.26), (0.34, -0.15), (0.36, 0.0), (0.34, 0.15), (0.3, 0.26), (0.0, 0.26)], Vector((0.3, 0, 2.05)), "wood_dark", segs=16, rot=(math.pi / 2, 0, 0))
    for s in (1, -1):
        b.cyl(0.31, 0.31, 0.02, Vector((0.3, s * 0.27, 2.05)), "drum_skin", rot=(math.pi / 2, 0, 0), segs=16)
    b.box(0.6, 0.7, 0.28, Vector((0.3, 0, 1.75)), "cloth_red")
    # 小屋根（前・低い）と大屋根（後ろ・高い）
    roof(b, 0.55, 2.2, 1.4, 2.88, 0.62)
    for x in (0.7, 2.0):
        for y in (1.0, -1.0):
            b.box(0.12, 0.12, 0.7, Vector((x, y, 2.6)), "wood")
    roof(b, -2.0, 0.9, 1.62, ROOF_TOP - 0.98, 0.98)
    for x in (0.6, -1.7):
        for y in (1.0, -1.0):
            b.box(0.16, 0.16, 0.95, Vector((x, y, 2.4)), "wood")
    # 組物（屋根を受ける斗栱）: 外へ張り出しながら3段に重ねる
    for (xa, xb, hw, z0) in ((-1.85, 0.75, 1.05, 2.86), (0.68, 2.02, 0.98, 2.45)):
        for tier in range(3):
            grow = tier * 0.1
            z = z0 + tier * 0.13
            n = int((xb - xa) / 0.22)
            for k in range(n + 1):
                x = xa + (xb - xa) * k / n
                for y in (hw + grow, -hw - grow):
                    b.box(0.13, 0.15 + grow * 0.5, 0.09, Vector((x, y, z)), "wood")
            m = int(2 * hw / 0.22)
            for k in range(m + 1):
                y = -hw + 2 * hw * k / m
                for x in (xb + grow, xa - grow):
                    b.box(0.15 + grow * 0.5, 0.13, 0.09, Vector((x, y, z)), "wood")
            b.box(xb - xa + 2 * grow + 0.2, 2 * (hw + grow) + 0.2, 0.04, Vector(((xa + xb) / 2, 0, z + 0.065)), "wood_dark")
    # 見送り（後ろの彫物）
    M = Matrix.Translation((-2.0, 0, 2.55)) @ Matrix.Rotation(-math.pi / 2, 4, "Y") @ Matrix.Rotation(math.pi / 2, 4, "Z")
    relief(b, 1.8, 1.0, 0.08, M, seed=20, nu=24, nv=14)
    # 提灯（軒下）
    for x, z in ((1.9, 2.72), (0.75, 2.98)):
        for y in (1.22, -1.22):
            b.lathe([(0.0, -0.19), (0.07, -0.19), (0.13, -0.12), (0.15, 0.0), (0.13, 0.12), (0.07, 0.19), (0.0, 0.19)], Vector((x, y, z)), "lantern", segs=12)
            b.cyl(0.07, 0.07, 0.04, Vector((x, y, z + 0.2)), "tabi", segs=10)
            b.cyl(0.07, 0.07, 0.04, Vector((x, y, z - 0.2)), "tabi", segs=10)
    # 綱の付け根
    for y in (0.55, -0.55):
        b.cyl(0.07, 0.07, 0.12, Vector((2.12, y, 0.82)), "iron", rot=(0, math.pi / 2, 0), segs=10)
    body = b.finish(col)

    # 車輪（木の輪に鉄の帯）
    for name, x, y in (("wheel_FL", 0.85, 0.98), ("wheel_FR", 0.85, -0.98), ("wheel_RL", -0.85, 0.98), ("wheel_RR", -0.85, -0.98)):
        w = Builder(name)
        w.cyl(0.43, 0.43, 0.16, Vector((0, 0, 0)), "iron", rot=(math.pi / 2, 0, 0), segs=24)
        w.cyl(0.395, 0.395, 0.22, Vector((0, 0, 0)), "wood_dark", rot=(math.pi / 2, 0, 0), segs=24)
        w.cyl(0.11, 0.11, 0.27, Vector((0, 0, 0)), "iron", rot=(math.pi / 2, 0, 0), segs=12)
        for k in range(8):
            a = k * math.pi / 4
            for sy in (0.115, -0.115):
                w.cyl(0.025, 0.025, 0.02, Vector((math.cos(a) * 0.36, sy, math.sin(a) * 0.36)), "iron", rot=(math.pi / 2, 0, 0), segs=6)
        ob = w.finish(col)
        ob.location = (x, y, 0.43)

    # three.js 側で使う目印
    empty("rider_anchor", (RIDER_X, 0, ROOF_TOP), col)
    # 相方は大屋根の後ろ寄りに立つ（一人称の視界をふさがない）
    empty("partner_anchor", (-1.35, 0.55, ROOF_TOP - 0.12), col)
    empty("rope_L", (2.2, 0.55, 0.82), col)
    empty("rope_R", (2.2, -0.55, 0.82), col)
    return body


# ---------------------------------------------------------------- 人


def limb(b, a, c, r1, r2, m, segs=7):
    segs = max(4, segs)
    d = c - a
    L = d.length
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
    b.cyl(r1, r2, L, (a + c) / 2, m, rot=(rot.x, rot.y, rot.z), segs=segs)


def person(name, col, phase=None, lo=False):
    """phase=None は立ち姿勢。0..1 は走りの位相。正面は -Y（three.js の +Z）。lo=True は遠景用の簡易形。"""
    b = Builder(name)
    seg = 4 if lo else 7
    if phase is None:
        swing, knee_l, knee_r, bob, lean = 0.0, 0.05, 0.05, 0.0, 0.0
    else:
        t = 2 * math.pi * phase
        swing = 0.55 * math.sin(t)
        knee_l = 0.15 + 0.75 * max(0.0, math.sin(t + math.pi / 2))
        knee_r = 0.15 + 0.75 * max(0.0, math.sin(t - math.pi / 2))
        bob = 0.04 * abs(math.cos(t))
        lean = 0.12
    hip_z = 0.92 + bob
    F = Vector((0, -1, 0))  # 正面
    for side, hip_a, knee in ((1, swing, knee_l), (-1, -swing, knee_r)):
        hip = Vector((side * 0.1, 0, hip_z))
        thigh_dir = Vector((0, -math.sin(hip_a), -math.cos(hip_a)))
        knee_p = hip + thigh_dir * 0.44
        shin_a = hip_a - knee
        foot = knee_p + Vector((0, -math.sin(shin_a), -math.cos(shin_a))) * 0.44
        limb(b, hip, knee_p, 0.085, 0.07, "pants", segs=seg)
        limb(b, knee_p, foot, 0.068, 0.055, "pants", segs=seg)
        if not lo:
            b.box(0.1, 0.24, 0.07, foot + F * 0.06 + Vector((0, 0, -0.01)), "tabi")
    # 胴（法被）: 裾が少し広がる
    torso_base = Vector((0, 0, hip_z - 0.06))
    tilt = Matrix.Rotation(-lean, 4, "X")
    prof = [(0.0, 0.0), (0.21, 0.0), (0.2, 0.18), (0.19, 0.42), (0.17, 0.6), (0.09, 0.66), (0.0, 0.66)]
    if lo:
        prof = [prof[0], prof[1], prof[3], prof[5], prof[6]]
    b.lathe(prof, torso_base, "happi", segs=6 if lo else 10, rot=(-lean, 0, 0))
    neck = torso_base + tilt @ Vector((0, 0, 0.66))
    head = neck + tilt @ Vector((0, 0, 0.19))
    if lo:
        b.sphere(0.11, head, "skin", scale=(0.95, 1.0, 1.12), u=6, v=4)
        b.cyl(0.118, 0.118, 0.05, head + Vector((0, 0, 0.05)), "band", segs=6, caps=False)
    else:
        b.cyl(0.215, 0.215, 0.07, torso_base + tilt @ Vector((0, 0, 0.14)), "pants", rot=(-lean, 0, 0), segs=10)  # 帯
        b.cyl(0.05, 0.05, 0.1, neck + Vector((0, 0, 0.03)), "skin", segs=6)
        b.sphere(0.11, head, "skin", scale=(0.95, 1.0, 1.12), u=10, v=7)
        b.sphere(0.112, head + Vector((0, 0.012, 0.035)), "hair", scale=(0.97, 1.0, 0.95), u=10, v=5)
        b.cyl(0.118, 0.118, 0.04, head + Vector((0, 0, 0.05)), "band", segs=10)
    # 腕: 袖は太い法被、前腕は素肌
    for side, a in ((1, -swing), (-1, swing)):
        shoulder = torso_base + tilt @ Vector((side * 0.22, 0, 0.58))
        elbow = shoulder + Vector((side * 0.04, -math.sin(a) * 0.28, -math.cos(a) * 0.28))
        bend = 0.9 if phase is not None else 0.2
        hand = elbow + Vector((0, -math.sin(a + bend) * 0.26, -math.cos(a + bend) * 0.26))
        limb(b, shoulder, elbow, 0.085, 0.09, "happi", segs=seg)
        limb(b, elbow, hand, 0.045, 0.04, "skin", segs=seg - 1)
        if not lo:
            b.sphere(0.045, hand, "skin", u=6, v=4)
    return b.finish(col)


# ---------------------------------------------------------------- 町


def gable(b, x0, x1, hw, base, rise, overhang, m, ridge_m):
    """切妻屋根（棟は X 方向）。"""
    W = hw + overhang
    for s in (1, -1):
        a = Vector((0, s * W, base - overhang * rise / hw))
        c = Vector((0, 0, base + rise))
        d = c - a
        L = d.length
        mid = (a + c) / 2
        ang = math.atan2(d.z, abs(d.y))
        b.box(x1 - x0 + 2 * overhang, L, 0.12, Vector(((x0 + x1) / 2, mid.y, mid.z)), m, rot=(s * ang, 0, 0))
    b.box(x1 - x0 + 2 * overhang, 0.3, 0.22, Vector(((x0 + x1) / 2, 0, base + rise + 0.05)), ridge_m)
    # 妻壁
    for xe in (x0, x1):
        b.prism([(-hw, base), (hw, base), (0, base + rise)], xe, 0.1, "plaster", axis="x")


def machiya(name, col, kind):
    """町家（名目の寸法: 間口 7m・奥行 11m・高さ 7m）。正面は ±Y（通りに面する）。"""
    b = Builder(name)
    W, D, H = 7.0, 11.0, 7.0
    h1 = 3.2  # 1階の高さ
    b.box(W, D, h1, Vector((0, 0, h1 / 2)), "wall_wood")
    upper = H - h1 - (0.6 if kind == "b" else 0.0)
    b.box(W, D - 0.3, upper, Vector((0, 0, h1 + upper / 2)), "facade")
    top = h1 + upper
    # 1階の格子（正面・背面）
    for s in (1, -1):
        for k in range(22):
            x = -W / 2 + 0.2 + k * (W - 0.4) / 21
            b.box(0.045, 0.06, 2.1, Vector((x, s * (D / 2 + 0.04), 1.25)), "wood", rot=(0, 0, 0))
        b.box(W, 0.1, 0.12, Vector((0, s * (D / 2 + 0.05), 2.32)), "wood")
        # 庇
        b.box(W + 0.3, 1.0, 0.08, Vector((0, s * (D / 2 + 0.4), h1 + 0.12)), "tile", rot=(s * -0.32, 0, 0))
        # 2階の虫籠窓
        n_win = 2 if kind == "b" else 3
        for k in range(n_win):
            x = (k - (n_win - 1) / 2) * (W / n_win)
            b.box(1.3, 0.12, 0.8, Vector((x, s * (D / 2 - 0.1), h1 + upper * 0.55)), "wall_wood")
            for j in range(5):
                b.box(0.05, 0.14, 0.78, Vector((x - 0.5 + j * 0.25, s * (D / 2 - 0.08), h1 + upper * 0.55)), "plaster")
        if kind == "c":
            # 2階の手すり
            b.box(W - 0.6, 0.08, 0.06, Vector((0, s * (D / 2 + 0.25), h1 + 0.95)), "wood")
            for k in range(12):
                b.box(0.05, 0.05, 0.6, Vector((-W / 2 + 0.5 + k * (W - 1) / 11, s * (D / 2 + 0.25), h1 + 0.65)), "wood")
    gable(b, -W / 2, W / 2, D / 2, top, 2.0, 0.55, "tile", "tile")
    if kind == "b":
        # 卯建（うだつ）
        for xe in (-W / 2 - 0.15, W / 2 + 0.15):
            b.box(0.3, 3.0, 1.6, Vector((xe, 0, top + 0.5)), "plaster")
            b.box(0.45, 3.2, 0.15, Vector((xe, 0, top + 1.35)), "tile")
    return b.finish(col)


def build_town(col):
    for k in ("a", "b", "c"):
        machiya("machiya_" + k, col, k)
    p = Builder("pole")
    p.cyl(0.18, 0.14, 10.0, Vector((0, 0, 5.0)), "concrete", segs=10)
    p.box(1.4, 0.1, 0.1, Vector((0, 0, 9.2)), "concrete")
    for x in (-0.55, 0.0, 0.55):
        p.lathe([(0.0, 0.0), (0.06, 0.0), (0.05, 0.08), (0.06, 0.12), (0.0, 0.16)], Vector((x, 0, 9.25)), "band", segs=8)
    p.box(0.5, 0.3, 0.4, Vector((0, 0.25, 7.4)), "concrete")  # 変圧器の代わり
    p.finish(col)
    q = Builder("pole_padded")
    q.cyl(0.18, 0.14, 10.0, Vector((0, 0, 5.0)), "concrete", segs=10)
    q.cyl(0.38, 0.38, 2.6, Vector((0, 0, 1.4)), "pad", segs=14)
    for z in (0.5, 1.4, 2.3):
        q.cyl(0.39, 0.39, 0.08, Vector((0, 0, z)), "band", segs=14)
    q.finish(col)
    c = Builder("street_lantern")
    c.lathe([(0.0, -0.3), (0.1, -0.3), (0.2, -0.18), (0.23, 0.0), (0.2, 0.18), (0.1, 0.3), (0.0, 0.3)], Vector((0, 0, 0)), "lantern", segs=10)
    c.cyl(0.1, 0.1, 0.06, Vector((0, 0, 0.32)), "tabi", segs=8)
    c.cyl(0.1, 0.1, 0.06, Vector((0, 0, -0.32)), "tabi", segs=8)
    c.finish(col)
    # 鳥居（明神鳥居。通り方向 = X）
    t = Builder("torii")
    for y in (4.2, -4.2):
        t.cyl(0.36, 0.3, 8.0, Vector((0, y, 4.0)), "torii_red", segs=16)
        t.cyl(0.45, 0.45, 0.5, Vector((0, y, 0.25)), "torii_black", segs=16)
    t.box(0.42, 10.4, 0.42, Vector((0, 0, 6.6)), "torii_red")
    t.sheet(lambda u, v: Vector((-0.4 + 0.8 * v, -6.0 + 12.0 * u, 8.0 + 0.5 * (2 * u - 1) ** 4)), 16, 1, "torii_black", thickness=0.45, smooth=True)
    t.box(0.25, 0.6, 1.2, Vector((0, 0, 7.4)), "torii_black")
    t.finish(col)
    # 社殿
    s = Builder("shrine")
    s.box(10, 14, 0.8, Vector((0, 0, 0.4)), "concrete")
    s.box(9, 12, 5.0, Vector((0, 0, 3.3)), "shrine_wood")
    for x in (-4.5, 4.5):
        for k in range(5):
            s.cyl(0.25, 0.25, 5.0, Vector((x, -6 + k * 3, 3.3)), "torii_red", segs=10)
    s.sheet(lambda u, v: Vector((-6.5 + 13 * u, -8.5 + 17 * v, 5.8 + 3.4 * (1 - abs(2 * v - 1) ** 1.3) + 0.5 * abs(2 * v - 1) ** 6)), 10, 24, "shrine_roof", thickness=0.3)
    s.box(13.2, 0.5, 0.5, Vector((0, 0, 9.25)), "shrine_roof")
    s.finish(col)


# ---------------------------------------------------------------- 書き出し


def export(col, filename):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in col.all_objects:
        ob.select_set(True)
    os.makedirs(OUT_MODELS, exist_ok=True)
    path = os.path.join(OUT_MODELS, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_vertex_color="ACTIVE",
    )
    print(f"[build] {filename}: {os.path.getsize(path) / 1024:.0f} KB")


def tri_count(col):
    n = 0
    for ob in col.all_objects:
        if ob.type == "MESH":
            n += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return n


def render_og(dj_col, people_col, town_col):
    """OGP 画像（1200×630）: 角を曲がる地車を低い位置から見上げる。"""
    scene = bpy.context.scene
    # 書き出し用の元の部品は描画しない（複製だけを写す）
    for c in (dj_col, people_col, town_col):
        c.hide_render = True
    # 地面
    g = Builder("ground")
    g.box(400, 400, 0.1, Vector((0, 0, -0.05)), "wall_wood")
    gm = mat("asphalt_og", srgb("#55555a"), 0.95)
    g.mats = ["asphalt_og"]
    ground = g.finish(scene.collection)
    ground.data.materials.clear()
    ground.data.materials.append(gm)

    def place(src, loc, rot_z=0.0, scale=(1, 1, 1)):
        ob = src.copy()
        ob.location = loc
        ob.rotation_euler = (0, 0, rot_z)
        ob.scale = scale
        scene.collection.objects.link(ob)
        return ob

    town = {o.name: o for o in town_col.all_objects}
    rnd = random.Random(5)
    # 通りの両側の家並み（通り = X 方向、道幅 11m）
    for side in (1, -1):
        x = -60.0
        while x < 60:
            w = rnd.uniform(5.5, 9.0)
            kind = rnd.choice(["machiya_a", "machiya_b", "machiya_c"])
            place(town[kind], (x + w / 2, side * (5.5 + 1.7 + 5.5), 0), 0, (w / 7, 1, rnd.uniform(0.9, 1.15)))
            x += w
    for x in (-24, 4, 32):
        place(town["pole"], (x, 5.2, 0))
        place(town["pole"], (x + 10, -5.2, 0))
    for k in range(-8, 9):
        place(town["street_lantern"], (14, k * 0.75, 6.4 - (1 - (k / 8.5) ** 2) * 0.6))
    # 地車（少し斜めに構え、片輪がわずかに浮く）
    dj = bpy.data.objects.new("dj_root", None)
    scene.collection.objects.link(dj)
    for ob in dj_col.all_objects:
        c = ob.copy()
        c.parent = dj
        scene.collection.objects.link(c)
    dj.location = (0, 0.6, 0)
    dj.rotation_euler = (0.035, 0, 0.38)
    # 人: 綱の曳き手と大工方
    pose = [o for o in people_col.all_objects if o.name.startswith("run")]  # 遠景用 stand_lo は使わない
    stand = people_col.all_objects["stand"]
    happi_colors = [srgb(c) for c in ("#1f3f8a", "#1f3f8a", "#f2efe6", "#b8231d")]
    for k in range(40):
        side = 1 if k % 2 else -1
        d = 4.0 + (k // 2) * 0.9
        a = 0.38 + 0.02 * (k // 2)
        x = 2.2 + math.cos(a) * d
        y = 0.6 + math.sin(a) * d + side * 0.7
        o = place(pose[k % 4], (x, y, 0), math.pi / 2 + a + math.pi)
        hm = mat(f"happi_og{k % 4}", happi_colors[k % 4], 0.85)
        o.data = o.data.copy()
        o.data.materials[o.data.materials.find("happi")] = hm
    rider = place(stand, (0, 0, 0))
    rider.parent = dj
    rider.location = (RIDER_X, 0, ROOF_TOP)
    rider.rotation_euler = (0, 0, math.pi / 2)
    # 光と空
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*srgb("#9cc2e8"), 1)
    bg.inputs["Strength"].default_value = 0.9
    scene.world = world
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4.0
    sun.angle = 0.05
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    scene.collection.objects.link(so)
    # カメラ（低い位置から見上げる）
    cam = bpy.data.cameras.new("cam")
    cam.lens = 24
    co = bpy.data.objects.new("cam", cam)
    co.location = (9.5, -4.6, 1.35)
    scene.collection.objects.link(co)
    target = Vector((0.4, 0.6, 2.7))
    co.rotation_euler = (target - co.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = co
    # 題字
    if os.path.exists(FONT):
        font = bpy.data.fonts.load(FONT)
        for text, size, loc, mname, color in (
            ("だんじり", 0.3, (0.0, 0.8), "title_white", "#f7f1e3"),
            ("大工方", 0.56, (0.0, 0.22), "title_red", "#e0452c"),
        ):
            cu = bpy.data.curves.new(text, "FONT")
            cu.body = text
            cu.font = font
            cu.size = size
            cu.extrude = 0.02
            to = bpy.data.objects.new(text, cu)
            to.data.materials.append(mat(mname, srgb(color), 0.4, emit=srgb(color)))
            scene.collection.objects.link(to)
            to.parent = co
            to.location = (-2.05 + loc[0], loc[1], -3.0)
        # 題字の下地
        plate = Builder("plate")
        plate.box(1.95, 1.0, 0.01, Vector((-1.22, 0.6, -3.05)), "tabi")
        po = plate.finish(scene.collection)
        po.parent = co
    # レンダリング
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = 48
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 630
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in scene.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = OUT_OG
    bpy.ops.render.render(write_still=True)
    print(f"[build] og.png ({scene.render.engine})")


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    reset()
    define_materials()
    dj_col = new_collection("danjiri")
    people_col = new_collection("people")
    town_col = new_collection("town")
    build_danjiri(dj_col)
    for k in range(4):
        person(f"run{k}", people_col, phase=k / 4)
    person("stand", people_col, phase=None)
    person("stand_lo", people_col, phase=None, lo=True)
    build_town(town_col)
    for col, fn in ((dj_col, "danjiri.glb"), (people_col, "people.glb"), (town_col, "town.glb")):
        print(f"[build] {col.name}: {tri_count(col)} tris")
        export(col, fn)
    if "--no-og" not in argv:
        render_og(dj_col, people_col, town_col)


if __name__ == "__main__":
    main()
