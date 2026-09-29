# -*- coding: utf-8 -*-
"""
BANCO DEL SHADER DE MOTAS: MS DE GPU E IMAGEN, ANTES Y DESPUES (28/9/2026)

    python nebula-dust-engine/bench/banco.py --antes RUTA/index.js [--motas 1,4,1000000,4000000]
           [--presets orion,supernovaExplosion] [--reps 10] [--tmp DIR] [--png DIR]

Por cada preset y numero de motas:
  1. node bench/volcar.mjs vuelca atributos, uniformes y el GLSL de three
     (el de ahora y el de --antes);
  2. se dibuja con moderngl en esta GPU a 1920x1080, en RGBA8 como el lienzo
     de la demo, con la mezcla del material;
  3. ms de GPU (GL_TIME_ELAPSED, --reps dibujos tras tres de calentamiento);
  4. diferencia contra el de antes (maximo de los tres canales, 0-255): media
     y percentil 99, a resolucion completa y a media resolucion reescalada;
  5. luz total (suma de lo que la nube suma al fondo) dibujando 1, 1/2, 1/4 y
     1/16 de las motas, relativa a todas.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
import moderngl
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
FONDO = (3, 3, 10)


def a_330(src):
    fuera = []
    for linea in src.split("\n"):
        t = linea.strip()
        if t.startswith("#version"):
            fuera.append("#version 330")
        elif t.startswith("precision "):
            continue
        else:
            fuera.append(linea)
    return "\n".join(fuera)


def volcar(tmp, preset, motas, antes):
    d = os.path.join(tmp, f"{preset}-{motas}")
    if not os.path.exists(os.path.join(d, "datos.json")):
        subprocess.run(["node", os.path.join(AQUI, "volcar.mjs"), d, preset, str(motas), "--antes", antes],
                       check=True, cwd=RAIZ, stdout=subprocess.DEVNULL)
    with open(os.path.join(d, "datos.json"), encoding="utf-8") as f:
        datos = json.load(f)
    arr = {k: np.fromfile(os.path.join(d, k + ".bin"), dtype="f4") for k in datos["atributos"]}
    return datos, arr


class Nube:
    def __init__(self, ctx, datos, arr, version):
        sh = datos["shaders"][version]
        self.ctx = ctx
        # El navegador (ANGLE) no dibuja puntos de menos de 1 px: los agranda a 1.
        # Esta GPU en GL nativo si (rango desde 0,125); se imita al navegador.
        vert = a_330(sh["vert"]).replace("void main()", "void mainOriginal()")
        vert += "\nvoid main() { mainOriginal(); gl_PointSize = max(gl_PointSize, 1.0); }\n"
        self.prog = ctx.program(vertex_shader=vert, fragment_shader=a_330(sh["frag"]))
        self.datos = datos
        self.bufs = []
        contenido = []
        for nombre, tam in datos["atributos"].items():
            if nombre not in self.prog:
                continue
            b = ctx.buffer(arr[nombre].tobytes())
            self.bufs.append(b)
            contenido.append((b, f"{tam}f", nombre))
        self.vao = ctx.vertex_array(self.prog, contenido)
        self.n = datos["motas"]
        self.pon("modelViewMatrix", datos["modelView"])
        self.pon("projectionMatrix", datos["projection"])
        for k, v in datos["uniformes"].items():
            self.pon(k, v)

    def pon(self, k, v):
        if k in self.prog:
            u = self.prog[k]
            if isinstance(v, list):
                u.write(np.array(v, dtype="f4").tobytes())
            else:
                u.value = float(v)

    def dibuja(self, cuantas=None):
        self.vao.render(moderngl.POINTS, vertices=self.n if cuantas is None else cuantas)


def lienzo(ctx, W, H):
    fbo = ctx.framebuffer(color_attachments=[ctx.texture((W, H), 4)])
    return fbo


def pinta(ctx, fbo, nube, blending, cuantas=None):
    fbo.use()
    ctx.viewport = (0, 0, fbo.width, fbo.height)
    fbo.clear(FONDO[0] / 255, FONDO[1] / 255, FONDO[2] / 255, 1.0)
    ctx.enable(moderngl.BLEND)
    if blending == "additive":
        ctx.blend_func = (moderngl.SRC_ALPHA, moderngl.ONE)
    else:
        ctx.blend_func = (moderngl.SRC_ALPHA, moderngl.ONE_MINUS_SRC_ALPHA, moderngl.ONE, moderngl.ONE_MINUS_SRC_ALPHA)
    nube.dibuja(cuantas)


def lee(fbo):
    raw = fbo.read(components=3)
    return np.frombuffer(raw, dtype=np.uint8).reshape(fbo.height, fbo.width, 3)[::-1].copy()


def mide(ctx, fn, reps):
    for _ in range(3):
        fn()
    ctx.finish()
    q = ctx.query(time=True)
    with q:
        for _ in range(reps):
            fn()
    ctx.finish()
    return q.elapsed / 1e6 / reps


def solo_polvo(fbo, ctx):
    """ms de lo mismo sin motas: el borrado del lienzo, para restarlo."""
    def f():
        fbo.use()
        fbo.clear(0, 0, 0, 1)
    return f


def dif(a, b):
    d = np.abs(a.astype(np.int16) - b.astype(np.int16)).max(axis=2)
    return float(d.mean()), float(np.percentile(d, 99))


def luz(img):
    return float(np.clip(img.astype(np.float64) - np.array(FONDO), 0, None).sum())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--antes", required=True)
    ap.add_argument("--motas", default="1,4,1000000,4000000")
    ap.add_argument("--presets", default="orion,supernovaExplosion")
    ap.add_argument("--reps", type=int, default=10)
    ap.add_argument("--tmp", default=os.path.join(tempfile.gettempdir(), "banco_polvo_motor"))
    ap.add_argument("--png", default="")
    ap.add_argument("--json", default="")
    ap.add_argument("--minpx", type=float, default=None, help="uMinPointPx en vez del del motor")
    ap.add_argument("--suelo", type=float, default=None, help="uCullFloor en vez del del motor")
    a = ap.parse_args()
    ctx = moderngl.create_standalone_context(require=330)
    ctx.enable(moderngl.PROGRAM_POINT_SIZE)
    print("GPU:", ctx.info["GL_RENDERER"], "· tamaño de punto", ctx.info.get("GL_POINT_SIZE_RANGE"))
    resultados = []
    for preset in a.presets.split(","):
        for motas in [int(x) for x in a.motas.split(",")]:
            datos, arr = volcar(a.tmp, preset, motas, os.path.abspath(a.antes))
            W, H = datos["W"], datos["H"]
            bl = datos["blending"]
            antes = Nube(ctx, datos, arr, "antes")
            desp = Nube(ctx, datos, arr, "despues")
            if a.minpx is not None:
                desp.pon("uMinPointPx", a.minpx)
            if a.suelo is not None:
                desp.pon("uCullFloor", a.suelo)
            full = lienzo(ctx, W, H)
            media = lienzo(ctx, W // 2, H // 2)
            base = mide(ctx, solo_polvo(full, ctx), a.reps)
            base_m = mide(ctx, solo_polvo(media, ctx), a.reps)
            ms_antes = mide(ctx, lambda: pinta(ctx, full, antes, bl), a.reps) - base
            ms_desp = mide(ctx, lambda: pinta(ctx, full, desp, bl), a.reps) - base
            pinta(ctx, full, antes, bl)
            img_antes = lee(full)
            pinta(ctx, full, desp, bl)
            img_desp = lee(full)
            # media resolucion: el mismo shader con el bufer a la mitad
            desp.pon("uHeightPx", H // 2)
            desp.pon("uResolutionScale", 0.5)
            ms_media = mide(ctx, lambda: pinta(ctx, media, desp, bl), a.reps) - base_m
            pinta(ctx, media, desp, bl)
            img_media = np.asarray(Image.fromarray(lee(media)).resize((W, H), Image.BILINEAR))
            desp.pon("uHeightPx", H)
            desp.pon("uResolutionScale", 1.0)
            # luz con 1, 1/2, 1/4, 1/16 de las motas (LOD por drawRange)
            luces = {}
            if motas >= 1000:
                ref = luz(img_desp)
                for den in (2, 4, 16):
                    n = max(1, round(motas / den))
                    pl = den ** 0.24
                    desp.pon("uLodPointScale", min(2.6, max(1.0, pl)))
                    desp.pon("uLodAlphaScale", motas / n)
                    pinta(ctx, full, desp, bl, n)
                    luces[f"1/{den}"] = round(luz(lee(full)) / max(ref, 1e-9), 4)
                    # la compensacion de antes con el shader de antes
                    antes.pon("uLodPointScale", min(2.6, max(1.0, pl)))
                    antes.pon("uLodAlphaScale", min(3.2, max(1.0, den ** 0.36)))
                    pinta(ctx, full, antes, bl, n)
                    luces[f"antes 1/{den}"] = round(luz(lee(full)) / max(luz(img_antes), 1e-9), 4)
                desp.pon("uLodPointScale", 1.0)
                desp.pon("uLodAlphaScale", 1.0)
                antes.pon("uLodPointScale", 1.0)
                antes.pon("uLodAlphaScale", 1.0)
            m, p99 = dif(img_antes, img_desp)
            mm, mp99 = dif(img_antes, img_media)
            fila = dict(preset=preset, motas=motas, blending=bl,
                        ms_antes=round(ms_antes, 3), ms_despues=round(ms_desp, 3), ms_media_res=round(ms_media, 3),
                        dif_media=round(m, 3), dif_p99=round(p99, 1),
                        dif_media_res_media=round(mm, 3), dif_media_res_p99=round(mp99, 1),
                        luz_despues_vs_antes=round(luz(img_desp) / max(luz(img_antes), 1e-9), 4),
                        luz_media_res_vs_antes=round(luz(img_media) / max(luz(img_antes), 1e-9), 4),
                        luz_lod=luces, errores_glsl=datos.get("erroresGlsl"))
            resultados.append(fila)
            print(json.dumps(fila, ensure_ascii=False))
            if a.png:
                os.makedirs(a.png, exist_ok=True)
                for nom, im in (("antes", img_antes), ("despues", img_desp), ("media", img_media)):
                    Image.fromarray(im).save(os.path.join(a.png, f"{preset}-{motas}-{nom}.png"))
            for x in (antes, desp):
                x.vao.release()
                for b in x.bufs:
                    b.release()
                x.prog.release()
            full.release()
            media.release()
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(resultados, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
