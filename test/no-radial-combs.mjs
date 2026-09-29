import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNebulaDustEngine } from '../src/index.js';

const engineSource = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
assert.doesNotMatch(engineSource, /\bfamily\s*=/, 'No deben reaparecer familias angulares discretas.');
assert.doesNotMatch(engineSource, /theta\s*\*\s*\d/, 'No debe reaparecer una frecuencia angular periódica.');

function angularSpectrum(morphology) {
  // Los penachos de clumpyShell son cinco rasgos sueltos a propósito, no un
  // peine: aquí se mide solo su campo de grumos, que no debe ser periódico.
  const engine = createNebulaDustEngine({
    morphology,
    sampleCount: 50000,
    seed: 'anti-comb-regression',
    adaptive: false,
    plumeCount: morphology === 'clumpyShell' ? 0 : undefined
  });
  const positions = engine.points.geometry.getAttribute('position').array;
  const samples = [];
  let meanRadius = 0;

  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const angle = Math.atan2(y, x);
    const radius = Math.hypot(x, y);
    samples.push([angle, radius]);
    meanRadius += radius;
  }
  meanRadius /= samples.length;

  let maximumDensityHarmonic = 0;
  let maximumRadiusHarmonic = 0;
  for (let harmonic = 5; harmonic <= 18; harmonic++) {
    let densityReal = 0;
    let densityImaginary = 0;
    let radiusReal = 0;
    let radiusImaginary = 0;
    let radiusNormalization = 0;
    for (const [angle, radius] of samples) {
      const cosine = Math.cos(harmonic * angle);
      const sine = Math.sin(harmonic * angle);
      const radiusDelta = radius - meanRadius;
      densityReal += cosine;
      densityImaginary += sine;
      radiusReal += radiusDelta * cosine;
      radiusImaginary += radiusDelta * sine;
      radiusNormalization += Math.abs(radiusDelta);
    }
    maximumDensityHarmonic = Math.max(
      maximumDensityHarmonic,
      Math.hypot(densityReal, densityImaginary) / samples.length
    );
    maximumRadiusHarmonic = Math.max(
      maximumRadiusHarmonic,
      Math.hypot(radiusReal, radiusImaginary) / Math.max(radiusNormalization, 1e-9)
    );
  }
  engine.dispose();
  return { maximumDensityHarmonic, maximumRadiusHarmonic };
}

for (const morphology of [
  'diffuse',
  'orion',
  'lion',
  'crab',
  'galaxy',
  'oort',
  'supernovaEjecta',
  'whiteDwarfAccretion',
  'clumpyShell'
]) {
  const spectrum = angularSpectrum(morphology);
  assert.ok(
    spectrum.maximumDensityHarmonic < 0.12,
    morphology + ': se detectaron familias angulares discretas.'
  );
  assert.ok(
    spectrum.maximumRadiusHarmonic < 0.045,
    morphology + ': se detectó una modulación radial periódica.'
  );
}

const pillars = createNebulaDustEngine({
  morphology: 'pillars',
  sampleCount: 50000,
  seed: 'four-cloud-regression',
  adaptive: false
});
const positions = pillars.points.geometry.getAttribute('position').array;
const cloudZones = [0, 0, 0, 0];
for (let index = 0; index < positions.length; index += 3) {
  const x = positions[index];
  const y = positions[index + 1];
  if (y >= -0.45) continue;
  const zone = x < -0.35 ? 0 : (x < 0.02 ? 1 : (x < 0.36 ? 2 : 3));
  cloudZones[zone] += 1;
}
assert.ok(cloudZones.every((count) => count > 500), 'Pilares debe conservar cuatro nubes diferenciadas.');
pillars.dispose();

console.log('Morfologías sin peines radiales: OK');
