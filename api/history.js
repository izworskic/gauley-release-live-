import { modeledReleaseDatesForYear } from '../lib/schedule.js';

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos=(sorted.length-1)*q, base=Math.floor(pos), rest=pos-base;
  return sorted[base+1] !== undefined ? sorted[base] + rest*(sorted[base+1]-sorted[base]) : sorted[base];
}

export default async function handler(req,res) {
  res.setHeader('Cache-Control','public, s-maxage=86400, stale-while-revalidate=604800');
  const url='https://waterservices.usgs.gov/nwis/dv/?format=json&sites=03192000&parameterCd=00060&startDT=2010-01-01&endDT=2025-12-31&siteStatus=all';
  try {
    const r=await fetch(url,{headers:{'User-Agent':'GauleyReleaseLive/1.0'}});
    if(!r.ok) throw new Error(`USGS ${r.status}`);
    const j=await r.json();
    const rows=j?.value?.timeSeries?.[0]?.values?.[0]?.value||[];
    const releaseDates=new Set();
    for(let y=2010;y<=2025;y++) for(const d of modeledReleaseDatesForYear(y)) releaseDates.add(d);
    const sample=rows.filter(v=>releaseDates.has(String(v.dateTime).slice(0,10))).map(v=>Number(v.value)).filter(Number.isFinite).sort((a,b)=>a-b);
    res.status(200).json({
      source:url,
      method:'USGS Belva daily mean discharge filtered to the recurring Gauley-season release-day calendar pattern; intended for broad context, not rapid-level safety decisions.',
      sampleCount:sample.length,
      p25:Math.round(quantile(sample,.25)),
      median:Math.round(quantile(sample,.5)),
      p75:Math.round(quantile(sample,.75)),
      p90:Math.round(quantile(sample,.9)),
      sample
    });
  } catch (e) {
    res.status(502).json({error:'Historical baseline unavailable', detail:String(e.message||e)});
  }
}
