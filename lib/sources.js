const UA = 'GauleyReleaseLive/1.0 (public recreation information; contact via chrisizworski.com)';

async function fetchWithTimeout(url, options={}, ms=7000) {
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal:controller.signal, headers:{ 'User-Agent':UA, 'Accept':'application/json,text/html;q=0.9,*/*;q=0.8', ...(options.headers||{}) } });
  } finally { clearTimeout(t); }
}

export async function fetchJson(url, options={}) {
  const r = await fetchWithTimeout(url, options);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

export async function fetchText(url, options={}) {
  const r = await fetchWithTimeout(url, options);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

function parseUsgs(json) {
  const result = {};
  for (const ts of json?.value?.timeSeries || []) {
    const site = ts?.sourceInfo?.siteCode?.[0]?.value;
    const code = ts?.variable?.variableCode?.[0]?.value;
    if (!site || !code) continue;
    const rows = (ts?.values?.[0]?.value || []).map(v => ({ time:v.dateTime, value:Number(v.value), qualifiers:v.qualifiers||[] })).filter(v=>Number.isFinite(v.value));
    result[site] ||= {};
    result[site][code] = rows;
  }
  return result;
}

export async function getUSGS() {
  const url = 'https://waterservices.usgs.gov/nwis/iv/?format=json&sites=03189600,03192000,03190000&parameterCd=00060,00065,00045&period=P1D&siteStatus=all';
  const json = await fetchJson(url);
  return { url, data:parseUsgs(json) };
}

function last(rows=[]) { return rows.length ? rows[rows.length-1] : null; }
export function latestUSGS(parsed, site, code) { return last(parsed?.[site]?.[code] || []); }
export function seriesUSGS(parsed, site, code) { return parsed?.[site]?.[code] || []; }

function numericAfter(label, html) {
  const compact = html.replace(/&nbsp;/gi,' ').replace(/,/g,'');
  const patterns = [
    new RegExp(`${label}[\\s\\S]{0,700}?([0-9]+(?:\\.[0-9]+)?)\\s*(?:cfs|ft)`, 'i'),
    new RegExp(`"(?:name|label|parameter)"\\s*:\\s*"${label}"[\\s\\S]{0,500}?"(?:value|latestValue)"\\s*:\\s*"?([0-9]+(?:\\.[0-9]+)?)`, 'i')
  ];
  for (const p of patterns) { const m = compact.match(p); if (m) return Number(m[1]); }
  return null;
}

function entryLatestTime(entry) {
  const times = (entry?.extents || []).map(e => Date.parse(e?.['latest-time'] || '')).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function scoreCwmsEntry(entry, kind) {
  const n = String(entry?.name || '').toLowerCase();
  if (!n.includes('summ')) return -999;
  let score = 0;
  if (/summersville/.test(n)) score += 40;
  if (/inst/.test(n)) score += 8;
  if (/15minute|30minute|1hour/.test(n)) score += 5;
  if (/raw|rev|report/.test(n)) score += 2;
  if (/gate|spill|tailwater|elev-tail/.test(n) && kind !== 'elevation') score -= 35;
  if (kind === 'outflow') {
    if (/flow-out|flow-res out|outflow/.test(n)) score += 55;
    if (/flow-in|inflow/.test(n)) score -= 50;
  } else if (kind === 'inflow') {
    if (/flow-in|inflow/.test(n)) score += 55;
    if (/flow-out|outflow/.test(n)) score -= 50;
  } else if (kind === 'elevation') {
    if (/\.elev\.|elevation/.test(n)) score += 45;
    if (/tail|spill|gate/.test(n)) score -= 40;
  }
  const latest = Date.parse(entryLatestTime(entry) || '');
  if (Number.isFinite(latest)) score += Math.max(-20, Math.min(20, (latest - Date.now()) / 86400000 + 10));
  return score;
}

async function discoverSummersvilleSeries() {
  const base = 'https://cwms-data.usace.army.mil/cwms-data/catalog/timeseries';
  const patterns = ['Summersville-Lake.*','Summersville.*','SUMMERSVILLE.*','.*Summersville.*'];
  let entries = [];
  for (const like of patterns) {
    const u = new URL(base); u.searchParams.set('office','LRH'); u.searchParams.set('like',like);
    try {
      const j = await fetchJson(u.toString(), { headers:{ Accept:'application/json;version=2' } });
      const found = j?.entries || j?.['time-series'] || [];
      if (found.length) { entries = found; break; }
    } catch { /* fallback to next pattern / public page */ }
  }
  const choose = kind => entries.map(e=>({e,score:scoreCwmsEntry(e,kind)})).sort((a,b)=>b.score-a.score)[0]?.e || null;
  return { entries, outflow:choose('outflow'), inflow:choose('inflow'), elevation:choose('elevation') };
}

async function fetchCwmsLatest(entry, unit) {
  if (!entry?.name) return null;
  const u = new URL('https://cwms-data.usace.army.mil/cwms-data/timeseries');
  u.searchParams.set('office', entry.office || 'LRH');
  u.searchParams.set('name', entry.name);
  u.searchParams.set('begin','PT-12H');
  if (unit) u.searchParams.set('unit',unit);
  const j = await fetchJson(u.toString(), { headers:{ Accept:'application/json;version=2' } });
  const rows = Array.isArray(j?.values) ? j.values : [];
  const usable = rows.filter(v => Array.isArray(v) && Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1])));
  if (!usable.length) return null;
  const r = usable[usable.length-1];
  return { value:Number(r[1]), time:new Date(Number(r[0])).toISOString(), quality:r[2] ?? null, name:entry.name, url:u.toString() };
}

export async function getUSACE() {
  const pageUrl = 'https://water.usace.army.mil/overview/lrh/locations/summersville';
  try {
    const catalog = await discoverSummersvilleSeries();
    if (catalog.entries.length) {
      const [outflow, inflow, elevation] = await Promise.all([
        fetchCwmsLatest(catalog.outflow,'cfs').catch(()=>null),
        fetchCwmsLatest(catalog.inflow,'cfs').catch(()=>null),
        fetchCwmsLatest(catalog.elevation,'ft').catch(()=>null)
      ]);
      if (outflow || inflow || elevation) {
        return {
          url:pageUrl,
          apiUrl:'https://cwms-data.usace.army.mil/cwms-data/',
          method:'CWMS Data API',
          outflowCfs:outflow?.value ?? null,
          outflowObservedAt:outflow?.time ?? entryLatestTime(catalog.outflow),
          outflowSeries:outflow?.name ?? catalog.outflow?.name ?? null,
          inflowCfs:inflow?.value ?? null,
          inflowObservedAt:inflow?.time ?? entryLatestTime(catalog.inflow),
          lakeElevationFt:elevation?.value ?? null,
          elevationObservedAt:elevation?.time ?? entryLatestTime(catalog.elevation),
          fetchedAt:new Date().toISOString()
        };
      }
    }
  } catch { /* fall through to public-page parser */ }

  const html = await fetchText(pageUrl, { headers:{ Accept:'text/html' } });
  return {
    url:pageUrl,
    method:'USACE public page fallback',
    outflowCfs:numericAfter('Outflow', html),
    outflowObservedAt:null,
    inflowCfs:numericAfter('Inflow', html),
    inflowObservedAt:null,
    lakeElevationFt:numericAfter('Elevation', html),
    elevationObservedAt:null,
    fetchedAt:new Date().toISOString()
  };
}

function windToMph(s='') {
  const m = String(s).match(/(\d+)\s*(?:to\s*(\d+)\s*)?mph/i);
  if (!m) return null;
  const a=Number(m[1]), b=m[2]?Number(m[2]):a; return (a+b)/2;
}

function normalizeHourlyPeriod(h){
  return {
    startTime:h?.startTime ?? null,
    temperatureF:Number.isFinite(Number(h?.temperature))?Number(h.temperature):null,
    shortForecast:h?.shortForecast ?? null,
    wind:h?.windSpeed ?? null,
    windMph:windToMph(h?.windSpeed),
    precipProbability:Number.isFinite(Number(h?.probabilityOfPrecipitation?.value))?Number(h.probabilityOfPrecipitation.value):null,
    isDaytime:Boolean(h?.isDaytime)
  };
}

export async function getWeather() {
  const point = await fetchJson('https://api.weather.gov/points/38.2151,-80.8882');
  const hourlyUrl = point?.properties?.forecastHourly;
  const alertsUrl = 'https://api.weather.gov/alerts/active?point=38.2151,-80.8882';
  const [hourly, alerts] = await Promise.all([
    hourlyUrl ? fetchJson(hourlyUrl).catch(()=>null) : Promise.resolve(null),
    fetchJson(alertsUrl).catch(()=>({features:[]}))
  ]);
  const rawPeriods=hourly?.properties?.periods||[];
  const periods=rawPeriods.slice(0,72).map(normalizeHourlyPeriod);
  const h = periods[0] || null;
  return {
    sourceUrl:hourlyUrl || 'https://api.weather.gov',
    temperatureF:h?.temperatureF ?? null,
    shortForecast:h?.shortForecast ?? null,
    wind:h?.wind ?? null,
    windMph:h?.windMph ?? null,
    precipProbability:h?.precipProbability ?? null,
    observedAt:h?.startTime ?? null,
    periods,
    alerts:(alerts?.features||[]).map(a=>({ event:a?.properties?.event, severity:a?.properties?.severity, headline:a?.properties?.headline, ends:a?.properties?.ends }))
  };
}

export async function getNpsAlerts() {
  if (!process.env.NPS_API_KEY) return { enabled:false, alerts:[] };
  const url = `https://developer.nps.gov/api/v1/alerts?parkCode=gari&limit=50&api_key=${encodeURIComponent(process.env.NPS_API_KEY)}`;
  const j = await fetchJson(url);
  return { enabled:true, url:'https://www.nps.gov/gari/planyourvisit/conditions.htm', alerts:(j?.data||[]).map(a=>({ title:a.title, description:a.description, category:a.category, url:a.url })) };
}
