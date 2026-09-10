import fs from 'node:fs/promises';
const file = new URL('../data/calibration.json', import.meta.url);
const data = JSON.parse(await fs.readFile(file, 'utf8'));
const errors = data.observedEvents.flatMap(e => (e.points || []).map(p => Math.abs(Number(p.predictedMinutes) - Number(p.observedMinutes))).filter(Number.isFinite));
if (!errors.length) {
  console.log('No observed release events recorded yet; calibration metrics intentionally unavailable.');
  process.exit(0);
}
errors.sort((a,b)=>a-b);
const median = errors.length % 2 ? errors[(errors.length-1)/2] : (errors[errors.length/2-1]+errors[errors.length/2])/2;
const p90 = errors[Math.min(errors.length-1, Math.ceil(errors.length*.9)-1)];
console.log(JSON.stringify({ modelVersion:data.modelVersion, observations:errors.length, medianAbsoluteErrorMinutes:median, p90AbsoluteErrorMinutes:p90 }, null, 2));
