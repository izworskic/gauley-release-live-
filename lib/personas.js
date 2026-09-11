const TZ='America/New_York';

function partsFor(iso){
  if(!iso)return null;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));
  const get=t=>parts.find(p=>p.type===t)?.value;
  return {date:`${get('year')}-${get('month')}-${get('day')}`,hour:Number(get('hour'))};
}

export function daysBetweenDates(a,b){
  if(!a||!b)return null;
  return Math.round((Date.parse(`${b}T12:00:00Z`)-Date.parse(`${a}T12:00:00Z`))/86400000);
}

export function summarizeReleaseMorning(periods=[],targetDate){
  if(!targetDate||!Array.isArray(periods))return null;
  const rows=periods.filter(p=>{const x=partsFor(p.startTime);return x&&x.date===targetDate&&x.hour>=6&&x.hour<12;});
  if(!rows.length)return null;
  const temps=rows.map(x=>Number(x.temperatureF)).filter(Number.isFinite);
  const pops=rows.map(x=>Number(x.precipProbability)).filter(Number.isFinite);
  const winds=rows.map(x=>Number(x.windMph)).filter(Number.isFinite);
  const forecasts=rows.map(x=>x.shortForecast).filter(Boolean);
  const counts=new Map();
  for(const f of forecasts)counts.set(f,(counts.get(f)||0)+1);
  const dominant=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
  return {
    targetDate,
    window:'6 AM–noon',
    temperatureLowF:temps.length?Math.min(...temps):null,
    temperatureHighF:temps.length?Math.max(...temps):null,
    precipMaxPct:pops.length?Math.max(...pops):null,
    windMaxMph:winds.length?Math.max(...winds):null,
    shortForecast:dominant,
    source:'NWS hourly forecast'
  };
}

function cfs(v){
  if(v===null||v===undefined||v==='')return 'Not available';
  const value=Number(v);
  return Number.isFinite(value)?`${Math.round(value).toLocaleString()} CFS`:'Not available';
}
function weatherLine(m){
  if(!m)return 'Forecast window not available yet';
  const t=Number.isFinite(m.temperatureLowF)&&Number.isFinite(m.temperatureHighF)?`${Math.round(m.temperatureLowF)}–${Math.round(m.temperatureHighF)}°F`:null;
  const p=Number.isFinite(m.precipMaxPct)?`${Math.round(m.precipMaxPct)}% precip max`:null;
  return [t,m.shortForecast,p].filter(Boolean).join(' · ')||'NWS forecast available';
}
function waveAt(wave,id){return Array.isArray(wave)?wave.find(p=>p.id===id):null;}
function firstPublicAccessWave(wave){
  return ['mason','woods'].map(id=>waveAt(wave,id)).find(p=>p&&['HERE NOW','APPROACHING','FORECAST'].includes(p.state))||null;
}
function arrivalText(p){return p?`${p.state} · modeled arrival window available on map`:'Appears only after observed release onset';}

export function buildPersonaDecisions(input){
  const {local,release,river,weather,wave=[],conditions,seasonNotice}=input;
  const targetDate=release.scheduled?local.date:release.nextDate;
  const leadDays=daysBetweenDates(local.date,targetDate);
  const morning=summarizeReleaseMorning(weather?.periods||[],targetDate);
  const planning={
    targetDate,
    leadDays,
    morning,
    baselineCfs:release.standardReleaseCfs,
    timingConfidence:release.confirmed?'LIVE OBSERVATION':'SCHEDULE ONLY',
    timingNote:release.confirmed?'Observed release evidence is available; downstream times are modeled with uncertainty.':'No release-start time is inferred before live onset evidence exists.'
  };
  const publicArrival=firstPublicAccessWave(wave);
  const releaseWhen=release.confirmed?'Release is confirmed by live source evidence.':release.scheduled?'A recreational release is scheduled today but has not been confirmed by live onset evidence.':leadDays===1?'The next scheduled release is tomorrow.':targetDate?`Next scheduled release: ${targetDate}.`:'The listed 2026 release season is complete.';
  const nextCheck=release.confirmed?'Keep this page open or refresh before your actual launch, meeting or viewing time.':release.scheduled?'Recheck when USACE/tailwater observations confirm the release signal.':leadDays===1?'Recheck tomorrow morning before leaving; the live engine will not invent an onset time tonight.':targetDate?'Recheck as the next release day approaches or if the weather changes.':'Use current natural-flow information; no scheduled release remains in the 2026 calendar.';
  const warnings=conditions.activeWarnings?`${conditions.activeWarnings} active NWS warning${conditions.activeWarnings===1?'':'s'}`:'No NWS warning detected by the engine';
  const upper=cfs(river.effectiveUpperCfs);
  const below=cfs(river.effectivePostMeadowCfs);
  const morningLine=weatherLine(morning);

  return {
    planning,
    paddler:{
      id:'paddler',label:'PRIVATE PADDLER',verdict:release.confirmed?'LIVE RELEASE':release.scheduled?'VERIFY LIVE ONSET':leadDays===1?'PLAN TOMORROW':'PLAN NEXT RELEASE',
      headline:release.confirmed?'The release signal is live. Follow the pulse, not the schedule.':release.scheduled?'Today is a release day, but schedule is not proof of current flow.':leadDays===1?'Tomorrow is a release day. Build the plan now; verify the river in the morning.':'Use the next release date for planning, then verify live conditions before launch.',
      summary:`${releaseWhen} Upper modeled/observed release flow and the Meadow-adjusted downstream estimate are kept separate.`,
      facts:[{label:'Release evidence',value:release.confirmed?'Confirmed live':release.scheduled?'Scheduled · unconfirmed':'Not a release day'},{label:'Upper Gauley flow',value:upper},{label:'Below Meadow',value:below}],
      nextCheck,action:'Follow release pulse',actionTarget:'#map-section',
      caution:'For experienced private boaters only: this tool describes river conditions and timing. It does not determine whether a Class IV–V+ run is appropriate for you or your group.'
    },
    raft:{
      id:'raft',label:'RAFT GUEST',verdict:release.confirmed?'RIVER SIGNAL LIVE':release.scheduled?'RELEASE DAY':'TRIP PLANNING',
      headline:release.confirmed?'The river signal is live. Your outfitter still owns the trip clock.':release.scheduled?'A release is scheduled today. Follow your outfitter’s meeting instructions.':leadDays===1?'Release day is tomorrow. Weather and logistics matter more to you than gauge math.':'Use this page to understand the river day, not to replace your outfitter.',
      summary:`${releaseWhen} Commercial trips generally provide guides, river equipment and transportation; meeting time and trip changes come from your outfitter.`,
      facts:[{label:'Release status',value:release.confirmed?'Confirmed live':release.scheduled?'Scheduled today':targetDate||'Season complete'},{label:'Release-morning weather',value:morningLine},{label:'Weather alerts',value:warnings}],
      nextCheck,action:'See river-day conditions',actionTarget:'#conditions',
      caution:'Bring and wear what your outfitter directs. This tool is supplemental river and weather context, not commercial trip instructions.'
    },
    watch:{
      id:'watch',label:'WATCH',verdict:release.confirmed?'WATER MOVING':release.scheduled?'WAIT FOR CONFIRMATION':leadDays===1?'PLAN TOMORROW':'PLAN A RELEASE DAY',
      headline:release.confirmed?'For verified spectator viewing, start with the Summersville Dam tailwaters.':release.scheduled?'Tailwaters is the verified spectator location; wait for live release confirmation before timing your visit.':leadDays===1?'Tomorrow is the next release. Tailwaters is the clearest verified viewing plan.':'Anchor a spectator visit to a scheduled release day and established public access.',
      summary:`NPS specifically identifies the Summersville Dam tailwaters as a place to watch boaters. Mason’s Branch and Woods Ferry are public river-access areas, but this engine does not rate them as spectator sites.`,
      facts:[{label:'Verified viewing',value:'Summersville Dam tailwaters'},{label:'Release evidence',value:release.confirmed?'Confirmed live':release.scheduled?'Scheduled · unconfirmed':targetDate||'Season complete'},{label:'Downstream public access',value:arrivalText(publicArrival)}],
      nextCheck,action:'Show public access',actionTarget:'#map-section',
      caution:`Stay at established public-use areas and obey closures, parking controls and private-property boundaries. ${seasonNotice?.tailwaters||''}`.trim()
    },
    photo:{
      id:'photo',label:'PHOTO',verdict:release.confirmed?'PHOTO WINDOW LIVE':release.scheduled?'TIMING NOT LIVE':leadDays===1?'SCOUT TOMORROW':'SCOUT NEXT RELEASE',
      headline:release.confirmed?'Use the live water timing plus NWS weather; keep the shooting location on established public access.':release.scheduled?'The date is useful, but there is no honest rapid-by-rapid photo clock until onset is observed.':leadDays===1?'Tomorrow gives you the next release-day opportunity. Scout access and weather tonight.':'Plan around a release date, then let live onset create the timing window.',
      summary:`Tailwaters is the strongest verified spectator/photo anchor. The app will show modeled downstream public-access arrival windows only after observed onset.`,
      facts:[{label:'Verified base',value:'Summersville Dam tailwaters'},{label:'Release-morning weather',value:morningLine},{label:'Water timing',value:arrivalText(publicArrival)}],
      nextCheck,action:'Open photo/access map',actionTarget:'#map-section',
      caution:'Riverbanks, rocks and shorelines can be hazardous. A photo opportunity is not a statement that shoreline access or wading is safe.'
    }
  };
}
