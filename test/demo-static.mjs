/**
 * LA DEMO SIN DOM: el HTML, los créditos y licencias, el CSS y las funciones
 * puras del hash legible (demo/hash.js), probadas directamente en Node.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const leer = (f) => readFile(new URL('../' + f, import.meta.url), 'utf8');
const html = await leer('demo/index.html');
const script = await leer('demo/main.js');
const css = await leer('demo/panel.css');
const panel = await leer('demo/panel.js');
const readme = await leer('README.md');
const pkg = JSON.parse(await leer('package.json'));
const H = await import('../demo/hash.js');
const { normalizeDustGroupSpec } = await import('../src/system.js');
const { DUST_EXAMPLE_SCENES } = await import('../src/examples.js');

/* ------------------------------------------------------------------ la página */
assert.match(html, /<html lang="en">/, 'la demo va en inglés');
assert.match(html, /<div id="container"><\/div>/);
assert.match(html, /<div id="panel"><\/div>/);
for (const id of ['pause', 'randomize', 'fullscreen', 'ui-toggle']) {
  assert.match(html, new RegExp(`<button id="${id}" class="icon-button"`), `falta el botón #${id}`);
}
assert.match(html, /<link rel="stylesheet" href="\.\/panel\.css">/);
assert.match(html, /type="module" src="\.\/main\.js"/);
assert.match(html, /"three": "[^"]*three\.module\.js"/);
assert.match(html, /"three\/addons\/": "[^"]*examples\/jsm\/"/, 'el importmap lleva three/addons para el gizmo');
assert.doesNotMatch(html, /Ocultar|Guardar|Semilla|Motas|Escena|Sembrar|Tocar|Girar/, 'queda texto en castellano en index.html');
for (const t of ['←', '→', '<kbd>R</kbd>', '<kbd>Space</kbd>', '<kbd>Tab</kbd>', '<kbd>F</kbd>', 'double-click', 'double-tap', '<kbd>1</kbd>']) {
  assert.ok(html.includes(t), 'la tabla de teclas no dice ' + t);
}

/* ------------------------------------------------------------------ créditos y licencias */
assert.match(html, /id="credits"/, 'la demo no tiene créditos');
assert.match(html, /https:\/\/github\.com\/spite\/guspira/);
assert.match(html, /https:\/\/spite\.github\.io\/bumpy-metaballs-2026\//);
assert.match(html, /Credits\./);
assert.match(html, /MIT License/);
assert.match(css, /MIT License, Copyright \(c\) 2026 Jaume Sanchez/, 'panel.css no lleva el aviso de guspira');
assert.match(css, /MIT License, Copyright \(c\) 2022 thespite/, 'panel.css no lleva el aviso de bumpy-metaballs-2026');
assert.match(css, /Permission is hereby granted, free of charge/, 'panel.css no lleva el texto de la licencia MIT');
assert.match(panel, /guspira/);
assert.match(readme, /## Credits[\s\S]*guspira[\s\S]*MIT/, 'el README no acredita guspira con su licencia');
assert.match(readme, /## Credits[\s\S]*bumpy-metaballs-2026/, 'el README no acredita bumpy-metaballs-2026');
for (const c of ['.gui-randomizable', '.gui-tab-btn', '.gui-section-title', '.icon-button', 'body.ui-hidden', '@media (max-width: 600px)', '.stat-value']) {
  assert.ok(css.includes(c), 'panel.css no tiene ' + c);
}
for (const f of ['demo/main.js', 'demo/panel.js', 'demo/hash.js', 'demo/post.js']) {
  assert.ok(pkg.scripts.check.includes(f), 'npm run check no comprueba ' + f);
}
assert.match(script, /createDustSystem/);
assert.match(script, /from 'three\/addons\/controls\/TransformControls\.js'/);
assert.match(script, /window\.nebulaDustDemo/);

/* ------------------------------------------------------------------ el hash: enlaces viejos */
assert.deepEqual(H.parseHash(''), { kind: 'empty' });
assert.deepEqual(H.parseHash('#'), { kind: 'empty' });
assert.deepEqual(H.parseHash('#s=zAbC'), { kind: 'compressed', text: 'zAbC' });
assert.deepEqual(H.parseHash('#orion'), { kind: 'name', preset: 'orion' });
assert.deepEqual(H.parseHash('#m42'), { kind: 'name', preset: 'orion' });
assert.deepEqual(H.parseHash('#M1'), { kind: 'name', preset: 'crab' });
assert.deepEqual(H.parseHash('#collision'), { kind: 'name', scene: 'collision' });
assert.deepEqual(H.parseHash('#choque'), { kind: 'name', scene: 'collision' });
assert.deepEqual(H.parseHash('#nebulosa'), { kind: 'name', scene: 'twinNebula' });
assert.deepEqual(H.parseHash('#no-existe'), { kind: 'name', unknown: 'no-existe' });

/* ------------------------------------------------------------------ semillas con su tipo */
assert.equal(H.printSeed(3), '3');
assert.equal(H.printSeed('3'), '"3"');
assert.equal(H.printSeed('0042'), '0042');
assert.equal(H.printSeed('m42-orion'), 'm42-orion');
assert.equal(H.parseSeed('3'), 3);
assert.equal(H.parseSeed('"3"'), '3');
assert.equal(H.parseSeed('0042'), '0042');
assert.equal(H.parseSeed('4294967296'), '4294967296', 'más que un uint32 no es un número de semilla');
assert.equal(H.parseSeed(''), undefined);
assert.equal(H.parseSeed('""'), undefined);

/* ------------------------------------------------------------------ lo que se escribe */
const norm = (g, i) => normalizeDustGroupSpec({ ...g, id: g.id || 'g' + (i + 1) }, null, 'dust-' + (g.id || 'g' + (i + 1)));
const ejemplo = (k) => DUST_EXAMPLE_SCENES[k].groups.map(norm);
const estado = (groups, extra = {}) => ({ groups, view: H.DEFAULT_VIEW, render: { ...H.RENDER_DEFAULTS }, selected: 0, scene: null, ...extra });

/* un ejemplo sin tocar es solo su nombre */
for (const k of Object.keys(DUST_EXAMPLE_SCENES)) {
  assert.equal(H.encodeHash(estado(ejemplo(k), { scene: k, view: H.exampleView(k) })), 'scene=' + k);
}
/* un preset sin tocar, #preset=orion; la escena vacía, #scene=empty */
assert.equal(H.encodeHash(estado(H.presetScene('orion').groups.map(norm))), 'preset=orion');
assert.equal(H.encodeHash(estado([])), 'scene=empty');
/* un grupo en blanco existe aunque no tenga nada que decir */
assert.equal(H.encodeHash(estado([norm({ radius: H.DEMO_RADIUS }, 0)])), 'preset=none');
/* un grupo añadido a un ejemplo: el ejemplo sigue siendo la base */
{
  const g = [...ejemplo('collision'), norm({ radius: H.DEMO_RADIUS }, 4)];
  assert.equal(H.encodeHash(estado(g, { scene: 'collision', view: H.exampleView('collision') })), 'scene=collision&g5.preset=none');
  const p = H.parseHash('#scene=collision&g5.preset=none');
  assert.equal(p.scene.groups.length, 5);
  assert.equal(p.example, 'collision');
}
/* el ejemplo del usuario: #preset=orion&seed=3&samples=262144&opacity=0.7, ida y vuelta */
{
  const texto = 'preset=orion&seed=3&samples=262144&opacity=0.7';
  const p = H.parseHash('#' + texto);
  assert.equal(p.kind, 'params');
  assert.deepEqual(p.warnings, []);
  const [g] = p.scene.groups;
  assert.equal(g.preset, 'orion');
  assert.equal(g.seed, 3);
  assert.equal(g.count, 262144);
  assert.equal(g.opacity, 0.7);
  assert.equal(H.encodeHash(estado(p.scene.groups)), texto);
}
/* los ajustes de render: solo los que cambian, recortados a su rango, los malos avisados */
{
  const p = H.parseHash('#exposure=99&aces=0&bloom=abc&halfres=1&fps=30&budget=1000000&quality=high&layers=2');
  assert.equal(p.onlyRender, true);
  assert.equal(p.render.exposure, H.RENDER_SPEC.exposure.max);
  assert.equal(p.render.aces, false);
  assert.equal(p.render.halfres, true);
  assert.equal(p.render.fps, 30);
  assert.equal(p.render.budget, 1000000);
  assert.equal(p.render.quality, 'high');
  assert.equal(p.render.layers, '2');
  assert.ok(!('bloom' in p.render));
  assert.deepEqual(p.warnings, ['bloom']);
  const r = { ...H.RENDER_DEFAULTS, exposure: 12, grain: 0, spin: false };
  assert.equal(H.encodeHash(estado(H.presetScene('orion').groups.map(norm), { render: r })), 'preset=orion&exposure=12&grain=0&spin=0');
  for (const [k, d] of Object.entries(H.RENDER_SPEC)) {
    assert.match(k, /^[a-z]+$/, 'nombre de render poco legible: ' + k);
    if (d.kind === 'num') assert.ok(d.def >= d.min && d.def <= d.max, k + ' fuera de su rango');
  }
}
/* lo que no se entiende se avisa y no rompe el resto */
{
  const p = H.parseHash('#preset=orion&foo=1&opacity=abc&g2.preset=noexiste&view=1,2&sel=9');
  assert.deepEqual(p.warnings.sort(), ['foo', 'g2.preset', 'opacity', 'sel', 'view'].sort());
  assert.equal(p.scene.groups[0].preset, 'orion');
}
/* una escena de todo tipo: ida y vuelta completa, y legible */
{
  const grupos = [
    norm({ preset: 'crab', seed: 'crab-7', count: 65536, colors: ['#ff0000', '#00ff88', '#0000ff'], tint: '#ffeecc', opacity: 0.55, size: 1.4, maxPointSize: 6.5, position: [0.12345678, -0.5, 1], rotation: [0.1, -0.2, 0.3], scale: [0.5, 0.6, 0.7], order: 3, flowSpeed: 1.2, motion: 0.3, name: 'Hot & dusty, 50%' }, 0),
    norm({ morphology: 'pinwheel', palette: 'hotDust', radius: 0.8, shape: { spiralPitch: 0.3, spiralSense: -1, armWidth: 0.1 }, layer: 2, visible: false, blending: 'additive', volumeProfile: 'dense' }, 1),
    norm({ preset: 'supernovaExplosion', evolution: 0.4, evolutionRate: 0, seed: 42, physicalGrainCount: 1e20 }, 2),
    norm({ morphology: 'clumpyShell', shape: { shellInner: 0.2, plumeCount: 3 }, seed: '42' }, 3)
  ];
  const vista = { target: [0.1, -0.2, 0.3], azimuth: 0.7, elevation: -0.3, distance: 5.5 };
  const render = { ...H.RENDER_DEFAULTS, exposure: 10.5, aces: false, bloom: 1.2, bloomradius: 0.8, bloomthreshold: 0.6, grain: 0.05, vignette: 0.4, quality: 'detailed', budget: 500000, fps: 120, halfres: true, adaptive: false, cull: true, dustgrains: 'mass', spin: false, layers: '1' };
  const texto = H.encodeHash(estado(grupos, { view: vista, render, selected: 2 }));
  assert.doesNotMatch(texto, /(^|&)s=/);
  assert.match(texto, /^preset=crab&name=Hot\+%26\+dusty,\+50%25&seed=crab-7&samples=65536&colors=ff0000,00ff88,0000ff&tint=ffeecc/);
  for (const trozo of ['g2.shape=pinwheel', 'g2.hidden=1', 'g2.layer=2', 'g2.pitch=0.3', 'g2.sense=-1', 'g3.seed=42', 'g4.seed=%2242%22', 'g4.shellin=0.2', 'view=40.107,-17.189,5.5,0.1,-0.2,0.3', 'sel=3', 'dustgrains=mass', 'layers=1']) {
    assert.ok(texto.includes(trozo), 'el hash no lleva ' + trozo + ': ' + texto);
  }
  const p = H.parseHash('#' + texto);
  assert.deepEqual(p.warnings, []);
  assert.equal(p.onlyRender, false);
  assert.equal(p.scene.groups.length, 4);
  p.scene.groups.forEach((g, i) => {
    for (const [k, v] of Object.entries(grupos[i])) {
      if (k === 'id') continue;
      const w = g[k];
      if (typeof v === 'number') assert.ok(Math.abs(v - w) <= 1e-4 * Math.max(1, Math.abs(v)), `grupo ${i + 1}.${k}: ${v} → ${w}`);
      else if (Array.isArray(v) && typeof v[0] === 'number') v.forEach((x, j) => assert.ok(Math.abs(x - w[j]) <= 1e-4, `grupo ${i + 1}.${k}[${j}]: ${x} → ${w[j]}`));
      else assert.deepEqual(w, v, `grupo ${i + 1}.${k}`);
    }
  });
  assert.equal(typeof p.scene.groups[2].seed, 'number');
  assert.equal(typeof p.scene.groups[3].seed, 'string');
  assert.deepEqual(p.render, render);
  assert.equal(p.selected, 2);
  assert.ok(Math.abs(p.scene.view.azimuth - 0.7) < 1e-4 && Math.abs(p.scene.view.elevation + 0.3) < 1e-4 && p.scene.view.distance === 5.5);
  /* y leer lo escrito y volver a escribirlo da lo mismo */
  assert.equal(H.encodeHash(estado(p.scene.groups, { view: p.scene.view, render: { ...H.RENDER_DEFAULTS, ...p.render }, selected: p.selected })), texto);
}

console.log('Demo estática y hash legible: OK');
