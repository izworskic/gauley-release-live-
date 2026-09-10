import { WAYPOINTS, RIVER_CORRIDOR } from '/lib/geometry.js';

const $ = id => document.getElementById(id);
let live = null;
let history = null;
let map = null;
let markerById = new Map();
let currentAudienceMode = 'run';
let pulseMarker = null;
let scrubMinutes = null;

function fmtNum(v, suffix='') { return Number.isFinite(Number(v)) ? `${Math.round(Number(v)).toLocaleString()}${suffix}` : '—'; }
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
  if (score >= 90) return 'Exceptional release conditions';
  if (score >= 78) return 'Strong release conditions';
  if (score >= 62) return 'Mixed but usable conditions';
  if (score >= 45) return 'Limited conditions';
  return 'Conditions require extra attention';
}

async function getJSON(url) {
  const r = await fetch(url,{cache:'no-store'});
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

function initMap() {
  if (!window.L) { $('map').innerHTML='<div style="padding:30px">Map library could not load. Live river data remains available below.</div>'; return; }
  map=L.map('map',{zoomControl:true,scrollWheelZoom:true}).setView([38.207,-80.965],12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:18, attribution:'&copy; OpenStreetMap contributors'
  }).addTo(map);
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

function setMapAudienceMode(mode) {
  currentAudienceMode = mode;
  if (!map) return;
  for (const { marker, point } of markerById.values()) {
    const show = mode === 'run' || ['access','dam'].includes(point.type);
    if (show && !map.hasLayer(marker)) marker.addTo(map);
    if (!show && map.hasLayer(marker)) map.removeLayer(marker);
  }
  if (mode === 'visit' && pulseMarker && map.hasLayer(pulseMarker)) map.removeLayer(pulseMarker);
  if (mode === 'run') updatePulseMarker();
}

function currentWavePoint() {
  if (!live?.wave?.length) return null;
  return live.wave.find(p=>p.state==='HERE NOW') || live.wave.find(p=>p.state==='APPROACHING') || live.wave.find(p=>p.state==='FORECAST') || live.wave[live.wave.length-1];
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
  if (currentAudienceMode === 'visit') { if(pulseMarker&&map&&map.hasLayer(pulseMarker)) map.removeLayer(pulseMarker); return; }
  if (!map || !live?.wave?.length) { if(pulseMarker&&map){map.removeLayer(pulseMarker);pulseMarker=null;} return; }
  if (scrubMinutes !== null) {
    const pos=interpolatePulse(scrubMinutes); if(pos)setPulseAt(pos.lat,pos.lon); return;
  }
  const now=Date.now(),t0=new Date(live.release.onset.onset).getTime();
  const mins=Math.max(0,(now-t0)/60000);
  const pos=interpolatePulse(mins); if(pos)setPulseAt(pos.lat,pos.lon);
}

function showPoint(id) {
  const base=WAYPOINTS.find(x=>x.id===id); if(!base)return;
  const point=live?.wave?.find(x=>x.id===id);
  $('mapDetail').hidden=false;
  $('detailName').textContent=base.name;
  $('detailClass').textContent=base.class?`Class ${base.class}`:base.type.toUpperCase();
  $('detailState').textContent=point?.state || 'WAITING FOR ONSET';
  $('detailArrival').textContent=point ? `${fmtTime(point.arrivalStart)}–${fmtTime(point.arrivalEnd)}` : 'No modeled window yet';
  $('detailFlow').textContent=point?.estimatedFlowCfs ? `${Math.round(point.estimatedFlowCfs).toLocaleString()} CFS · ${live?.river?.flowClass?.label || 'modeled'}` : (live?.river?.flowClass?.label || '—');
  $('detailConfidence').textContent=live?.conditions?.confidence ? `${live.conditions.confidence}%`:'—';
  const notes={
    dam:'Release status is anchored to observed operations and tailwater response when available.',
    initiation:'First major rapid marker in the modeled corridor. Arrival is a model window, not a safety recommendation.',
    insignificant:'American Whitewater identifies Insignificant as one of the Upper Gauley’s major rapids.',
    pillow:'Pillow Rock is one of the signature Upper Gauley rapids. This tool reports timing and flow context only.',
    'meadow-confluence':'The Meadow River enters the Gauley here. Its current contribution is applied only from this point downstream.',
    'lost-paddle':'Lost Paddle begins just downstream of the Meadow River confluence, so tributary contribution can materially change the flow here.',
    'iron-ring':'Iron Ring timing uses the same release-wave model with wider downstream uncertainty.',
    sweets:"Sweet’s Falls is the last of the Upper Gauley’s big five rapids.",
    mason:"Established mid-river access. NPS says parking is limited and the access road closes when capacity is reached.",
    woods:'Established public access downstream of Mason’s Branch.',
    belva:'USGS 03192000 provides downstream discharge and stage used to validate the release response.'
  };
  $('detailNote').textContent=notes[id]||'';
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
  $('pulseNow').textContent=p ? p.name : (data.release.scheduled ? 'Waiting for onset' : 'No release pulse');
  $('pulseEta').textContent=p ? `${p.state} · ${fmtTime(p.arrivalStart)}–${fmtTime(p.arrivalEnd)}` : 'Arrival windows appear after observed release onset.';
  $('confidence').textContent=`${data.conditions.confidence}%`;
  $('freshnessLine').textContent=data.freshness.tailwater ? `Tailwater ${data.freshness.tailwater.label.toLowerCase()}`:'Tailwater source unavailable';
  $('nextRelease').textContent=fmtDate(data.release.nextDate);
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
  $('npsNoticeLink').href=data.seasonNotice.source;
  const dc=Number(data.changes.belva24hCfs),ds=Number(data.changes.tailwater24hFt);
  if(Number.isFinite(dc)){
    $('changedHeadline').textContent=`Belva ${dc>=0?'+':''}${Math.round(dc).toLocaleString()} CFS`;
    $('changedText').textContent=`24-hour Belva change. Tailwater stage changed ${Number.isFinite(ds)?`${ds>=0?'+':''}${ds.toFixed(2)} ft`:'by an unavailable amount'}.`;
  }
  $('sourcesList').innerHTML=Object.entries(data.sources).map(([k,v])=>`<a href="${v}" target="_blank" rel="noopener"><span>${k.toUpperCase()}</span><span>Open ↗</span></a>`).join('');

  const onset=data.release?.onset?.onset;
  $('timeScrubber').disabled=!onset;$('liveButton').disabled=!onset;
  if(onset){
    const mins=Math.max(0,Math.min(360,Math.round((Date.now()-new Date(onset).getTime())/60000/5)*5));
    if(scrubMinutes===null)$('timeScrubber').value=mins;
  }
  updatePulseMarker();
  if(p?.id) showPoint(p.id);
  if(history) renderHistory();
}

function renderHistory(){
  $('histMedian').textContent=Number.isFinite(history?.median)?`${history.median.toLocaleString()} CFS`:'Unavailable';
  const flow=Number(live?.river?.effectivePostMeadowCfs);
  const pct=pctFor(flow,history?.sample);
  $('histPercentile').textContent=Number.isFinite(pct)?`${pct}th percentile`:'—';
  $('histNote').textContent=Number.isFinite(pct)?`Modeled effective flow compared with ${history.sampleCount} Belva daily means on modeled release-calendar dates from 2010–2025.`:'Current effective flow is not available for a percentile comparison.';
}

async function loadLive(){
  $('refreshButton').disabled=true;$('refreshButton').textContent='Refreshing…';
  try{render(await getJSON('/api/live'));}
  catch(e){$('releaseStatus').textContent='LIVE DATA TEMPORARILY UNAVAILABLE';$('releaseDetail').textContent='The page is still usable, but current source retrieval failed. Try refresh or open the agency sources.';}
  finally{$('refreshButton').disabled=false;$('refreshButton').textContent='Refresh live data';}
}
async function loadHistory(){try{history=await getJSON('/api/history');renderHistory();}catch(e){$('histMedian').textContent='Unavailable';}}

function bind(){
  $('refreshButton').addEventListener('click',loadLive);
  $('followButton').addEventListener('click',()=>{document.querySelector('#map-section').scrollIntoView({behavior:'smooth'});if(map){const p=currentWavePoint();if(p)map.setView([p.lat,p.lon],14);}});
  $('sourcesButton').addEventListener('click',()=>$('sourcesDialog').showModal());
  $('closeDetail').addEventListener('click',()=>$('mapDetail').hidden=true);
  document.querySelectorAll('.seg').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.seg').forEach(x=>x.classList.remove('active'));btn.classList.add('active');const mode=btn.dataset.mode;document.body.classList.toggle('visit-mode',mode==='visit');setMapAudienceMode(mode);$('mapIntro').textContent=mode==='visit'?'Established public-access points only. Rapids and the moving pulse are hidden here so map markers are not mistaken for spectator recommendations.':'When release onset is observed, the model turns that signal into downstream arrival windows with widening uncertainty. The dashed route is a modeled control-point corridor; the basemap shows the detailed river channel.';}));
  $('timeScrubber').addEventListener('input',e=>{scrubMinutes=Number(e.target.value);$('scrubTime').textContent=`${scrubMinutes} min after observed onset`;updatePulseMarker();});
  $('liveButton').addEventListener('click',()=>{scrubMinutes=null;$('scrubTime').textContent='Live position';updatePulseMarker();});
}

initMap();bind();loadLive();loadHistory();setInterval(loadLive,180000);setInterval(updatePulseMarker,30000);
