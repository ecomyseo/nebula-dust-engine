# -*- coding: utf-8 -*-
"""
EL LIENZO DE LA DEMO EN 8 BITS: ¿SALE NEGRO? (28/9/2026)

    python nebula-dust-engine/bench/lienzo8.py --modo antes|demo [--presets a,b]
           [--motas 16384,262144,1000000,4000000] [--opciones '{"volumeProfile":"mist"}']
           [--expo 8] [--png DIR]

Dibuja cada preset con el shader real (bench/volcar.mjs + moderngl) y mide el
lienzo de 8 bits que ve el usuario:

  antes  la demo hasta el 28/9: las motas se mezclan directamente en el lienzo
         RGBA8, en lineal, sin tonemap ni sRGB (un ShaderMaterial sin
         <tonemapping_fragment>/<colorspace_fragment> no los aplica, así que
         la exposición no hacía nada) y con la luz creciendo con las motas.
         Con 4 M, «Neblina» y «Supernova» sale lo de la captura del usuario:
         media 0,45 niveles, casi negro con un leve violeta. TIENE que salir
         negro: si no, la prueba no mide nada.
  demo   la demo arreglada (como la app con EffectComposer): se acumula en
         HalfFloat, con la luz de referencia (lightReferenceSamples = 786 432),
         y una pasada de salida aplica la exposición de fábrica de la demo
         (demo/hash.js) + ACES + sRGB al lienzo (lo que hace demo/post.js).

Por cada caso, niveles sobre el fondo (máximo de los tres canales): media,
p90, p99, p99,9 y % de píxeles saturados. NEGRO = media < 0,6 niveles o
p99,9 < 20 (con 16 k motas la nube cubre < 1 % del lienzo y el p99 es el
fondo aunque se vea: por eso no se usa el p99). Sale con código 1 si algún
caso sale negro.

Hipótesis descartadas midiendo: el suelo de alfa para 8 bits (subir las
motas de alfa < 1/255 y sortearlas) no cambia la media ni el p99 (0,45 → 0,46
con Neblina y 4 M): la luz no se pierde en el redondeo, se pierde por pintar
en lineal sin tonemap ni sRGB, y porque el pico de ACES se come lo muy tenue
con exposición 1,45 (por debajo de ~0,0015 lineal sale 0).
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
import moderngl
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import banco  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
PRESETS = ("orion,eaglePillars,horsehead,crab,ring,helix,lion,interstellarDust,galaxyDust,"
           "oortCloud,supernovaExplosion,whiteDwarfAccretion,redSupergiantShell,collidingWindPinwheel")
# La exposición de fábrica de la demo, leída de demo/hash.js (RENDER_SPEC.exposure.def,
# la misma que usan el panel y el enlace) para no desincronizarse.
_HASH = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "demo", "hash.js"), encoding="utf-8").read()
EXPOSICION = float(re.search(r"\bexposure: Object\.freeze\(\{[^}]*\bdef: ([\d.]+)", _HASH).group(1))
LUZ_REFERENCIA = 786432  # DUST_SAMPLE_BUDGETS[3], la de demo/main.js
UMBRAL_MEDIA = 0.6
UMBRAL_P999 = 20.0

QUAD_V = """#version 330
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }
"""
# Copia de three r180: ACESFilmicToneMapping y sRGBTransferOETF.
QUAD_F = """#version 330
uniform sampler2D t; uniform float expo; in vec2 uv; out vec4 o;
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= expo / 0.6;
  color = I * color; color = RRTAndODTFit(color); color = O * color;
  return clamp(color, 0.0, 1.0);
}
vec3 srgb(vec3 v) { return mix(pow(v, vec3(0.41666)) * 1.055 - vec3(0.055), v * 12.92, vec3(lessThanEqual(v, vec3(0.0031308)))); }
void main() { vec4 c = texture(t, uv); o = vec4(srgb(aces(c.rgb)), 1.0); }
"""


def srgb_a_lineal(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def pinta_en(ctx, fbo, nube, blending, fondo):
    fbo.use()
    ctx.viewport = (0, 0, fbo.width, fbo.height)
    fbo.clear(*fondo, 1.0)
    ctx.enable(moderngl.BLEND)
    if blending == "additive":
        ctx.blend_func = (moderngl.SRC_ALPHA, moderngl.ONE)
    else:
        ctx.blend_func = (moderngl.SRC_ALPHA, moderngl.ONE_MINUS_SRC_ALPHA, moderngl.ONE, moderngl.ONE_MINUS_SRC_ALPHA)
    nube.dibuja()


def niveles(img, fondo_img):
    d = img.astype(np.int16).max(axis=2) - fondo_img.astype(np.int16).max(axis=2)
    NIVELES_EXTRA.update(saturado=round(float((img.max(axis=2) >= 250).mean()) * 100, 3),
                         p90=float(np.percentile(d, 90)), p999=float(np.percentile(d, 99.9)))
    return float(d.mean()), float(np.percentile(d, 99))


NIVELES_EXTRA = {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--presets", default=PRESETS)
    ap.add_argument("--motas", default="16384,262144,1000000,4000000")
    ap.add_argument("--opciones", default="")
    ap.add_argument("--expo", type=float, default=EXPOSICION, help="exposición de la pasada de salida (la de la demo)")
    ap.add_argument("--tmp", default=os.path.join(tempfile.gettempdir(), "lienzo8_polvo"))
    ap.add_argument("--png", default="")
    ap.add_argument("--modo", required=True, choices=["antes", "demo"])
    a = ap.parse_args()
    ctx = moderngl.create_standalone_context(require=330)
    ctx.enable(moderngl.PROGRAM_POINT_SIZE)
    quad = ctx.program(vertex_shader=QUAD_V, fragment_shader=QUAD_F)
    vb = ctx.buffer(np.array([-1, -1, 3, -1, -1, 3], dtype="f4").tobytes())
    vao_q = ctx.vertex_array(quad, [(vb, "2f", "p")])
    quad["expo"].value = a.expo
    print(f"[{a.modo}] exposición {a.expo}" if a.modo == "demo" else "[antes] lienzo RGBA8 en lineal", flush=True)
    fondo8 = tuple(c / 255.0 for c in banco.FONDO)
    fondo_lin = tuple(srgb_a_lineal(c) for c in banco.FONDO)
    if a.modo == "demo" and "lightReferenceSamples" not in a.opciones:
        extra = json.loads(a.opciones) if a.opciones else {}
        extra["lightReferenceSamples"] = LUZ_REFERENCIA
        a.opciones = json.dumps(extra)
    import zlib
    sufijo = ("-" + str(zlib.crc32(a.opciones.encode()) % 100000)) if a.opciones else ""
    malos = []
    for preset in a.presets.split(","):
        for motas in [int(x) for x in a.motas.split(",")]:
            d = os.path.join(a.tmp, f"{preset}-{motas}{sufijo}")
            if not os.path.exists(os.path.join(d, "datos.json")):
                cmd = ["node", os.path.join(banco.AQUI, "volcar.mjs"), d, preset, str(motas), "--antes", "no"]
                if a.opciones:
                    cmd += ["--opciones", a.opciones]
                subprocess.run(cmd, check=True, cwd=banco.RAIZ, stdout=subprocess.DEVNULL)
            with open(os.path.join(d, "datos.json"), encoding="utf-8") as f:
                datos = json.load(f)
            arr = {k: np.fromfile(os.path.join(d, k + ".bin"), dtype="f4") for k in datos["atributos"]}
            W, H, bl = datos["W"], datos["H"], datos["blending"]
            nube = banco.Nube(ctx, datos, arr, "despues")
            fila = dict(preset=preset, motas=motas, blending=bl, errores_glsl=datos.get("erroresGlsl"))
            imgs = {}
            if a.modo == "antes":
                fb = ctx.framebuffer(color_attachments=[ctx.texture((W, H), 4)])
                fb.use(); fb.clear(*fondo8, 1.0)
                vacio = banco.lee(fb)
                pinta_en(ctx, fb, nube, bl, fondo8)
                imgs[a.modo] = banco.lee(fb)
                fila["media"], fila["p99"] = niveles(imgs[a.modo], vacio)
                fb.release()
            else:
                tex = ctx.texture((W, H), 4, dtype="f2")
                fh = ctx.framebuffer(color_attachments=[tex])
                out = ctx.framebuffer(color_attachments=[ctx.texture((W, H), 4)])

                def compone():
                    out.use()
                    ctx.viewport = (0, 0, W, H)
                    ctx.disable(moderngl.BLEND)
                    tex.use(0)
                    quad["t"].value = 0
                    vao_q.render(moderngl.TRIANGLES)
                fh.use(); fh.clear(*fondo_lin, 1.0)
                compone()
                vacio = banco.lee(out)
                pinta_en(ctx, fh, nube, bl, fondo_lin)
                compone()
                imgs["demo"] = banco.lee(out)
                fila["media"], fila["p99"] = niveles(imgs["demo"], vacio)
                for x in (fh, out):
                    x.release()
                tex.release()
            fila.update(NIVELES_EXTRA)
            if fila["media"] < UMBRAL_MEDIA or fila["p999"] < UMBRAL_P999:
                fila["NEGRO"] = True
                malos.append(f"{preset} {motas}")
            for k in list(fila):
                if isinstance(fila[k], float):
                    fila[k] = round(fila[k], 2)
            print(json.dumps(fila, ensure_ascii=False), flush=True)
            if a.png:
                os.makedirs(a.png, exist_ok=True)
                for k, im in imgs.items():
                    Image.fromarray(im).save(os.path.join(a.png, f"{preset}-{motas}{sufijo}-{k}.png"))
            nube.vao.release()
            for b in nube.bufs:
                b.release()
            nube.prog.release()
    print(f"[{a.modo}] NEGROS:", len(malos), malos)
    sys.exit(1 if malos else 0)


if __name__ == "__main__":
    main()
