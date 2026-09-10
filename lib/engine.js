import { WAYPOINTS, MEADOW_CONFLUENCE_MILE } from './geometry.js';

export function freshness(iso, now = new Date()) {
  if (!iso) return { label:'UNKNOWN', ageMinutes:null, stale:true };
  const ageMinutes = Math.max(0, (now - new Date(iso)) / 60000);
  if (ageMinutes <= 15) return { label:'CURRENT', ageMinutes, stale:false };
  if (ageMinutes <= 30) return { label:'RECENT', ageMinutes, stale:false };
  if (ageMinutes <= 60) return { label:'DELAYED', ageMinutes, stale:true };
  return { label:'STALE', ageMinutes, stale:true };
}

function median(values) {
  const a = values.filter(Number.isFinite).sort((x,y)=>x-y);
  if (!a.length) return null;
  const m = Math.floor(a.length/2);
  return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
}

export function recentObservations(series = [], now = new Date(), maxAgeHours = 18) {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return [];
  const cutoff = nowMs - maxAgeHours * 3600000;
  return series.filter(r => {
    const t = r?.time ? new Date(r.time).getTime() : NaN;
    return Number.isFinite(t) && t >= cutoff && t <= nowMs + 5 * 60000;
  });
}

export function detectReleaseOnset(stageSeries = []) {
  const rows = stageSeries.filter(r => Number.isFinite(r.value) && r.time).sort((a,b)=>new Date(a.time)-new Date(b.time));
  if (rows.length < 6) return { onset:null, confidence:0, reason:'Not enough tailwater observations' };
  const baselineRows = rows.slice(0, Math.max(4, Math.floor(rows.length * 0.35)));
  const baseline = median(baselineRows.map(r => r.value));
  if (!Number.isFinite(baseline)) return { onset:null, confidence:0, reason:'No usable baseline' };

  for (let i=2; i<rows.length-1; i++) {
    const rise = rows[i].value - baseline;
    const dtMin = (new Date(rows[i].time) - new Date(rows[i-2].time))/60000;
    const slope = dtMin > 0 ? (rows[i].value - rows[i-2].value) / dtMin : 0;
    const persists = rows[i+1].value >= rows[i].value - 0.05;
    if (rise >= 0.45 && slope >= 0.004 && persists) {
      return { onset:rows[i].time, confidence:82, baseline, rise, reason:'Sustained tailwater stage rise detected' };
    }
  }
  return { onset:null, confidence:25, baseline, reason:'No sustained release-shaped stage rise detected' };
}

export const MEADOW_NALLEN_TO_MOUTH_MILES = 11.0;

export function meadowTravelMinutes(nallenCfs) {
  // Initial routing proxy only: Nallen is USGS river mile 11.0 on the Meadow.
  // Velocity is deliberately bounded and the resulting contribution remains labeled modeled.
  const q = Math.max(1, Number(nallenCfs) || 1);
  const speedMph = Math.max(1.0, Math.min(4.0, 1.0 + Math.sqrt(q / 1000) * 2.2));
  return (MEADOW_NALLEN_TO_MOUTH_MILES / speedMph) * 60;
}

export function lagAlignedObservation(series = [], now = new Date(), lagMinutes = 0) {
  const target = new Date(now).getTime() - Math.max(0, Number(lagMinutes) || 0) * 60000;
  let best = null;
  let bestDelta = Infinity;
  for (const row of series) {
    const t = row?.time ? new Date(row.time).getTime() : NaN;
    if (!Number.isFinite(t) || !Number.isFinite(row?.value)) continue;
    const delta = Math.abs(t - target);
    if (delta < bestDelta) { best = row; bestDelta = delta; }
  }
  if (!best) return null;
  return { ...best, targetTime:new Date(target).toISOString(), alignmentDeltaMinutes:bestDelta/60000, lagMinutes };
}

export function classifyFlow(cfs) {
  if (!Number.isFinite(cfs)) return { label:'FLOW UNKNOWN', band:'unknown' };
  if (cfs < 2200) return { label:'BELOW A STANDARD RELEASE', band:'low' };
  if (cfs < 3000) return { label:'TYPICAL RELEASE RANGE', band:'typical' };
  if (cfs < 3600) return { label:'ABOVE A STANDARD RELEASE', band:'above' };
  return { label:'BIG GAULEY CONDITIONS', band:'big' };
}

export function arrivalMinutes(riverMile, effectiveCfs=2800) {
  const base = 12 + riverMile * 15.0;
  const flowFactor = Math.min(1.22, Math.max(0.82, Math.pow(2800 / Math.max(1200, effectiveCfs), 0.18)));
  return base * flowFactor;
}

export function waveForecast(onsetIso, damCfs=2800, meadowCfs=0) {
  if (!onsetIso) return [];
  const t0 = new Date(onsetIso).getTime();
  const upperCfs = Number.isFinite(damCfs) ? damCfs : 2800;
  const tributaryCfs = Number.isFinite(meadowCfs) && meadowCfs > 0 ? meadowCfs : 0;
  const belowMeadowCfs = upperCfs + tributaryCfs;
  const toConfluence = arrivalMinutes(MEADOW_CONFLUENCE_MILE, upperCfs);

  return WAYPOINTS.map(p => {
    let minutes = 0;
    if (p.id !== 'dam') {
      if (p.riverMile <= MEADOW_CONFLUENCE_MILE) {
        minutes = arrivalMinutes(p.riverMile, upperCfs);
      } else {
        // Route the dam pulse to the confluence first, then use the higher post-confluence
        // flow for downstream travel. Difference form removes arrivalMinutes' startup offset.
        minutes = toConfluence + (arrivalMinutes(p.riverMile, belowMeadowCfs) - arrivalMinutes(MEADOW_CONFLUENCE_MILE, belowMeadowCfs));
      }
    }
    const uncertainty = p.riverMile < 3 ? 18 : p.riverMile < 10 ? 28 : 42;
    const best = new Date(t0 + minutes*60000);
    return {
      ...p,
      estimatedFlowCfs: p.riverMile < MEADOW_CONFLUENCE_MILE ? upperCfs : belowMeadowCfs,
      arrivalBest: best.toISOString(),
      arrivalStart: new Date(best.getTime()-uncertainty*60000).toISOString(),
      arrivalEnd: new Date(best.getTime()+uncertainty*60000).toISOString(),
      uncertaintyMinutes: uncertainty
    };
  });
}

export function pointState(nowIso, point) {
  const now = new Date(nowIso).getTime();
  const start = new Date(point.arrivalStart).getTime();
  const end = new Date(point.arrivalEnd).getTime();
  if (now < start - 30*60000) return 'FORECAST';
  if (now < start) return 'APPROACHING';
  if (now <= end) return 'HERE NOW';
  return 'PASSED';
}

export function conditionsIndex({ releaseConfirmed, effectiveCfs, weather, activeWarnings=0, dataConfidence=50, accessAlert=false }) {
  let score = 45;
  if (releaseConfirmed) score += 28;
  if (Number.isFinite(effectiveCfs)) {
    if (effectiveCfs >= 2400 && effectiveCfs <= 3400) score += 12;
    else if (effectiveCfs > 3400) score += 6;
  }
  const pop = Number(weather?.precipProbability);
  if (Number.isFinite(pop)) score += Math.max(0, 7 - pop * 0.07);
  const wind = Number(weather?.windMph);
  if (Number.isFinite(wind)) score += Math.max(0, 5 - Math.max(0, wind-5)*0.25);
  score += Math.max(0, Math.min(7, dataConfidence*0.07));
  if (activeWarnings > 0) score -= 20;
  if (accessAlert) score -= 8;
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function percentile(value, sample=[]) {
  const vals = sample.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!vals.length || !Number.isFinite(value)) return null;
  let below = 0; for (const v of vals) if (v <= value) below++;
  return Math.round((below / vals.length) * 100);
}
