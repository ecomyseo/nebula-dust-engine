/**
 * Punto de entrada del paquete: el motor, los presets, el sistema de grupos
 * y las escenas de ejemplo. Cada parte también se puede importar sola
 * ('nebula-dust-engine/core', '/presets', '/system', '/examples').
 */
export * from './index.js';
export * from './presets.js';
export * from './system.js';
export * from './examples.js';
export { createNebulaDustEngine as default } from './index.js';
