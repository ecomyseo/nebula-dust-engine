/**
 * Nebula Dust Engine — outflow (expulsión continua desde una fuente que GIRA)
 *
 * Materia que sale sin parar de un objeto compacto en rotación (pensado para
 * el agujero blanco de Orbit Universe: el inverso temporal de Kerr), con la
 * cinemática de verdad y sin nada de la aplicación dentro:
 *
 * - SALE CON MOMENTO ANGULAR. Al salir (radio r0) la materia corrota con la
 *   fuente (arrastre del marco: Ω r0) y después conserva su momento angular,
 *   v_φ = Ω r0² cos λ / r ∝ 1/r: cada mota sale en espiral y se endereza. La
 *   radial acelera de β0 a β∞ con tiempo característico τa (cerrado:
 *   r(τ) = r0 + β∞ τ − (β∞ − β0) τa (1 − e^(−τ/τa))). Cada mota sigue en su
 *   cono de latitud λ.
 * - ASPERSOR GIRATORIO. Las corrientes salen de boquillas fijas en la fuente,
 *   que gira: el chorro continuo dibuja brazos en espiral que rotan con Ω y
 *   se abren al acelerar. Más materia en el ecuador (uLatPow); en los polos,
 *   dos chorros estrechos y rectos a lo largo del eje.
 * - COLOR POR FÍSICA, sin azar por mota: temperatura en reposo que baja con
 *   el radio (T ∝ r^−uTSlope, blanco-azulado dentro, rojo-naranja fuera),
 *   desplazada por el Doppler relativista de su velocidad en la línea de
 *   visión, T_obs = D T, D = 1 / (γ (1 − β cos θ)), y brillo ∝ D³. β nunca
 *   pasa de betaMax < 1.
 * - POLVO (segunda población, mezcla normal): más lento y grande, rojo-pardo,
 *   tapa en parte lo que hay detrás (el cielo, la anti-lente).
 * - SIN BÚFERES: todo sale de un hash de gl_VertexID; la CPU no toca nada por
 *   fotograma. El ciclo de cada mota es s = fract(fase + t · ritmo) con los
 *   ritmos cuantizados a 1/64, así el reloj se envuelve cada 1024 unidades
 *   sin salto: el flujo nunca se vacía ni necesita calentarse.
 * - PRESUPUESTO Y LOD DEL MOTOR (resolveDustBudget, createAdaptiveLodController):
 *   el techo de muestras DIBUJADAS lo pone quien conoce la GPU, el tiempo de
 *   cuadro recorta desde ese techo y la luz total se conserva.
 * - NADA TAPA LA CÁMARA: tamaño en mundo, tope en píxeles y fundido de lo que
 *   pasaría de nearFade veces el tope.
 * - SUMIDERO opcional (un agujero negro): tuerce lo que pasa cerca y se traga
 *   lo que entra por su sección eficaz.
 *
 * Unidades: posiciones en radios exteriores (`radius`, en unidades de la
 * escena) y tiempo en lo que tarda la luz en cruzar ese radio (c = 1).
 */
import * as THREE from 'three';
import { MAX_GPU_SAMPLE_COUNT, resolveDustBudget } from './index.js';
import { createAdaptiveLodController } from './gpu-profile.js';

/** Tope de muestras de un flujo. Sin atributos no cuestan memoria (no rige
 *  el tope de 4 M del motor, que es por los 36 bytes de cada muestra): cuesta
 *  lo que se DIBUJA, y eso lo decide el LOD. 2^24: gl_VertexID sigue exacto. */
export const OUTFLOW_MAX_SAMPLES = 16777216;
/** Periodo del reloj del flujo: todos los ritmos × OUTFLOW_TIME_PERIOD son enteros. */
export const OUTFLOW_TIME_PERIOD = 1024;
/** Componentes luminosas, en el orden de `mix`. */
export const OUTFLOW_COMPONENTS = Object.freeze(['wind', 'streams', 'arms', 'jets', 'shell']);
export const DEFAULT_OUTFLOW_MIX = Object.freeze({ wind: 0.30, streams: 0.40, arms: 0.17, jets: 0.05, shell: 0.08 });

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
function numberOr(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}
function positiveOr(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Number(value) : fallback;
}
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Factor Doppler relativista, el mismo del shader (β se sujeta a [0, betaMax]). */
export function relativisticDoppler(beta, cosTheta, betaMax = 0.97) {
  const b = clamp(numberOr(beta, 0), 0, Math.min(numberOr(betaMax, 0.97), 0.999));
  const g = 1 / Math.sqrt(1 - b * b);
  return 1 / (g * (1 - b * clamp(numberOr(cosTheta, 0), -1, 1)));
}

/**
 * Velocidad angular del horizonte de un agujero de Kerr de espín a (−1..1),
 * en radianes por (radio de Schwarzschild / c): Ω = a / (rs (1 + √(1 − a²))).
 */
export function kerrHorizonOmega(spin) {
  const a = clamp(numberOr(spin, 0), -0.998, 0.998);
  return a / (1 + Math.sqrt(1 - a * a));
}

/** Cinemática de una mota (gemela del shader, para las pruebas): radio y β radial a la edad τ. */
export function outflowRadial(tau, inner, beta0, betaInf, accel) {
  const ex = Math.exp(-tau / accel);
  return {
    r: inner + betaInf * tau - (betaInf - beta0) * accel * (1 - ex),
    betaR: betaInf - (betaInf - beta0) * ex
  };
}

const UNIFORMS_GLSL = /* glsl */`
uniform float uTime;
uniform float uSpinAngle;
uniform float uOmega;
uniform float uRadius;
uniform float uInner;
uniform float uBeta0;
uniform float uAccel;
uniform vec4 uMix;
uniform float uStreams;
uniform float uArms;
uniform float uLatPow;
uniform float uJetOpening;
uniform float uBetaMax;
uniform float uBeamExp;
uniform vec2 uBeamClamp;
uniform float uTNeutral;
uniform float uTRef;
uniform float uTSlope;
uniform float uTShell;
uniform float uRsR;       // radio de Schwarzschild / radio exterior
uniform float uJetLaunch; // radio de salida de los chorros (radios exteriores)
uniform vec2 uColorGain;   // ganancia del color: x = Doppler · log2 D + temperatura · log2 (T/Tn)
uniform vec4 uWeights;
uniform float uWeightShell;
uniform float uIntensity;
uniform float uSizeScale;
uniform float uHeightPx;
uniform float uMaxPointSize;
uniform float uNearFade;
uniform float uLodPointScale;
uniform float uLodAlphaScale;
uniform vec4 uSink;
uniform float uSinkRs;
uniform vec3 uDustColor;
uniform float uDustAlpha;
uniform vec2 uDepthCut;   // (modo, profundidad): 1 = solo lo de detrás, 2 = solo lo de delante
`;

const VARYINGS_GLSL = /* glsl */`
varying vec3 vColor;
varying float vAlpha;
varying float vProfile;
#ifdef OUTFLOW_PROBE
// Solo para las pruebas (transform feedback): lo que el shader decidió.
varying vec4 vProbe;      // D, cos(velocidad, al ojo), β, píxeles sin tope
varying vec4 vProbeLocal; // posición local (radios exteriores) y componente
varying vec4 vProbePath;  // dirección del camino y radio antes del sumidero
varying vec4 vProbeVel;   // velocidad local (fracción de c) y β_φ con signo
#endif
`;

const FUNCTIONS_GLSL = /* glsl */`
uint ofHash(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
vec2 ofPair(uint h) {
  return vec2(float(h & 65535u), float(h >> 16u)) * (1.0 / 65536.0) + (0.5 / 65536.0);
}
vec2 ofGauss(vec2 q) {
  float r = sqrt(-2.0 * log(q.x));
  float a = 6.28318530718 * q.y;
  return vec2(cos(a), sin(a)) * r;
}
vec3 ofSide(vec3 n) {
  vec3 o = abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  return normalize(cross(n, o));
}
/* latitud con más materia en el ecuador: sin λ = signo(x) |x|^uLatPow */
float ofLatitude(float u) {
  float x = 2.0 * u - 1.0;
  return asin(clamp(sign(x) * pow(abs(x), uLatPow), -1.0, 1.0));
}
/* escala de color de la temperatura observada respecto a la neutra (x =
 * log2 T_obs/Tn, con el Doppler y la temperatura cada uno con su ganancia):
 * −1,3 rojo, −0,5 naranja, 0 blanco-azulado, +0,5 azul, +1,3 violeta */
vec3 ofColorScale(float x) {
  /* saturada y con el tramo neutro estrecho: la suma de muchas motas azules
   * o rojas conserva el tono en vez de quedar en un gris */
  vec3 c = vec3(0.45, 0.010, 0.005);
  c = mix(c, vec3(1.00, 0.030, 0.010), clamp((x + 1.9) / 0.6, 0.0, 1.0));
  c = mix(c, vec3(1.00, 0.300, 0.040), clamp((x + 1.3) / 0.8, 0.0, 1.0));
  c = mix(c, vec3(1.00, 0.450, 0.100), clamp((x + 0.5) / 0.42, 0.0, 1.0));
  c = mix(c, vec3(0.85, 0.85, 1.000), clamp((x + 0.08) / 0.16, 0.0, 1.0));
  c = mix(c, vec3(0.12, 0.350, 1.000), clamp((x - 0.08) / 0.27, 0.0, 1.0));
  c = mix(c, vec3(0.04, 0.120, 1.000), clamp((x - 0.35) / 0.55, 0.0, 1.0));
  c = mix(c, vec3(0.28, 0.040, 1.000), clamp((x - 0.90) / 0.70, 0.0, 1.0));
  return c;
}
`;

const VERTEX_SHADER = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
${UNIFORMS_GLSL}
${VARYINGS_GLSL}
${FUNCTIONS_GLSL}
void main() {
#ifdef OUTFLOW_DUST
  uint id = uint(gl_VertexID) + 0x9e3779b9u;
#else
  uint id = uint(gl_VertexID);
#endif
  /* la componente va por bloques de 64 muestras seguidas: cada frente de
   * onda de la GPU hace una sola rama (y cualquier prefijo del LOD conserva
   * las proporciones, porque los bloques se sortean) */
  uint hk = ofHash((id >> 6u) ^ 0xa511e9b3u);
  uint h0 = ofHash(id);
  uint h1 = ofHash(h0 ^ 0x68bc21ebu);
  uint h2 = ofHash(h1 + 0x02e5be93u);
  uint h3 = ofHash(h2 ^ 0x9e3779b9u);
  float kind = float(hk >> 8u) * (1.0 / 16777216.0);
  vec2 a = ofPair(h0);
  vec2 b = ofPair(h1);
  vec2 c = ofPair(h2);
  vec2 d = ofPair(h3);
  vec2 g = ofGauss(d);

  float comp = 4.0;
#ifdef OUTFLOW_DUST
  comp = 5.0;
#else
  comp = kind < uMix.x ? 0.0 : kind < uMix.y ? 1.0 : kind < uMix.z ? 2.0 : kind < uMix.w ? 3.0 : 4.0;
#endif

  /* --- cada mota: latitud, boquilla, radio de salida y fase --- */
  float lat = 0.0;
  float phiNozzle = c.y * 6.28318530718;
  float spreadPhi = 0.0;
  float launch = uInner * (1.0 + 0.18 * a.x);   // radio de salida (radios exteriores)
  float beta0 = uBeta0;
  float bInf = -1.0;                             // < 0: la pone la repulsión
  float accel = uAccel;
  float w = uWeights.x;
  float size = 0.0020;
  float spins = 1.0;
  float phase = b.y;
  if (comp < 0.5) {
    /* VIENTO: sin boquilla, en todas direcciones con más en el ecuador */
    lat = ofLatitude(a.y);
    w = uWeights.x;
    size = 0.0082;
  } else if (comp < 1.5) {
    /* CORRIENTES FINAS: boquillas pequeñas que giran con la fuente */
    float j = floor(b.x * uStreams);
    uint hj = ofHash(uint(j) + 0x51ed270bu);
    uint hj2 = ofHash(hj ^ 0x2545f491u);
    vec2 n0 = ofPair(hj);
    vec2 n1 = ofPair(hj2);
    lat = ofLatitude(n0.x) + g.y * 0.010;
    phiNozzle = n0.y * 6.28318530718;
    spreadPhi = g.x * 0.018;
    launch = uInner * (1.0 + 0.18 * n1.x) * (1.0 + (a.x - 0.5) * 0.03);
    w = uWeights.y * (0.55 + 0.9 * n1.y);
    size = 0.0012;
  } else if (comp < 2.5) {
    /* BRAZOS: pocas boquillas grandes; su chorro continuo es el aspersor */
    float j = floor(b.x * max(uArms, 1.0));
    uint hj = ofHash(uint(j) + 0x3c6ef372u);
    uint hj2 = ofHash(hj ^ 0x7f4a7c15u);
    vec2 n0 = ofPair(hj);
    vec2 n1 = ofPair(hj2);
    lat = ofLatitude(n0.x) + g.y * 0.07;
    phiNozzle = n0.y * 6.28318530718;
    spreadPhi = g.x * 0.09;
    launch = uInner * (1.0 + 0.10 * n1.x) * (1.0 + (a.x - 0.5) * 0.04);
    w = uWeights.z;
    size = 0.0020;
  } else if (comp < 3.5) {
    /* CHORROS por el eje de giro: rectos, estrechos; con masa negativa no hay
     * horizonte y nacen más dentro (uJetLaunch), así salen los más rápidos */
    lat = (b.x < 0.55 ? 1.0 : -1.0) * (1.57079632679 - abs(g.y) * uJetOpening);
    launch = uJetLaunch * (1.0 + 0.2 * a.x);
    beta0 = 0.5;
    spins = 0.0;
    w = uWeights.w * (b.x < 0.55 ? 1.0 : 0.7);
    size = 0.0014;
  } else if (comp < 4.5) {
    /* CAPA EXTERIOR: gas más frío y lento, en grumos */
    float j = floor(b.x * 700.0);
    uint hj = ofHash(uint(j) + 0x94d049bbu);
    vec2 n0 = ofPair(hj);
    vec2 n1 = ofPair(ofHash(hj));
    lat = ofLatitude(n0.x) + g.y * 0.05;
    phiNozzle = n0.y * 6.28318530718 + g.x * 0.05;
    bInf = 0.012 + 0.040 * n1.x;
    beta0 = bInf;
    accel = 1.0;
    spins = 0.0;
    launch = 0.36;
    phase = n1.y + (a.y - 0.5) * 0.06;
    w = uWeightShell;
    size = 0.0050;
  } else {
    /* POLVO: lento, grande, en grumos alargados; gira poco */
    float j = floor(b.x * 900.0);
    uint hj = ofHash(uint(j) + 0x2c1b3c6du);
    vec2 n0 = ofPair(hj);
    vec2 n1 = ofPair(ofHash(hj));
    lat = ofLatitude(n0.x) + g.y * 0.06;
    phiNozzle = n0.y * 6.28318530718 + g.x * 0.06;
    bInf = 0.006 + 0.030 * n1.x;
    beta0 = bInf;
    accel = 1.0;
    spins = 0.0;
    launch = 0.36;
    phase = n1.y + (a.y - 0.5) * 0.10;
    size = 0.0060;
  }

  /* --- velocidad al salir y la final: corrota con la fuente (arrastre del
   * marco, v = Ω ρ0) y la repulsión de la masa negativa suma rs / (2 r0) a γ
   * (du/dt = G|M|/r²): γ∞ = γ0 + rs / (2 r0) --- */
  float cl = cos(lat);
  float betaPhi0 = spins * uOmega * launch * cl;
  float g0 = inversesqrt(max(1.0 - beta0 * beta0 - betaPhi0 * betaPhi0, 1e-4));
  if (bInf < 0.0) {
    float gInf = g0 + uRsR / (2.0 * launch);
    bInf = sqrt(max(1.0 - 1.0 / (gInf * gInf), 0.0));
  }
  bInf = min(bInf, uBetaMax);

  /* --- edad, radio y velocidad (ritmo cuantizado: el reloj se envuelve sin salto) --- */
  float outer = comp > 3.5 ? 0.62 : 1.0 - launch;
  float T = (outer + (bInf - beta0) * accel) / max(bInf, 1e-3);
  float rate = max(1.0, floor(64.0 / T + 0.5)) / 64.0;
  float s = fract(phase + uTime * rate);
  float tau = s / rate;
  float ex = exp(-tau / accel);
  float r = launch + bInf * tau - (bInf - beta0) * accel * (1.0 - ex);
  r = max(r, launch);
  float betaR0 = min(bInf - (bInf - beta0) * ex, 0.999);
  /* MOMENTO ANGULAR RELATIVISTA: se conserva L = γ r v_φ; la velocidad propia
   * azimutal u_φ = γ0 v_φ0 r0 / r, la radial sale del perfil, y γ de las dos */
  float uPhi0 = g0 * betaPhi0;
  float uPhi = uPhi0 * launch / r;
  float uR = betaR0 * inversesqrt(max(1.0 - betaR0 * betaR0, 1e-6));
  float gam0 = sqrt(1.0 + uR * uR + uPhi * uPhi);
  float betaR = uR / gam0;
  float betaPhi = uPhi / gam0;
  /* lo que ha girado la mota desde que salió (dφ/dt = u_φ0 r0 / (γ r² cos λ)) */
  float ve = beta0 + 0.25 * (bInf - beta0);
  float turn = spins * uOmega * g0 * launch * (1.0 - launch / r) / (max(ve, 1e-3) * 0.5 * (g0 + gam0));
  float phi = phiNozzle + spreadPhi + spins * (uSpinAngle - uOmega * tau) + turn;
  if (comp < 0.5) phi = phiNozzle + turn;
  /* antihorario visto desde +y (el eje de giro): con Ω > 0 el momento
   * angular apunta a +y, como el espín a* */
  vec3 radial = vec3(cl * cos(phi), sin(lat), -cl * sin(phi));
  vec3 azim = vec3(-sin(phi), 0.0, -cos(phi));
  vec3 p = radial * r;
  vec3 vel = radial * betaR + azim * betaPhi;
  float beta = length(vel);
  vec3 v = beta > 1e-6 ? vel / beta : radial;
  beta = min(beta, uBetaMax);
  vec3 path = radial;

  float life = smoothstep(0.0, comp > 3.5 ? 0.15 : 0.04, s) * (1.0 - smoothstep(comp > 3.5 ? 0.80 : 0.75, 1.0, s));
#ifdef OUTFLOW_PROBE
  vProbePath = vec4(path, length(p));
  /* w: γ β_φ r / (γ0 β_φ0 r0), el momento angular conservado (1) */
  vProbeVel = vec4(vel, spins > 0.5 && abs(uPhi0) > 1e-9 ? gam0 * betaPhi * r / (uPhi0 * launch) : 1.0);
#endif

  /* SUMIDERO: se tuerce hacia él y lo que entra en su sección eficaz se pierde */
  if (uSink.w > 0.0) {
    vec3 S = uSink.xyz;
    float rr = length(p);
    float t0 = dot(S, path);
    if (t0 > 0.0) {
      vec3 perp = path * t0 - S;
      float bb = length(perp);
      float cap = uSink.w;
      if (bb < cap * 1.9) {
        life *= 1.0 - smoothstep(t0 - 2.0 * cap, t0, rr);
      } else {
        float th = min(uSinkRs * 2.6 / bb, 0.85) * (1.0 - smoothstep(0.12, 0.30, bb));
        vec3 toward = -perp / bb;
        float past = max(rr - t0, 0.0);
        float near = smoothstep(t0 - 0.2, t0, rr) * (1.0 - step(t0, rr));
        p += toward * (past * th + near * bb * th * 0.4);
      }
    }
  }

  vec4 mv = modelViewMatrix * vec4(p * uRadius, 1.0);
  vec3 vv = (modelViewMatrix * vec4(v, 0.0)).xyz;
  float lv = length(vv);
  vv = lv > 1e-20 ? vv / lv : vec3(0.0, 0.0, 1.0);
  float dist = length(mv.xyz);
  vec3 toEye = dist > 1e-20 ? -mv.xyz / dist : vec3(0.0, 0.0, 1.0);
  float gam = inversesqrt(max(1.0 - beta * beta, 1e-6));
  float D = 1.0 / (gam * (1.0 - beta * dot(vv, toEye)));

  /* temperatura en reposo (baja con el radio) desplazada por el Doppler */
  float Trest = comp > 3.5 ? uTShell : uTRef * pow(uInner * 1.78 / r, uTSlope);
  /* y el corrimiento GRAVITATORIO: con masa negativa la luz que sale de cerca
   * gana energía al bajar la colina, √(1 + rs/r) (×1,37 a 1,12 rs): por eso
   * el núcleo es azulado */
  float grav = 0.5 * log2(1.0 + uRsR / r);
  vec3 col = ofColorScale(uColorGain.x * (log2(max(D, 1e-4)) + grav) + uColorGain.y * log2(Trest / uTNeutral));
  float beam = clamp(pow(D, uBeamExp), uBeamClamp.x, uBeamClamp.y);
  float glow = pow(clamp(uInner / r, 0.0, 1.0), 0.35);

  float z = max(-mv.z, 1e-6);
  float p11 = abs(projectionMatrix[1][1]);
  float pxUnit = uRadius * uHeightPx * p11 / (2.0 * z);
  float grow = comp > 3.5 ? 0.010 : comp > 2.5 ? 0.003 : comp > 1.5 ? 0.005 : comp > 0.5 ? 0.0022 : 0.006;
  float pxRaw = (size + grow * r) * uSizeScale * pxUnit;
  float px = clamp(pxRaw * uLodPointScale, 1.0, uMaxPointSize);
  float nearCam = 1.0 - smoothstep(uMaxPointSize, uMaxPointSize * uNearFade, pxRaw);
  /* motas redondas y suaves: gaussiana recortada en el círculo inscrito en
   * cuanto pasan de ~2 px (K = su media sobre el cuadrado del sprite) */
  float m = smoothstep(1.0, 2.2, px);
  float K = mix(1.0, 0.1928, m);
  vProfile = m;
#ifdef OUTFLOW_DUST
  /* polvo: tapa lo que hay detrás (su cobertura real, px² de la mota) y
   * dispersa un poco la luz del centro, rojo-pardo */
  float cover = min(pxRaw * pxRaw, 1.0) * uDustAlpha * uLodAlphaScale * life * nearCam;
  vAlpha = clamp(cover, 0.0, 0.85);
  vColor = uDustColor * (0.25 + 0.75 * glow) * uIntensity;
  float light = vAlpha;
#else
  /* LUZ DE UNA MUESTRA = FLUJO: va con 1/z² (píxeles por unidad al cuadrado)
   * y NO con su tamaño, que solo la reparte */
  float light = w * beam * life * nearCam * glow * uIntensity * uLodAlphaScale * pxUnit * pxUnit * 1e-6;
  vColor = col * (light / (px * px * K));
  vAlpha = 1.0;
#endif
#ifdef OUTFLOW_PROBE
  vProbe = vec4(D, dot(vv, toEye), beta, pxRaw);
  vProbeLocal = vec4(p, comp);
#endif
  gl_PointSize = px;
  gl_Position = projectionMatrix * mv;
  /* corte por profundidad (lo usa quien dibuja una lente de posproceso: lo
   * de delante va después de la lente, sin deformar) */
  float zCut = -mv.z;
  if (uDepthCut.x > 0.5 && (uDepthCut.x < 1.5 ? zCut < uDepthCut.y : zCut >= uDepthCut.y)) light = 0.0;
  if (!(light > 0.0) || mv.z >= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    vColor = vec3(0.0);
    vAlpha = 0.0;
  }
  #include <logdepthbuf_vertex>
}
`;

const FRAGMENT_SHADER = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
varying float vAlpha;
varying float vProfile;
void main() {
  #include <logdepthbuf_fragment>
  vec2 q = gl_PointCoord - 0.5;
  float r2 = dot(q, q) * 4.0;
  if (vProfile > 0.5 && r2 > 1.0) discard;
  float profile = mix(1.0, exp(-4.0 * r2), vProfile);
#ifdef OUTFLOW_DUST
  gl_FragColor = vec4(vColor, vAlpha * profile);
#else
  gl_FragColor = vec4(vColor * profile, 1.0);
#endif
}
`;

/* ------------------------------------------------------------------ */
/*  LA NUBE: el medio continuo, integrado por el rayo (29/9/2026)       */
/* ------------------------------------------------------------------ */
/* El usuario: «tiene que ser una nube cerca y menos al alejarse; faltan
 * trillones de partículas». Las motas no llegan nunca a «infinitas»; el
 * medio continuo sí, a coste fijo: una esfera-impostor del radio exterior
 * integra a lo largo de cada rayo la emisión del viento (densidad ∝ 1/r²,
 * más en el ecuador), modulada por los brazos del aspersor (los mismos que
 * las motas: giran con la fuente), con el color Doppler de la velocidad local
 * (la de la energía: γ(r) = γ0 + (rs/2)(1/r0 − 1/r), que crece siempre, y el
 * giro con L = γ r v_φ) y un polvo en cáscara que absorbe.
 *
 * SEIS muestras por rayo, repartidas UNIFORMES EN EL ÁNGULO θ = atan(l/b)
 * visto desde el centro: para una densidad 1/r² eso integra EXACTO la parte
 * radial (∫ dl/(b² + l²) = Δθ/b) y concentra las muestras donde hay materia,
 * sin franjas; el resto (brazos, color, polvo) se muestrea en esos puntos.
 * Un bucle de 6 con un cuerpo corto (memoria shader-direct3d-bucles-y-franjas),
 * y la esfera solo hasta 0,6 del radio exterior: lo de fuera es poca luz y
 * lo ponen las motas; la nube cuesta por píxel cubierto.
 * Mezcla: color añadido y el fondo multiplicado por la transmisión del polvo
 * (ONE, SRC_ALPHA). Todo en el marco local (el eje de giro es +y) y en radios
 * exteriores: la cámara llega en uCamLocal. */
const CLOUD_VERTEX_SHADER = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uCloudRV;
varying vec3 vLocal;
void main() {
  vLocal = position * uCloudRV;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const CLOUD_FRAGMENT_SHADER = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
${UNIFORMS_GLSL}
uniform vec3 uCamLocal;
uniform float uCloudLight;
uniform float uCloudDust;
uniform float uCloudRV;
uniform vec4 uCloudPlane;   // plano de corte (normal local, distancia) para la lente del negro
uniform float uCloudCut;    // 0 todo, 1 solo detrás del plano, 2 solo delante
uniform float uCloudR;      // radio de la nube, en radios exteriores (la luz está dentro)
varying vec3 vLocal;
${FUNCTIONS_GLSL}
void main() {
  #include <logdepthbuf_fragment>
  vec3 ro = uCamLocal;
  vec3 rd = normalize(vLocal - ro);
  float bq = dot(ro, rd);
  float cq = dot(ro, ro) - uCloudR * uCloudR;
  float disc = bq * bq - cq;
  if (disc <= 0.0) discard;
  float sq = sqrt(disc);
  float ta = max(-bq - sq, 0.0);
  float tb = -bq + sq;
  if (uCloudCut > 0.5) {
    float den = dot(uCloudPlane.xyz, rd);
    float tc = abs(den) > 1e-6 ? (uCloudPlane.w - dot(uCloudPlane.xyz, ro)) / den : 1e9;
    if (uCloudCut < 1.5) ta = max(ta, tc); else tb = min(tb, tc);
  }
  if (tb <= ta) discard;
  /* el punto más cercano al centro y el parámetro de impacto (nunca dentro
   * del radio de salida: ahí manda el núcleo) */
  float tcen = -bq;
  float bImp = max(sqrt(max(dot(ro, ro) - bq * bq, 0.0)), 1.8 * uInner);
  float thA = atan((ta - tcen) / bImp);
  float thB = atan((tb - tcen) / bImp);
  float dth = (thB - thA) / 6.0;
  /* desfase por píxel con ruido blanco (un ruido con estructura dibujaba
   * rayas diagonales con solo seis muestras) */
  float jit = float(ofHash(uint(gl_FragCoord.x) + 4099u * uint(gl_FragCoord.y)) >> 8u) * (1.0 / 16777216.0);
  vec3 acc = vec3(0.0);
  float trans = 1.0;
  for (int i = 0; i < 6; i++) {
    float th = thA + (float(i) + jit) * dth;
    float l = bImp * tan(th);
    vec3 x = ro + rd * (tcen + l);
    float r = max(length(x), uInner);
    float sl = clamp(x.y / r, -1.0, 1.0);
    float cl = sqrt(max(1.0 - sl * sl, 0.0));
    float ec = max(1.0 - abs(sl), 0.0);
    float lat = 0.30 + 0.70 * ec * sqrt(ec);
    /* brazos del aspersor: la fase que llevaría una mota salida hace τ(r) */
    float phi = atan(-x.z, x.x);
    float tau = (r - uInner) / 0.80;
    float turn = uOmega * uInner / 0.30 * (1.0 - uInner / r) * 0.7;
    float arm = 0.5 + 0.5 * cos(max(uArms, 1.0) * (phi - uSpinAngle + uOmega * tau - turn) + 1.3);
    float n = lat * (0.30 + 1.40 * arm * arm);
    /* velocidad de la energía (crece siempre hacia fuera) y giro con L = γ r v_φ */
    float bphi0 = uOmega * uInner * cl;
    float g0 = inversesqrt(max(1.0 - uBeta0 * uBeta0 - bphi0 * bphi0, 1e-4));
    float gam = g0 + 0.5 * uRsR * (1.0 / uInner - 1.0 / r);
    float uphi = g0 * bphi0 * uInner / r;
    float ur = sqrt(max(gam * gam - 1.0 - uphi * uphi, 0.0));
    vec3 rh = x / r;
    vec3 ph = cl > 1e-3 ? vec3(x.z, 0.0, -x.x) / (r * cl) : vec3(0.0);
    vec3 bv = (rh * ur + ph * uphi) / gam;
    float D = 1.0 / (gam * (1.0 - dot(bv, -rd)));
    float Trest = uTRef * pow(uInner * 1.78 / r, uTSlope);
    float grav = 0.5 * log2(1.0 + uRsR / r);
    vec3 col = ofColorScale(uColorGain.x * (log2(max(D, 1e-4)) + grav) + uColorGain.y * log2(Trest / uTNeutral));
    float beam = clamp(D * D * D, uBeamClamp.x, uBeamClamp.y);
    /* 1/r² integrado exacto: cada muestra pesa Δθ/b */
    acc += trans * col * (n * beam * dth / bImp) * uCloudLight;
    /* polvo en cáscara (hacia 0,62 radios): absorbe lo que hay detrás */
    float nd = exp(-((r - 0.42) * (r - 0.42)) / 0.09) * lat;
    float dl = bImp * dth / max(cos(th) * cos(th), 1e-3);
    trans *= exp(-uCloudDust * nd * dl);
  }
  gl_FragColor = vec4(acc, trans);
}
`;

function colorOf(value, fallback) {
  if (value && value.isColor) return [value.r, value.g, value.b];
  if (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite)) {
    return [value[0], value[1], value[2]];
  }
  if (typeof value === 'string' || typeof value === 'number') {
    try {
      const c = new THREE.Color(value);
      return [c.r, c.g, c.b];
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/**
 * Crea un flujo de expulsión. Opciones (todas opcionales):
 *  radius (escena), innerRadius (escena; defecto radius·0,025), sampleCount,
 *  dustSampleCount (defecto la cuarta parte), quality, maximumSamples,
 *  renderer, mix { wind, streams, arms, jets, shell }, weights { … },
 *  omega (giro de la fuente, rad por unidad de reloj, con signo), streams,
 *  arms, latitudePower, launchBeta, accelTime, schwarzschildRadius (escena:
 *  fija la velocidad final, γ∞ = γ0 + rs/2r0), jetOpening (rad),
 *  jetLaunchRadius (escena), betaMax (< 1), beamExp, beamFloor,
 *  beamCap, neutralTemperature, innerTemperature, temperatureSlope,
 *  shellTemperature, dustColor, dustAlpha, intensity, sizeScale,
 *  maxPointSize (px), nearFade, heightPx, lightReferenceSamples, adaptive,
 *  targetFrameMs, minimumPerformanceLod, minimumLod, nearLodDistance,
 *  farLodDistance (en radios), maxVisibleSamples, renderOrder, name.
 */
export function createDustOutflow(options = {}) {
  const requested = positiveOr(options.sampleCount, 0);
  const budget = resolveDustBudget(Object.assign({}, options, {
    sampleCount: requested || undefined,
    maximumSamples: positiveOr(options.maximumSamples, MAX_GPU_SAMPLE_COUNT),
    trackPhysicalPopulation: false
  }));
  const sampleCount = requested > 0
    ? Math.max(1, Math.floor(Math.min(requested, positiveOr(options.maximumSamples, OUTFLOW_MAX_SAMPLES), OUTFLOW_MAX_SAMPLES)))
    : budget.sampleCount;
  const dustCount = Math.max(0, Math.floor(numberOr(options.dustSampleCount, Math.floor(sampleCount / 4))));
  let radius = positiveOr(options.radius, 1);
  const inner = clamp(positiveOr(options.innerRadius, radius * 0.025) / radius, 1e-4, 0.5);

  const mixIn = Object.assign({}, DEFAULT_OUTFLOW_MIX, options.mix || {});
  const parts = OUTFLOW_COMPONENTS.map((k) => Math.max(0, numberOr(mixIn[k], 0)));
  const total = parts.reduce((x, y) => x + y, 0) || 1;
  let acc = 0;
  const cumulative = parts.map((x) => (acc += x / total));
  const weights = Object.assign({ wind: 0.45, streams: 1.0, arms: 0.9, jets: 0.6, shell: 0.5 }, options.weights || {});
  const betaMax = clamp(numberOr(options.betaMax, 0.97), 0, 0.995);
  let omega = numberOr(options.omega, 0);
  let spinAngle = 0;

  const uniforms = {
    uTime: { value: 0 },
    uSpinAngle: { value: 0 },
    uOmega: { value: omega },
    uRadius: { value: radius },
    uInner: { value: inner },
    uBeta0: { value: clamp(numberOr(options.launchBeta, 0.12), 0.01, 0.9) },
    uAccel: { value: positiveOr(options.accelTime, 0.08) },
    uMix: { value: new THREE.Vector4(cumulative[0], cumulative[1], cumulative[2], cumulative[3]) },
    uStreams: { value: Math.max(1, Math.floor(positiveOr(options.streams, 900))) },
    uArms: { value: Math.max(1, Math.floor(positiveOr(options.arms, 3))) },
    uLatPow: { value: clamp(numberOr(options.latitudePower, 1.6), 0.5, 4) },
    uJetOpening: { value: clamp(numberOr(options.jetOpening, 0.04), 0.001, 0.6) },
    uBetaMax: { value: betaMax },
    uBeamExp: { value: clamp(numberOr(options.beamExp, 3), 0, 4) },
    uBeamClamp: { value: new THREE.Vector2(positiveOr(options.beamFloor, 0.05), positiveOr(options.beamCap, 10)) },
    uTNeutral: { value: positiveOr(options.neutralTemperature, 6500) },
    uTRef: { value: positiveOr(options.innerTemperature, 6500) },
    uTSlope: { value: clamp(numberOr(options.temperatureSlope, 0.35), 0, 2) },
    uTShell: { value: positiveOr(options.shellTemperature, 3000) },
    uRsR: { value: positiveOr(options.schwarzschildRadius, radius * 0.0223) / radius },
    uJetLaunch: { value: positiveOr(options.jetLaunchRadius, radius * 0.0067) / radius },
    uColorGain: { value: new THREE.Vector2(positiveOr(options.dopplerColorGain, 1), positiveOr(options.temperatureColorGain, 1)) },
    uWeights: { value: new THREE.Vector4(weights.wind, weights.streams, weights.arms, weights.jets) },
    uWeightShell: { value: numberOr(weights.shell, 0.5) },
    uIntensity: { value: Math.max(0, numberOr(options.intensity, 1)) },
    uSizeScale: { value: positiveOr(options.sizeScale, 1) },
    uHeightPx: { value: positiveOr(options.heightPx, 900) },
    uMaxPointSize: { value: clamp(numberOr(options.maxPointSize, 8), 1, 64) },
    uNearFade: { value: clamp(numberOr(options.nearFade, 4), 1.01, 100) },
    uLodPointScale: { value: 1 },
    uLodAlphaScale: { value: 1 },
    // Vector4() nace con w = 1: el sumidero nace apagado (w = 0).
    uSink: { value: new THREE.Vector4(0, 0, 0, 0) },
    uSinkRs: { value: 0 },
    uDustColor: { value: new THREE.Color().setRGB(...colorOf(options.dustColor, [0.34, 0.14, 0.06])) },
    uDepthCut: { value: new THREE.Vector2(0, 0) },
    uDustAlpha: { value: clamp(numberOr(options.dustAlpha, 0.10), 0, 1) }
  };

  const material = new THREE.ShaderMaterial({
    name: options.name ? options.name + '.material' : 'dust-outflow',
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthTest: options.depthTest !== false,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setDrawRange(0, sampleCount);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.3);
  const points = new THREE.Points(geometry, material);
  points.name = 'Dust outflow samples';
  points.frustumCulled = false;
  points.renderOrder = numberOr(options.renderOrder, 1);
  // Sin atributo `position` el raycast de three no tiene qué mirar.
  points.raycast = () => {};

  /* el polvo: el mismo shader con OUTFLOW_DUST, mezcla normal, antes que la
   * luz (tapa el fondo; la luz se suma encima) */
  const dustMaterial = new THREE.ShaderMaterial({
    name: options.name ? options.name + '.dust' : 'dust-outflow-dust',
    uniforms,
    defines: { OUTFLOW_DUST: '' },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthTest: options.depthTest !== false,
    depthWrite: false,
    blending: THREE.NormalBlending
  });
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setDrawRange(0, dustCount);
  dustGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.3);
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  dust.name = 'Dust outflow dust';
  dust.frustumCulled = false;
  dust.renderOrder = points.renderOrder - 0.5;
  dust.raycast = () => {};
  dust.visible = dustCount > 0;

  const object3d = new THREE.Group();
  object3d.name = options.name || 'Dust outflow';
  object3d.add(dust, points);

  /* la nube (medio continuo integrado por el rayo), si se pide */
  const cloudOptions = options.cloud || null;
  let cloud = null;
  let cloudMaterial = null;
  let cloudGeometry = null;
  if (cloudOptions) {
    uniforms.uCamLocal = { value: new THREE.Vector3(0, 0, 10) };
    uniforms.uCloudLight = { value: Math.max(0, numberOr(cloudOptions.intensity, 1)) };
    uniforms.uCloudDust = { value: Math.max(0, numberOr(cloudOptions.dust, 1)) };
    uniforms.uCloudPlane = { value: new THREE.Vector4(0, 0, 1, 0) };
    uniforms.uCloudCut = { value: 0 };
    /* la nube solo hasta donde hay luz que integrar (1/r²): 0,6 del radio
     * exterior; fuera quedan las motas. Cuesta por píxel cubierto. */
    const cloudR = clamp(numberOr(cloudOptions.radius, 0.6), 0.1, 1);
    uniforms.uCloudR = { value: cloudR };
    uniforms.uCloudRV = { value: cloudR };
    cloudMaterial = new THREE.ShaderMaterial({
      name: options.name ? options.name + '.cloud' : 'dust-outflow-cloud',
      uniforms,
      vertexShader: CLOUD_VERTEX_SHADER,
      fragmentShader: CLOUD_FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.SrcAlphaFactor
    });
    cloudGeometry = new THREE.SphereGeometry(1, 48, 24);
    cloud = new THREE.Mesh(cloudGeometry, cloudMaterial);
    cloud.name = 'Dust outflow cloud';
    cloud.scale.setScalar(radius * cloudR);
    cloud.frustumCulled = false;
    cloud.renderOrder = points.renderOrder - 0.7;
    cloud.raycast = () => {};
    object3d.add(cloud);
  }
  const cameraLocal = new THREE.Vector3();

  const lightReferenceSamples = positiveOr(options.lightReferenceSamples, sampleCount);
  const nearLod = positiveOr(options.nearLodDistance, 3);
  const farLod = Math.max(nearLod + 0.01, positiveOr(options.farLodDistance, 28));
  const minimumLod = clamp(numberOr(options.minimumLod, 0.12), 0.01, 1);
  /* UN PUNTO CUESTA: en una gráfica integrada (AMD Radeon, medido con
   * moderngl) 1.000.000 de motas de 1 px son ~10 ms. El techo de motas
   * dibujadas (maxVisibleSamples) lo pone quien conoce la GPU, y el tiempo de
   * cuadro recorta a partir de ESE techo (fracción de rendimiento de 1 a
   * minimumPerformanceLod), no a partir del total asignado. */
  const adaptiveLod = createAdaptiveLodController({
    enabled: options.adaptive !== false,
    targetFrameMs: options.targetFrameMs,
    gpuBudgetMs: options.gpuBudgetMs,
    minimumFraction: clamp(numberOr(options.minimumPerformanceLod, 0.25), 0.02, 1)
  });
  let maxVisibleSamples = Math.max(1, Math.floor(positiveOr(options.maxVisibleSamples, sampleCount)));
  let time = 0;
  let visibleSamples = sampleCount;
  let visibleDust = dustCount;
  let disposed = false;
  const center = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();

  /**
   * Un fotograma. `deltaSeconds` (tiempo real) cuenta para el LOD por tiempo
   * de cuadro; `flowAdvance` es lo que avanza el reloj del flujo, en cruces
   * de la luz del radio exterior (por defecto deltaSeconds · 0,08). Devuelve
   * la fracción de muestras dibujadas.
   */
  function update(camera, deltaSeconds = 0, flowAdvance) {
    if (disposed) return 0;
    const advance = Number.isFinite(flowAdvance) ? flowAdvance : clamp(numberOr(deltaSeconds, 0), 0, 0.25) * 0.08;
    time = ((time + advance) % OUTFLOW_TIME_PERIOD + OUTFLOW_TIME_PERIOD) % OUTFLOW_TIME_PERIOD;
    spinAngle = ((spinAngle + omega * advance) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    uniforms.uTime.value = time;
    uniforms.uSpinAngle.value = spinAngle;
    let lodFraction = 1;
    if (camera && camera.position) {
      object3d.getWorldPosition(center);
      if (typeof camera.getWorldPosition === 'function') camera.getWorldPosition(cameraPosition);
      else cameraPosition.copy(camera.position);
      const normalizedDistance = center.distanceTo(cameraPosition) / Math.max(radius, 1e-9);
      lodFraction = 1 + (minimumLod - 1) * smoothstep(nearLod, farLod, normalizedDistance);
      if (cloud) {
        cameraLocal.copy(cameraPosition);
        object3d.worldToLocal(cameraLocal);
        uniforms.uCamLocal.value.copy(cameraLocal).divideScalar(Math.max(radius, 1e-9));
      }
    }
    const performanceFraction = adaptiveLod.update(deltaSeconds, null);
    const cap = Math.min(sampleCount * lodFraction, maxVisibleSamples);
    visibleSamples = Math.max(1, Math.min(sampleCount, Math.round(cap * performanceFraction)));
    const fraction = visibleSamples / sampleCount;
    visibleDust = Math.min(dustCount, Math.round(dustCount * fraction));
    geometry.setDrawRange(0, visibleSamples);
    dustGeometry.setDrawRange(0, visibleDust);
    dust.visible = visibleDust > 0;
    const aggregation = lightReferenceSamples / visibleSamples;
    uniforms.uLodAlphaScale.value = aggregation;
    uniforms.uLodPointScale.value = clamp(Math.pow(aggregation, 0.12), 1, 1.4);
    return fraction;
  }

  /** Radio exterior (escena); el flujo entero se escala con él. */
  function setRadius(value) {
    radius = positiveOr(value, radius);
    uniforms.uRadius.value = radius;
    geometry.boundingSphere.radius = radius * 1.3;
    dustGeometry.boundingSphere.radius = radius * 1.3;
    if (cloud) cloud.scale.setScalar(radius * uniforms.uCloudR.value);
    return radius;
  }

  /** Radio de salida (escena). */
  function setInnerRadius(value) {
    uniforms.uInner.value = clamp(positiveOr(value, uniforms.uInner.value * radius) / radius, 1e-4, 0.5);
    return uniforms.uInner.value * radius;
  }

  /** Radio de Schwarzschild y de salida de los chorros (escena). */
  function setSchwarzschildRadius(rs, jetLaunch) {
    uniforms.uRsR.value = positiveOr(rs, uniforms.uRsR.value * radius) / radius;
    if (jetLaunch > 0) uniforms.uJetLaunch.value = jetLaunch / radius;
    return uniforms.uRsR.value * radius;
  }

  /** Giro de la fuente, en radianes por unidad de reloj (con signo). */
  function setOmega(value) {
    omega = numberOr(value, omega);
    uniforms.uOmega.value = omega;
    return omega;
  }

  /**
   * Sumidero en el espacio local de object3d (escena), con su radio de
   * captura y su radio de Schwarzschild; null lo quita.
   */
  function setSink(localPoint, captureRadius = 0, rs = 0) {
    const s = uniforms.uSink.value;
    if (!localPoint || !(captureRadius > 0)) {
      s.set(0, 0, 0, 0);
      uniforms.uSinkRs.value = 0;
      return false;
    }
    const x = Array.isArray(localPoint) ? localPoint[0] : localPoint.x;
    const y = Array.isArray(localPoint) ? localPoint[1] : localPoint.y;
    const z = Array.isArray(localPoint) ? localPoint[2] : localPoint.z;
    if (![x, y, z].every(Number.isFinite)) {
      s.set(0, 0, 0, 0);
      return false;
    }
    s.set(x / radius, y / radius, z / radius, captureRadius / radius);
    uniforms.uSinkRs.value = Math.max(0, numberOr(rs, 0)) / radius;
    return true;
  }

  function setIntensity(value) {
    uniforms.uIntensity.value = Math.max(0, numberOr(value, uniforms.uIntensity.value));
    return uniforms.uIntensity.value;
  }
  function setHeightPx(value) {
    if (value > 0) uniforms.uHeightPx.value = value;
    return uniforms.uHeightPx.value;
  }
  function setMaxPointSize(value) {
    uniforms.uMaxPointSize.value = clamp(numberOr(value, uniforms.uMaxPointSize.value), 1, 64);
    return uniforms.uMaxPointSize.value;
  }
  function setMaxVisibleSamples(value) {
    maxVisibleSamples = Math.max(1, Math.floor(positiveOr(value, sampleCount)));
    return maxVisibleSamples;
  }
  function setTime(value) {
    time = ((numberOr(value, 0) % OUTFLOW_TIME_PERIOD) + OUTFLOW_TIME_PERIOD) % OUTFLOW_TIME_PERIOD;
    uniforms.uTime.value = time;
    return time;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    object3d.remove(points, dust);
    if (object3d.parent) object3d.parent.remove(object3d);
    geometry.dispose();
    material.dispose();
    dustGeometry.dispose();
    dustMaterial.dispose();
    if (cloud) {
      object3d.remove(cloud);
      cloudGeometry.dispose();
      cloudMaterial.dispose();
    }
  }

  function getStatus() {
    return Object.freeze({
      disposed,
      sampleCount,
      dustSampleCount: dustCount,
      visibleSamples,
      visibleDust,
      visibleFraction: visibleSamples / sampleCount,
      lodAlphaScale: uniforms.uLodAlphaScale.value,
      lodPointScale: uniforms.uLodPointScale.value,
      time,
      spinAngle,
      omega,
      radius,
      sink: uniforms.uSink.value.w > 0,
      adaptive: adaptiveLod.snapshot()
    });
  }

  const metadata = Object.freeze({
    engine: 'nebula-dust-engine',
    phenomenon: 'rotating-outflow',
    sampleCount,
    dustSampleCount: dustCount,
    bytesPerSample: 0,
    quality: budget.quality,
    gpuProfile: budget.gpuProfile,
    components: OUTFLOW_COMPONENTS,
    mix: Object.freeze(Object.fromEntries(OUTFLOW_COMPONENTS.map((k, i) => [k, parts[i] / total])))
  });
  object3d.userData.nebulaDust = metadata;

  return Object.freeze({
    object3d,
    points,
    material,
    geometry,
    dust,
    dustMaterial,
    dustGeometry,
    cloud,
    cloudMaterial,
    cloudGeometry,
    metadata,
    uniforms,
    update,
    setRadius,
    setInnerRadius,
    setOmega,
    setSchwarzschildRadius,
    setSink,
    setIntensity,
    setHeightPx,
    setMaxPointSize,
    setMaxVisibleSamples,
    setTime,
    getStatus,
    dispose,
    libera: dispose
  });
}

export default createDustOutflow;
