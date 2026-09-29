# -*- coding: utf-8 -*-
"""
CAPTURAS DE LAS ESCENAS DE EJEMPLO SIN NAVEGADOR

    python bench/capturas.py [--escenas twinNebula,collision,diskRingHalo] [--motas 262144]
                             [--salida media] [--w 1280 --h 720]

Vuelca cada escena con bench/escena.mjs y la dibuja con moderngl como la demo:
cada grupo con su shader real, en su orden de dibujo y con su mezcla, en un
búfer HalfFloat, y una pasada de salida con la exposición de la demo + ACES +
sRGB (la de bench/lienzo8.py). Guarda un PNG por escena y dice cuántos
píxeles se han encendido (una captura negra sale con código 1).
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import banco  # noqa: E402
from lienzo8 import QUAD_V, QUAD_F, EXPOSICION, srgb_a_lineal  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
MOTOR = os.path.dirname(banco.AQUI)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--escenas", default="twinNebula,collision,diskRingHalo")
    ap.add_argument("--motas", default="262144")
    ap.add_argument("--salida", default=os.path.join(MOTOR, "media"))
    ap.add_argument("--w", type=int, default=1280)
    ap.add_argument("--h", type=int, default=720)
    ap.add_argument("--expo", type=float, default=EXPOSICION)
    a = ap.parse_args()
    ctx = moderngl.create_standalone_context(require=330)
    ctx.enable(moderngl.PROGRAM_POINT_SIZE)
    quad = ctx.program(vertex_shader=QUAD_V, fragment_shader=QUAD_F)
    vb = ctx.buffer(np.array([-1, -1, 3, -1, -1, 3], dtype="f4").tobytes())
    vao_q = ctx.vertex_array(quad, [(vb, "2f", "p")])
    quad["expo"].value = a.expo
    fondo_lin = tuple(srgb_a_lineal(c) for c in banco.FONDO)
    os.makedirs(a.salida, exist_ok=True)
    negras = []
    for escena in a.escenas.split(","):
        d = os.path.join(tempfile.gettempdir(), "nde_capturas", escena)
        subprocess.run(["node", os.path.join(banco.AQUI, "escena.mjs"), d, escena, a.motas, str(a.w), str(a.h)],
                       check=True, cwd=MOTOR, stdout=subprocess.DEVNULL)
        with open(os.path.join(d, "escena.json"), encoding="utf-8") as f:
            meta = json.load(f)
        W, H = meta["W"], meta["H"]
        tex = ctx.texture((W, H), 4, dtype="f2")
        fh = ctx.framebuffer(color_attachments=[tex])
        out = ctx.framebuffer(color_attachments=[ctx.texture((W, H), 4)])
        # el fondo tal como sale por la pasada de salida (el tonemap lo sube un poco)
        fh.use()
        fh.clear(*fondo_lin, 1.0)
        out.use()
        ctx.viewport = (0, 0, W, H)
        ctx.disable(moderngl.BLEND)
        tex.use(0)
        quad["t"].value = 0
        vao_q.render(moderngl.TRIANGLES)
        vacio = banco.lee(out)
        fh.use()
        fh.clear(*fondo_lin, 1.0)
        nubes = []
        for g in sorted(meta["grupos"], key=lambda x: x["orden"]):
            gd = os.path.join(d, g["id"])
            with open(os.path.join(gd, "datos.json"), encoding="utf-8") as f:
                datos = json.load(f)
            arr = {k: np.fromfile(os.path.join(gd, k + ".bin"), dtype="f4") for k in datos["atributos"]}
            nube = banco.Nube(ctx, datos, arr, "despues")
            nubes.append(nube)
            fh.use()
            ctx.viewport = (0, 0, W, H)
            ctx.enable(moderngl.BLEND)
            if g["blending"] == "additive":
                ctx.blend_func = (moderngl.SRC_ALPHA, moderngl.ONE)
            else:
                ctx.blend_func = (moderngl.SRC_ALPHA, moderngl.ONE_MINUS_SRC_ALPHA, moderngl.ONE, moderngl.ONE_MINUS_SRC_ALPHA)
            nube.dibuja()
        out.use()
        ctx.viewport = (0, 0, W, H)
        ctx.disable(moderngl.BLEND)
        tex.use(0)
        quad["t"].value = 0
        vao_q.render(moderngl.TRIANGLES)
        img = banco.lee(out)
        vivos = float((img.astype(np.int16).max(axis=2) - vacio.astype(np.int16).max(axis=2) > 12).mean()) * 100
        ruta = os.path.join(a.salida, f"{escena}.png")
        Image.fromarray(img).save(ruta)
        print(json.dumps({"escena": escena, "grupos": len(meta["grupos"]), "png": ruta, "encendido_pct": round(vivos, 2)}, ensure_ascii=False), flush=True)
        if vivos < 1:
            negras.append(escena)
        for n in nubes:
            n.vao.release()
            for b in n.bufs:
                b.release()
            n.prog.release()
        for x in (fh, out):
            x.release()
        tex.release()
    print("NEGRAS:", negras)
    sys.exit(1 if negras else 0)


if __name__ == "__main__":
    main()
