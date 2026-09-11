import { WAYPOINTS, RIVER_CORRIDOR } from '/lib/geometry.js';

const $ = id => document.getElementById(id);
let live = null;
let history = null;
let map = null;
let markerById = new Map();
let currentPersona = 'paddler';
let pulseMarker = null;
let scrubMinutes = null;
let personaActionTarget = '#map-section';
let priorVisit = null;
let storedVisit = false;
try {
  currentPersona = localStorage.getItem('gauleyPersona') || 'paddler';
  priorVisit = JSON.parse(localStorage.getItem('gauleyLastVisit') || 'null');
} catch {}

function finiteNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const value = Number(v);
  return Number.isFinite(value) ? value : null;
}
function fmtNum(v, suffix='') { const value=finiteNumber(v); return value===null ? '—' : `${Math.round(value).toLocaleString()}${suffix}`; }
function fmtTime(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}).format(new Date(iso));
}
function fmtDate(date) {
  if (!date) return 'Season complete';
  const d = new Date(`${date}T12:00:00-04:00`);
  return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long',month:'short',day:'numeric'}).format(d);
}
function pctFor(v, sample) {
  if (!Number.isFinite(v) || !Array.isArray(sample) || !sample.length) return null;
  return Math.round(sample.filter(x=>Number(x)<=v).length / sample.length * 100);
}
function conditionWord(score) {
  if (score >= 90) return 'Very favorable observed and forecast inputs';
  if (score >= 78) return 'Favorable environmental inputs';
  if (score >= 62) return 'Mixed environmental inputs';
  if (score >= 45) return 'Limited environmental inputs';
  return 'Important constraints in the current picture';
}
function track(name,params={}) { try { if(typeof window.gtag==='function') window.gtag('event',name,params); } catch {} }
function formatMorning(m){
  if(!m)return 'Forecast window unavailable';
  const temp=Number.isFinite(m.temperatureLowF)&&Number.isFinite(m.temperatureHighF)?`${Math.round(m.temperatureLowF)}–${Math.round(m.temperatureHighF)}°F`:null;
  const pop=Number.isFinite(m.precipMaxPct)?`${Math.round(m.precipMaxPct)}% precip max`:null;
  return [temp,m.shortForecast,pop].filter(Boolean).join(' · ')||'NWS forecast available';
}

async function getJSON(url) {
  const r = await fetch(url,{cache:'no-store'});
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

function initMap() {
  if (!window.L) { $('map').innerHTML='<div style="padding:30px">Map library could not load. Live river data remains available above.</div>'; return; }
  map=L.map('map',{zoomControl:true,scrollWheelZoom:true}).setView([38.207,-80.965],12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18, attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
  L.polyline(RIVER_CORRIDOR,{color:'#0e6f78',weight:5,opacity:.62,lineCap:'round',dashArray:'9 7'}).addTo(map);
  for (const p of WAYPOINTS) {
    const color = p.type==='rapid' ? '#8a3b22' : p.type==='access' ? '#385e46' : '#0e6f78';
    const m=L.circleMarker([p.lat,p.lon],{radius:p.type==='rapid'?7:6,color:'#fff',weight:2,fillColor:color,fillOpacity:1}).addTo(map);
    m.bindTooltip(`${p.name}${p.class?` · ${p.class}`:''}`,{className:'gauley-tip',direction:'top'});
    m.on('click',()=>showPoint(p.id));
    markerById.set(p.id,{ marker:m, point:p });
  }
  map.fitBounds(L.latLngBounds(RIVER_CORRIDOR).pad(.08));
}

function markerAllowed(point,persona=currentPersona){
  if(persona==='watch'||persona==='photo') return ['access','dam'].includes(point.type);
  if(persona==='raft') return ['rapid','access','dam'].includes(point.type);
  return true;
}
function setMapPersona(persona) {
  currentPersona = persona;
  if (!map) return;
  for (const { marker, point } of markerById.values()) {
    const show = markerAllowed(point,persona);
    if (show && !map.hasLayer(marker)) marker.addTo(map);
    if (!show && map.hasLayer(marker)) map.removeLayer(marker);
  }
  updatePulseMarker();
}

function waveCandidates(){
  if (!live?.wave?.length) return [];
  if(currentPersona==='watch'||currentPersona==='photo') return live.wave.filter(p=>['dam','mason','woods'].includes(p.id));
  if(currentPersona==='raft') return live.wave.filter(p=>['dam','pillow','lost-paddle','sweets','mason','woods'].includes(p.id));
  return live.wave;
}
function currentWavePoint() {
  const candidates=waveCandidates();
  if(!candidates.length)return null;
  return candidates.find(p=>p.state==='HERE NOW') || candidates.find(p=>p.state==='APPROACHING') || candidates.find(p=>p.state==='FORECAST') || candidates[candidates.length-1];
}

function setPulseAt(lat,lon) {
  if (!map) return;
  if (!pulseMarker) {
    const icon=L.divIcon({className:'pulse-marker',iconSize:[24,24],iconAnchor:[12,12]});
    pulseMarker=L.marker([lat,lon],{icon,zIndexOffset:1000}).addTo(map);
  } else { pulseMarker.setLatLng([lat,lon]); if(!map.hasLayer(pulseMarker)) pulseMarker.addTo(map); }
}
function interpolatePulse(minutes) {
  if (!live?.wave?.length || !live.release?.onset?.onset) return null;
  const wave=live.wave;
  const t0=new Date(live.release.onset.onset).getTime();
  const target=t0+minutes*60000;
  let a=wave[0],b=wave[wave.length-1];
  for(let i=0;i<wave.length-1;i++){
    const tA=new Date(wave[i].arrivalBest).getTime(),tB=new Date(wave[i+1].arrivalBest).getTime();
    if(target>=tA&&target<=tB){a=wave[i];b=wave[i+1];break;}
  }
  const ta=new Date(a.arrivalBest).getTime(),tb=new Date(b.arrivalBest).getTime();
  const f=tb===ta?0:Math.max(0,Math.min(1,(target-ta)/(tb-ta)));
  return {lat:a.lat+(b.lat-a.lat)*f,lon:a.lon+(b.lon-a.lon)*f};
}
function updatePulseMarker() {
  if (!map || !live?.wave?.length) { if(pulseMarker&&map&&map.hasLayer(pulseMarker))map.removeLayer(pulseMarker); return; }
  if (scrubMinutes !== null) { const pos=interpolatePulse(scrubMinutes); if(pos)setPulseAt(pos.lat,pos.lon); return; }
  const now=Date.now(),t0=new Date(live.release.onset.onset).getTime();
  const mins=Math.max(0,(now-t0)/60000);
  const pos=interpolatePulse(mins); if(pos)setPulseAt(pos.lat,pos.lon);
}

function showPoint(id) {
  const base=WAYPOINTS.find(x=>x.id===id); if(!base)return;
  const point=live?.wave?.find(x=>x.id===id);
  $('mapDetail').hidden=false;
  $('detailName').textContent=base.name;
  $('detailClass').textContent=base.class?`Class ${base.class}`:base.type==='access'?'PUBLIC RIVER ACCESS':base.type.toUpperCase();
  $('detailState').textContent=point?.state || 'WAITING FOR OBSERVED ONSET';
  $('detailArrival').textContent=point ? `${fmtTime(point.arrivalStart)}–${fmtTime(point.arrivalEnd)}` : 'No modeled window yet';
  $('detailFlow').textContent=point?.estimatedFlowCfs ? `${Math.round(point.estimatedFlowCfs).toLocaleString()} CFS · ${live?.river?.flowClass?.label || 'modeled'}` : (live?.river?.flowClass?.label || '—');
  $('detailConfidence').textContent=live?.conditions?.confidence ? `${live.conditions.confidence}%`:'—';
  const notes={
    dam:'NPS identifies the Summersville Dam tailwaters as a place to watch rafters and boaters. Release status here is anchored to observed operations and tailwater response when available.',
    initiation:'First major rapid marker in the modeled corridor. Arrival is a model window, not a safety recommendation.',
    insignificant:'American Whitewater identifies Insignificant as one of the Upper Gauley’s major rapids.',
    pillow:'Pillow Rock is one of the signature Upper Gauley rapids. This tool reports timing and flow context only.',
    'meadow-confluence':'The Meadow River enters the Gauley here. Its contribution is applied only from this point downstream and is time-aligned from the Nallen gauge.',
    'lost-paddle':'Lost Paddle begins just downstream of the Meadow River confluence, so tributary contribution can materially change the modeled flow here.',
    'iron-ring':'Iron Ring timing uses the release-wave model with wider downstream uncertainty.',
    sweets:"Sweet’s Falls is the last of the Upper Gauley’s big five rapids.",
    mason:"Established public river access. NPS says parking is limited and the access road closes when capacity is reached. This app does not rate it as a spectator site.",
    woods:'Established public river access downstream of Mason’s Branch. This app does not rate it as a spectator site.',
    belva:'USGS 03192000 provides downstream discharge and stage used to validate the release response.'
  };
  $('detailNote').textContent=notes[id]||'';
}

function renderPersona(){
  const d=live?.personas?.[currentPersona]; if(!d)return;
  $('personaLabel').textContent=d.label;
  $('personaVerdict').textContent=d.verdict;
  $('personaHeadline').textContent=d.headline;
  $('personaSummary').textContent=d.summary;
  const facts=d.facts||[];
  for(let i=0;i<3;i++){
    $(`personaFactLabel${i+1}`).textContent=facts[i]?.label||'—';
    $(`personaFact${i+1}`).textContent=facts[i]?.value||'—';
  }
  $('personaNextCheck').textContent=d.nextCheck;
  $('personaCaution').textContent=d.caution;
  $('personaAction').textContent=d.action;
  personaActionTarget=d.actionTarget||'#map-section';

  const mapCopy={
    paddler:['See the release move downstream.','Private-paddler view shows the major rapids, river access, gauges and the modeled release pulse. Schedule alone never creates a pulse.'],
    raft:['See the river day without replacing your outfitter.','Raft-guest view keeps the moving water and major landmarks visible, but your outfitter’s meeting time, equipment instructions and trip changes remain authoritative.'],
    watch:['Watch the water from verified public-use context.','NPS specifically identifies the Summersville Dam tailwaters for watching boaters. Other pins are public river access; they are not automatically spectator recommendations. The water pulse remains visible because it represents the river, not a suggested place to stand.'],
    photo:['Time the water; keep the location conservative.','Photo view keeps the modeled release pulse and established public-use points, led by the NPS-identified tailwaters viewing area. Rapids are hidden so a timing marker is not mistaken for shoreline access.']
  }[currentPersona];
  $('mapHeading').textContent=mapCopy[0];$('mapIntro').textContent=mapCopy[1];
  document.querySelectorAll('.persona-tab').forEach(b=>b.classList.toggle('active',b.dataset.persona===currentPersona));
}

function renderPlanning(){
  const p=live?.personas?.planning;
  $('nextRelease').textContent=fmtDate(live?.release?.scheduled?live.local.date:live?.release?.nextDate);
  $('releaseMorningWeather').textContent=formatMorning(p?.morning);
  $('planningConfidence').textContent=p?.timingConfidence==='LIVE OBSERVATION'?'Live onset evidence available':'Schedule only · start time not inferred';
}

function snapshotFor(data){return {at:data.generatedAt,status:data.release?.status,flow:data.river?.effectivePostMeadowCfs,pulse:data.nextWave?.name||null,warnings:data.conditions?.activeWarnings||0,confidence:data.conditions?.confidence||null};}
function ageText(ms){const mins=Math.round(ms/60000);if(mins<60)return `${mins} min ago`;const h=Math.round(mins/60);if(h<36)return `${h} hr ago`;return `${Math.round(h/24)} d ago`;}
function renderSinceLast(data){
  if(storedVisit)return;
  const now=Date.parse(data.generatedAt); const then=Date.parse(priorVisit?.at||'');
  if(priorVisit&&Number.isFinite(then)&&now>then){
    const age=now-then;
    if(age>=5*60000&&age<=7*86400000){
      const changes=[];
      if(priorVisit.status&&priorVisit.status!==data.release.status)changes.push(`${priorVisit.status} → ${data.release.status}`);
      const f0=finiteNumber(priorVisit.flow),f1=finiteNumber(data.river.effectivePostMeadowCfs);
      if(f0!==null&&f1!==null&&Math.abs(f1-f0)>=50)changes.push(`Effective flow ${f1-f0>=0?'+':''}${Math.round(f1-f0).toLocaleString()} CFS`);
      const pulse=data.nextWave?.name||null;if(priorVisit.pulse&&pulse&&priorVisit.pulse!==pulse)changes.push(`Pulse advanced: ${priorVisit.pulse} → ${pulse}`);
      if(Number(priorVisit.warnings)!==Number(data.conditions.activeWarnings))changes.push(`NWS warnings ${priorVisit.warnings||0} → ${data.conditions.activeWarnings||0}`);
      const c0=finiteNumber(priorVisit.confidence),c1=finiteNumber(data.conditions.confidence);if(c0!==null&&c1!==null&&Math.abs(c1-c0)>=5)changes.push(`Confidence ${c1-c0>=0?'+':''}${Math.round(c1-c0)} points`);
      $('sinceLastPanel').hidden=false;
      $('sinceLastHeadline').textContent=changes.length?`Changed since ${ageText(age)}`:`No major change since ${ageText(age)}`;
      $('sinceLastDetails').replaceChildren(...(changes.length?changes:['Release status, material flow, pulse position and warnings are effectively unchanged.']).map(t=>{const s=document.createElement('span');s.textContent=t;return s;}));
    }
  }
  try{localStorage.setItem('gauleyLastVisit',JSON.stringify(snapshotFor(data)));}catch{}
  storedVisit=true;
}

function render(data) {
  live=data;
  $('modeLabel').textContent=data.mode;
  $('festPanel').hidden=!data.festival?.active;
  if(data.festival){ $('festDates').textContent=data.festival.dates; $('festNote').textContent=data.festival.note; $('festLink').href=data.festival.source; }
  $('releaseStatus').textContent=data.release.status;
  $('releaseDetail').textContent=data.release.statusDetail;
  $('statusDot').className='status-dot '+(data.release.confirmed?'live':data.release.scheduled?'pending':'');
  $('effectiveFlow').textContent=Number.isFinite(data.river.effectivePostMeadowCfs)?`${Math.round(data.river.effectivePostMeadowCfs).toLocaleString()} CFS`:'—';
  $('flowLabel').textContent=(data.river.effectiveEstimated?'Estimated · ':'')+(data.river.flowClass?.label||'Flow unavailable')+' · below Meadow confluence';
  const p=currentWavePoint();
  $('pulseNow').textContent=p ? p.name : (data.release.scheduled ? 'Waiting for onset' : 'No live pulse');
  $('pulseEta').textContent=p ? `${p.state} · ${fmtTime(p.arrivalStart)}–${fmtTime(p.arrivalEnd)}` : 'No rapid/access ETA is created before observed release onset.';
  $('confidence').textContent=`${data.conditions.confidence}%`;
  $('freshnessLine').textContent=data.freshness.tailwater ? `Tailwater ${data.freshness.tailwater.label.toLowerCase()}`:'Tailwater source unavailable';
  $('conditionScore').textContent=data.conditions.score;
  $('conditionLabel').textContent=conditionWord(data.conditions.score);
  $('belvaFlow').textContent=fmtNum(data.river.belvaFlowCfs,' CFS');
  $('meadowFlow').textContent=fmtNum(data.river.meadowFlowCfs,' CFS');
  $('tailStage').textContent=Number.isFinite(data.river.tailwaterStageFt)?`${data.river.tailwaterStageFt.toFixed(2)} ft`:'—';
  $('tailRain').textContent=Number.isFinite(data.river.precipitationIn)?`${data.river.precipitationIn.toFixed(2)} in`:'—';
  $('temperature').textContent=Number.isFinite(data.weather?.temperatureF)?`${Math.round(data.weather.temperatureF)}°F`:'—';
  $('weatherText').textContent=data.weather?.shortForecast||'NWS forecast unavailable';
  $('precipChance').textContent=Number.isFinite(data.weather?.precipProbability)?`${data.weather.precipProbability}%`:'—';
  $('wind').textContent=data.weather?.wind||'—';
  $('warnings').textContent=data.conditions.activeWarnings?`${data.conditions.activeWarnings} active`:'None detected';
  $('weatherUpdated').textContent=fmtTime(data.weather?.observedAt);
  const warnings=data.weather?.alerts||[];
  if(warnings.length){$('warningBox').hidden=false;$('warningBox').textContent=warnings.map(x=>x.headline||x.event).join(' · ');}else{$('warningBox').hidden=true;}
  $('tailwatersNotice').textContent=data.seasonNotice.tailwaters;
  $('masonNotice').textContent=data.seasonNotice.mason;
  $('privateNotice').textContent=data.seasonNotice.privateProperty;
  $('spectatorNote').textContent=data.seasonNotice.spectatorNote||$('spectatorNote').textContent;
  $('npsNoticeLink').href=data.seasonNotice.source;
  const dc=Number(data.changes.belva24hCfs),ds=Number(data.changes.tailwater24hFt);
  if(Number.isFinite(dc)){
    $('changedHeadline').textContent=`Belva ${dc>=0?'+':''}${Math.round(dc).toLocaleString()} CFS`;
    $('changedText').textContent=`24-hour Belva change. Tailwater stage changed ${Number.isFinite(ds)?`${ds>=0?'+':''}${ds.toFixed(2)} ft`:'by an unavailable amount'}.`;
  }
  $('sourcesList').replaceChildren(...Object.entries(data.sources).map(([k,v])=>{const a=document.createElement('a');a.href=v;a.target='_blank';a.rel='noopener';const n=document.createElement('span');n.textContent=k.toUpperCase();const o=document.createElement('span');o.textContent='Open ↗';a.append(n,o);return a;}));

  const onset=data.wave?.length ? data.release?.onset?.onset : null;
  $('timeScrubber').disabled=!onset;$('liveButton').disabled=!onset;
  if(onset){const mins=Math.max(0,Math.min(360,Math.round((Date.now()-new Date(onset).getTime())/60000/5)*5));if(scrubMinutes===null)$('timeScrubber').value=mins;}
  renderPersona();renderPlanning();setMapPersona(currentPersona);updatePulseMarker();
  const selected=currentWavePoint();if(selected?.id)showPoint(selected.id);else if(currentPersona==='watch'||currentPersona==='photo')showPoint('dam');
  renderSinceLast(data);
  if(history) renderHistory();
}

function renderHistory(){
  $('histMedian').textContent=Number.isFinite(history?.median)?`${history.median.toLocaleString()} CFS`:'Unavailable';
  const flow=finiteNumber(live?.river?.effectivePostMeadowCfs);
  const pct=pctFor(flow,history?.sample);
  $('histPercentile').textContent=Number.isFinite(pct)?`${pct}th percentile`:'—';
  $('histNote').textContent=Number.isFinite(pct)?`Modeled effective flow compared with ${history.sampleCount} Belva daily means on modeled release-calendar dates from 2010–2025.`:'Current effective flow is not available for a percentile comparison.';
}

async function loadLive(){
  $('refreshButton').disabled=true;$('refreshButton').textContent='Refreshing…';
  try{render(await getJSON('/api/live'));}
  catch(e){$('releaseStatus').textContent='LIVE DATA TEMPORARILY UNAVAILABLE';$('releaseDetail').textContent='Current source retrieval failed. The schedule, access context and agency source links remain available.';}
  finally{$('refreshButton').disabled=false;$('refreshButton').textContent='Refresh live data';}
}
async function loadHistory(){try{history=await getJSON('/api/history');renderHistory();}catch(e){$('histMedian').textContent='Unavailable';}}

function choosePersona(persona){
  currentPersona=persona;
  try{localStorage.setItem('gauleyPersona',persona);}catch{}
  renderPersona();setMapPersona(persona);
  const p=currentWavePoint();if(p?.id)showPoint(p.id);else if(persona==='watch'||persona==='photo')showPoint('dam');
  track('gauley_persona_select',{persona});
}
function bind(){
  $('refreshButton').addEventListener('click',()=>{track('gauley_refresh');loadLive();});
  $('followButton').addEventListener('click',()=>{track('gauley_follow_water',{persona:currentPersona});document.querySelector('#map-section').scrollIntoView({behavior:'smooth'});if(map){const p=currentWavePoint();if(p)map.setView([p.lat,p.lon],14);}});
  $('personaAction').addEventListener('click',()=>{track('gauley_persona_action',{persona:currentPersona});document.querySelector(personaActionTarget)?.scrollIntoView({behavior:'smooth'});});
  $('sourcesButton').addEventListener('click',()=>$('sourcesDialog').showModal());
  $('closeDetail').addEventListener('click',()=>$('mapDetail').hidden=true);
  document.querySelectorAll('.persona-tab').forEach(btn=>btn.addEventListener('click',()=>choosePersona(btn.dataset.persona)));
  $('timeScrubber').addEventListener('input',e=>{scrubMinutes=Number(e.target.value);$('scrubTime').textContent=`${scrubMinutes} min after observed onset`;updatePulseMarker();});
  $('liveButton').addEventListener('click',()=>{scrubMinutes=null;$('scrubTime').textContent='Live position';updatePulseMarker();});
}

initMap();bind();choosePersona(currentPersona);loadLive();loadHistory();setInterval(loadLive,180000);setInterval(updatePulseMarker,30000);
