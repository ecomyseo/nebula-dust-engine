/**
 * Perfil conservador de GPU. Es una heurística reproducible, no un benchmark ni
 * una identificación comercial exacta del dispositivo.
 */

export const GPU_SAMPLE_BUDGETS = Object.freeze([16384, 65536, 262144, 786432, 2000000]);
export const GPU_TIER_NAMES = Object.freeze(['minimal', 'balanced', 'detailed', 'high', 'ultra']);

const LOW_GPU = /swiftshader|llvmpipe|software|mali[- ]?4|adreno \(tm\) [23]|intel\(r\) hd graphics [234]/i;
const MID_GPU = /intel|iris|uhd|mali|adreno|apple gpu|angle.*direct3d11/i;
const HIGH_GPU = /geforce (rtx|gtx 1[6-9]|gtx [2-9])|radeon (rx|pro)|apple m[1-9]|arc\(tm\)/i;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function tierOr(value, fallback) {
  return Number.isFinite(value)
    ? clamp(Math.round(value), 0, GPU_SAMPLE_BUDGETS.length - 1)
    : fallback;
}

function safeParameter(gl, parameter, fallback = null) {
  try {
    return parameter == null ? fallback : gl.getParameter(parameter);
  } catch {
    return fallback;
  }
}

function rendererName(gl) {
  try {
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    if (extension) return String(safeParameter(gl, extension.UNMASKED_RENDERER_WEBGL, 'desconocida'));
  } catch {
    // Algunos navegadores bloquean deliberadamente esta extensión.
  }
  return String(safeParameter(gl, gl.RENDERER, 'desconocida'));
}

/**
 * Detecta un nivel 0–4 mediante capacidades WebGL y señales no identificadoras.
 * `overrideTier` permite al consumidor ofrecer un selector manual accesible.
 */
export function detectGpuProfile(renderer, options = {}) {
  const forcedMobile = options.mobile === true;
  const userAgent = typeof options.userAgent === 'string'
    ? options.userAgent
    : (typeof navigator !== 'undefined' ? navigator.userAgent || '' : '');
  const mobileSignal = forcedMobile || /android|iphone|ipad|mobile/i.test(userAgent);
  if (Number.isFinite(options.overrideTier)) {
    const tier = tierOr(options.overrideTier, 1);
    return Object.freeze({
      tier,
      tierName: GPU_TIER_NAMES[tier],
      sampleBudget: GPU_SAMPLE_BUDGETS[tier],
      source: 'manual',
      renderer: 'manual',
      isWebGL2: null,
      maxTextureSize: null,
      maxVertexTextures: null,
      timerQuerySupported: false,
      deviceMemoryGB: null,
      mobile: mobileSignal
    });
  }

  let gl = null;
  try {
    gl = renderer && typeof renderer.getContext === 'function'
      ? renderer.getContext()
      : null;
  } catch {
    gl = null;
  }
  if (!gl) {
    const tier = tierOr(options.fallbackTier, 1);
    return Object.freeze({
      tier,
      tierName: GPU_TIER_NAMES[tier],
      sampleBudget: GPU_SAMPLE_BUDGETS[tier],
      source: 'fallback',
      renderer: 'sin contexto WebGL',
      isWebGL2: null,
      maxTextureSize: null,
      maxVertexTextures: null,
      timerQuerySupported: false,
      deviceMemoryGB: null,
      mobile: mobileSignal
    });
  }

  const capabilities = renderer.capabilities || {};
  const isWebGL2 = capabilities.isWebGL2 === true;
  const maxTextureSize = Number(capabilities.maxTextureSize)
    || Number(safeParameter(gl, gl.MAX_TEXTURE_SIZE, 2048));
  const maxVertexTextures = Number(capabilities.maxVertexTextures)
    || Number(safeParameter(gl, gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS, 0));
  const name = rendererName(gl);
  let timerQuerySupported = false;
  try {
    timerQuerySupported = Boolean(
      gl.getExtension('EXT_disjoint_timer_query_webgl2')
      || gl.getExtension('EXT_disjoint_timer_query')
    );
  } catch {
    timerQuerySupported = false;
  }
  const deviceMemoryGB = Number.isFinite(options.deviceMemoryGB)
    ? Number(options.deviceMemoryGB)
    : (typeof navigator !== 'undefined' && Number.isFinite(navigator.deviceMemory)
      ? Number(navigator.deviceMemory)
      : null);
  const mobile = mobileSignal;

  let score = isWebGL2 ? 3 : 1;
  if (maxTextureSize >= 8192) score += 2;
  else if (maxTextureSize >= 4096) score += 1;
  if (maxVertexTextures >= 16) score += 1;
  if (deviceMemoryGB != null && deviceMemoryGB >= 8) score += 1;
  if (deviceMemoryGB != null && deviceMemoryGB <= 2) score -= 2;
  if (LOW_GPU.test(name)) score -= 4;
  else if (HIGH_GPU.test(name)) score += 3;
  else if (MID_GPU.test(name)) score -= 1;
  if (mobile) score -= 1;

  const tier = score >= 10 ? 4 : (score >= 8 ? 3 : (score >= 5 ? 2 : (score >= 2 ? 1 : 0)));
  return Object.freeze({
    tier,
    tierName: GPU_TIER_NAMES[tier],
    sampleBudget: GPU_SAMPLE_BUDGETS[tier],
    source: 'webgl-heuristic',
    renderer: name,
    isWebGL2,
    maxTextureSize,
    maxVertexTextures,
    timerQuerySupported,
    deviceMemoryGB,
    mobile
  });
}

/**
 * Controlador de calidad sin reasignaciones: reduce o recupera gradualmente la
 * fracción de muestras visibles a partir del tiempo real de cuadro.
 */
export function createAdaptiveLodController(options = {}) {
  const enabled = options.enabled !== false;
  const targetFrameMs = Math.max(8, Number(options.targetFrameMs) || 16.67);
  const minimumFraction = clamp(Number(options.minimumFraction) || 0.10, 0.02, 1);
  // Techo: la fracción nunca pasa de aquí, y con tiempo de GPU medido tampoco
  // sube si el polvo ya gasta su presupuesto (por defecto, la mitad del cuadro).
  const maximumFraction = clamp(Number(options.maximumFraction) || 1, minimumFraction, 1);
  const gpuBudgetMs = Math.max(0.5, Number(options.gpuBudgetMs) || targetFrameMs * 0.5);
  let fraction = maximumFraction;
  let averageFrameMs = targetFrameMs;
  let averageGpuMs = null;
  let samples = 0;
  let cooldown = 0;
  let overloadStreak = 0;
  let recoveryStreak = 0;

  function update(deltaSeconds, gpuFrameMs = null) {
    if (!enabled || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || deltaSeconds > 0.25) {
      return fraction;
    }
    const frameMs = deltaSeconds * 1000;
    averageFrameMs += (frameMs - averageFrameMs) * 0.055;
    if (Number.isFinite(gpuFrameMs) && gpuFrameMs > 0 && gpuFrameMs < 250) {
      averageGpuMs = averageGpuMs == null
        ? gpuFrameMs
        : averageGpuMs + (gpuFrameMs - averageGpuMs) * 0.08;
    }
    samples += 1;
    cooldown = Math.max(0, cooldown - 1);
    if (samples < 45 || cooldown > 0) return fraction;

    const gpuLoad = averageGpuMs == null ? 0 : averageGpuMs / gpuBudgetMs;
    const load = Math.max(averageFrameMs / targetFrameMs, gpuLoad);
    overloadStreak = load > 1.16 ? overloadStreak + 1 : 0;
    recoveryStreak = load < 0.78 ? recoveryStreak + 1 : 0;

    if (overloadStreak >= 8) {
      fraction = Math.max(minimumFraction, fraction * 0.78);
      cooldown = 24;
      overloadStreak = 0;
      recoveryStreak = 0;
    } else if (recoveryStreak >= 30 && fraction < maximumFraction) {
      fraction = Math.min(maximumFraction, fraction + 0.06);
      cooldown = 45;
      overloadStreak = 0;
      recoveryStreak = 0;
    }
    return fraction;
  }

  function snapshot() {
    return Object.freeze({
      enabled,
      fraction,
      averageFrameMs,
      averageGpuMs,
      targetFrameMs,
      gpuBudgetMs,
      minimumFraction,
      maximumFraction
    });
  }

  return Object.freeze({ update, snapshot });
}

/**
 * Cronómetro no bloqueante para EXT_disjoint_timer_query. El consumidor llama
 * a begin()/end() alrededor de renderer.render() y poll() en cuadros posteriores.
 */
export function createGpuTimerQuery(renderer) {
  let gl = null;
  try {
    gl = renderer && typeof renderer.getContext === 'function' ? renderer.getContext() : null;
  } catch {
    gl = null;
  }
  if (!gl) return null;

  let extension = null;
  let webgl2 = false;
  try {
    extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    webgl2 = Boolean(extension && typeof gl.createQuery === 'function');
    if (!extension) extension = gl.getExtension('EXT_disjoint_timer_query');
  } catch {
    extension = null;
  }
  if (!extension) return null;

  const pending = [];
  let active = null;
  let disposed = false;
  let lastGpuMs = null;

  function createQuery() {
    return webgl2 ? gl.createQuery() : extension.createQueryEXT();
  }

  function deleteQuery(query) {
    if (!query) return;
    if (webgl2) gl.deleteQuery(query);
    else extension.deleteQueryEXT(query);
  }

  function begin() {
    if (disposed || active || pending.length >= 4) return false;
    const query = createQuery();
    if (!query) return false;
    active = query;
    if (webgl2) gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
    else extension.beginQueryEXT(extension.TIME_ELAPSED_EXT, query);
    return true;
  }

  function end() {
    if (disposed || !active) return false;
    if (webgl2) gl.endQuery(extension.TIME_ELAPSED_EXT);
    else extension.endQueryEXT(extension.TIME_ELAPSED_EXT);
    pending.push(active);
    active = null;
    return true;
  }

  function poll() {
    if (disposed || pending.length === 0) return lastGpuMs;
    const query = pending[0];
    const available = webgl2
      ? gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)
      : extension.getQueryObjectEXT(query, extension.QUERY_RESULT_AVAILABLE_EXT);
    const disjoint = Boolean(safeParameter(gl, extension.GPU_DISJOINT_EXT, false));
    if (!available) return lastGpuMs;
    pending.shift();
    if (!disjoint) {
      const nanoseconds = webgl2
        ? gl.getQueryParameter(query, gl.QUERY_RESULT)
        : extension.getQueryObjectEXT(query, extension.QUERY_RESULT_EXT);
      if (Number.isFinite(nanoseconds) && nanoseconds >= 0) lastGpuMs = nanoseconds / 1e6;
    }
    deleteQuery(query);
    return lastGpuMs;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (active) {
      try {
        if (webgl2) gl.endQuery(extension.TIME_ELAPSED_EXT);
        else extension.endQueryEXT(extension.TIME_ELAPSED_EXT);
      } catch {
        // El contexto puede haberse perdido durante el cuadro.
      }
      deleteQuery(active);
      active = null;
    }
    while (pending.length) deleteQuery(pending.shift());
  }

  function snapshot() {
    return Object.freeze({ supported: true, pending: pending.length, active: Boolean(active), lastGpuMs });
  }

  return Object.freeze({ begin, end, poll, snapshot, dispose });
}
