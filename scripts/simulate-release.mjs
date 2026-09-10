import fs from 'node:fs/promises';
import { waveForecast, pointState } from '../lib/engine.js';

const fixture = JSON.parse(await fs.readFile(new URL('../data/simulations/release-day.json', import.meta.url), 'utf8'));
const wave = waveForecast(fixture.onset, fixture.damCfs, fixture.meadowCfs);
console.log(`Simulation: ${fixture.name}`);
for (const cp of fixture.checkpoints) {
  const at = new Date(`2026-09-11T${cp.localTime}:00-04:00`).toISOString();
  const states = wave.filter(p => p.id !== 'dam').map(p => `${p.name}:${pointState(at,p)}`);
  console.log(`${cp.localTime} ET | ${cp.expected} | ${states.join(' | ')}`);
}
