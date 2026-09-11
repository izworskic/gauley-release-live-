import test from 'node:test';
import assert from 'node:assert/strict';
import { freshness,detectReleaseOnset,recentObservations,classifyFlow,arrivalMinutes,meadowTravelMinutes,lagAlignedObservation,waveForecast,pointState,conditionsIndex,percentile } from '../lib/engine.js';
import { isReleaseDate,isFestDate,releaseDates2026,nextRelease,modeledReleaseDatesForYear,localDateParts,isIsoOnLocalDate } from '../lib/schedule.js';
import { WAYPOINTS } from '../lib/geometry.js';
import { summarizeReleaseMorning,buildPersonaDecisions } from '../lib/personas.js';

test('2026 authoritative release calendar contains 22 dates',()=>{assert.equal(releaseDates2026().length,22);assert.equal(isReleaseDate('2026-09-11'),true);assert.equal(isReleaseDate('2026-09-10'),false);assert.equal(isReleaseDate('2026-10-18'),true);assert.equal(nextRelease('2026-09-10'),'2026-09-11');assert.equal(nextRelease('2026-09-11'),'2026-09-12');assert.equal(nextRelease('2026-10-19'),null)});
test('Gauley Fest window is separately modeled',()=>{assert.equal(isFestDate('2026-09-17'),true);assert.equal(isFestDate('2026-09-20'),true);assert.equal(isFestDate('2026-09-21'),false)});
test('historical schedule approximation yields 22 event dates',()=>{for(const year of[2010,2019,2025]){const dates=modeledReleaseDatesForYear(year);assert.equal(dates.length,22);assert.equal(new Set(dates).size,22)}});
test('local date conversion uses Gauley operational timezone',()=>{const p=localDateParts(new Date('2026-09-11T10:30:00Z'));assert.equal(p.date,'2026-09-11');assert.equal(p.hour,6);assert.equal(p.minute,30)});
test('release onset evidence is confined to the current Gauley calendar day',()=>{assert.equal(isIsoOnLocalDate('2026-09-11T03:55:00Z','2026-09-10'),true);assert.equal(isIsoOnLocalDate('2026-09-11T03:55:00Z','2026-09-11'),false);assert.equal(isIsoOnLocalDate(null,'2026-09-11'),false)});
test('freshness buckets distinguish current, delayed and stale data',()=>{const now=new Date('2026-09-11T12:00:00Z');assert.equal(freshness('2026-09-11T11:50:00Z',now).label,'CURRENT');assert.equal(freshness('2026-09-11T11:40:00Z',now).label,'RECENT');assert.equal(freshness('2026-09-11T11:15:00Z',now).label,'DELAYED');assert.equal(freshness('2026-09-11T10:00:00Z',now).label,'STALE');assert.equal(freshness(null,now).label,'UNKNOWN')});
test('release onset detector recognizes a sustained tailwater rise',()=>{const start=Date.parse('2026-09-11T10:00:00Z'),values=[7.10,7.11,7.10,7.12,7.13,7.17,7.33,7.58,7.75,7.86],rows=values.map((value,i)=>({value,time:new Date(start+i*5*60000).toISOString()})),hit=detectReleaseOnset(rows);assert.ok(hit.onset);assert.ok(hit.confidence>=80);assert.match(hit.reason,/stage rise/i)});
test('current event window excludes yesterday morning rise on consecutive release days',()=>{const now=new Date('2026-09-12T11:00:00Z'),rows=[{time:'2026-09-11T10:00:00Z',value:7.1},{time:'2026-09-11T10:15:00Z',value:7.2},{time:'2026-09-11T10:30:00Z',value:7.8},{time:'2026-09-11T10:45:00Z',value:8.1},{time:'2026-09-12T09:00:00Z',value:7.1},{time:'2026-09-12T10:00:00Z',value:7.1}];const recent=recentObservations(rows,now,18);assert.equal(recent.length,2);assert.equal(detectReleaseOnset(recent).onset,null)});
test('release onset detector does not hallucinate from a flat hydrograph',()=>{const start=Date.parse('2026-09-11T10:00:00Z'),rows=Array.from({length:12},(_,i)=>({value:7.10+(i%2?.01:0),time:new Date(start+i*5*60000).toISOString()}));assert.equal(detectReleaseOnset(rows).onset,null)});
test('flow classification is descriptive, not a safety certification',()=>{assert.equal(classifyFlow(2100).band,'low');assert.equal(classifyFlow(2800).band,'typical');assert.equal(classifyFlow(3200).band,'above');assert.equal(classifyFlow(3900).band,'big')});
test('wave arrival progresses monotonically downstream and uncertainty widens',()=>{const forecast=waveForecast('2026-09-11T10:00:00Z',2800);assert.equal(forecast.length,WAYPOINTS.length);for(let i=1;i<forecast.length;i++)assert.ok(Date.parse(forecast[i].arrivalBest)>Date.parse(forecast[i-1].arrivalBest));const pillow=forecast.find(p=>p.id==='pillow'),belva=forecast.find(p=>p.id==='belva');assert.ok(belva.uncertaintyMinutes>pillow.uncertaintyMinutes)});
test('higher effective flow modestly shortens modeled travel time',()=>assert.ok(arrivalMinutes(10,3400)<arrivalMinutes(10,2400)));
test('Meadow Nallen proxy is time-aligned before contribution is added',()=>{const now=new Date('2026-09-11T16:00:00Z'),lag=meadowTravelMinutes(400);assert.ok(lag>120);const target=now.getTime()-lag*60000,rows=[{time:new Date(target-15*60000).toISOString(),value:350},{time:new Date(target+5*60000).toISOString(),value:390},{time:now.toISOString(),value:500}],aligned=lagAlignedObservation(rows,now,lag);assert.equal(aligned.value,390);assert.ok(aligned.alignmentDeltaMinutes<=5.1)});
test('Meadow contribution is applied only at and below its confluence',()=>{const forecast=waveForecast('2026-09-11T10:00:00Z',2800,400),pillow=forecast.find(p=>p.id==='pillow'),meadow=forecast.find(p=>p.id==='meadow-confluence'),lost=forecast.find(p=>p.id==='lost-paddle');assert.equal(pillow.estimatedFlowCfs,2800);assert.equal(meadow.estimatedFlowCfs,3200);assert.equal(lost.estimatedFlowCfs,3200)});
test('point state distinguishes forecast, approaching, here now and passed',()=>{const p={arrivalStart:'2026-09-11T12:00:00Z',arrivalEnd:'2026-09-11T12:30:00Z'};assert.equal(pointState('2026-09-11T10:00:00Z',p),'FORECAST');assert.equal(pointState('2026-09-11T11:45:00Z',p),'APPROACHING');assert.equal(pointState('2026-09-11T12:10:00Z',p),'HERE NOW');assert.equal(pointState('2026-09-11T13:00:00Z',p),'PASSED')});
test('hard environmental/access concerns reduce conditions score',()=>{const base=conditionsIndex({releaseConfirmed:true,effectiveCfs:2800,weather:{precipProbability:10,windMph:5},dataConfidence:90}),warned=conditionsIndex({releaseConfirmed:true,effectiveCfs:2800,weather:{precipProbability:10,windMph:5},dataConfidence:90,activeWarnings:1,accessAlert:true});assert.ok(warned<base)});
test('percentile communicates historical context',()=>{assert.equal(percentile(300,[100,200,300,400]),75);assert.equal(percentile(null,[1,2,3]),null)});

test('release-morning forecast summarizes the planning window without inventing release timing',()=>{
  const periods=[
    {startTime:'2026-09-11T06:00:00-04:00',temperatureF:54,shortForecast:'Partly Cloudy',windMph:4,precipProbability:5},
    {startTime:'2026-09-11T08:00:00-04:00',temperatureF:58,shortForecast:'Partly Cloudy',windMph:6,precipProbability:10},
    {startTime:'2026-09-11T11:00:00-04:00',temperatureF:65,shortForecast:'Mostly Sunny',windMph:9,precipProbability:8},
    {startTime:'2026-09-11T13:00:00-04:00',temperatureF:70,shortForecast:'Sunny',windMph:10,precipProbability:5}
  ];
  const m=summarizeReleaseMorning(periods,'2026-09-11');
  assert.equal(m.temperatureLowF,54);assert.equal(m.temperatureHighF,65);assert.equal(m.precipMaxPct,10);assert.equal(m.windMaxMph,9);assert.equal(m.window,'6 AM–noon');
});

test('persona engine produces different decisions from one hydrology truth layer',()=>{
  const input={
    local:{date:'2026-09-10',hour:18,minute:30},
    release:{scheduled:false,confirmed:false,status:'BETWEEN RELEASES',nextDate:'2026-09-11',standardReleaseCfs:2800},
    river:{effectiveUpperCfs:null,effectivePostMeadowCfs:null},
    weather:{periods:[{startTime:'2026-09-11T07:00:00-04:00',temperatureF:55,shortForecast:'Mostly Sunny',windMph:5,precipProbability:5}]},
    wave:[],conditions:{activeWarnings:0},
    seasonNotice:{tailwaters:'Tailwaters parking configuration changes during Gauley season.'}
  };
  const p=buildPersonaDecisions(input);
  assert.match(p.paddler.headline,/Tomorrow is a release day/);
  assert.match(p.raft.headline,/Weather and logistics/);
  assert.equal(p.watch.facts[0].value,'Summersville Dam tailwaters');
  assert.match(p.photo.summary,/Tailwaters/);
  assert.match(p.planning.timingNote,/No release-start time is inferred/);
  assert.equal(p.paddler.facts[1].value,'Not available');
  assert.equal(p.paddler.facts[2].value,'Not available');
  assert.doesNotMatch(JSON.stringify(p),/0 CFS/);
  assert.doesNotMatch(JSON.stringify(p),/safe to paddle/i);
});

test('watch persona keeps modeled public-access timing after observed onset',()=>{
  const input={
    local:{date:'2026-09-11',hour:8,minute:30},
    release:{scheduled:true,confirmed:true,status:'RELEASE UNDERWAY',nextDate:'2026-09-12',standardReleaseCfs:2800},
    river:{effectiveUpperCfs:2800,effectivePostMeadowCfs:3150},weather:{periods:[]},
    wave:[{id:'pillow',state:'HERE NOW'},{id:'mason',state:'FORECAST',arrivalStart:'2026-09-11T13:00:00Z',arrivalEnd:'2026-09-11T13:20:00Z'}],
    conditions:{activeWarnings:0},seasonNotice:{tailwaters:'Tailwaters season parking notice.'}
  };
  const p=buildPersonaDecisions(input);
  assert.match(p.watch.facts[2].value,/modeled arrival window available on map/);
  assert.match(p.watch.headline,/tailwaters/i);
  assert.match(p.paddler.facts[1].value,/2,800 CFS/);
});

test('raft guest persona defers trip clock and instructions to the outfitter',()=>{
  const p=buildPersonaDecisions({local:{date:'2026-09-11'},release:{scheduled:true,confirmed:true,status:'RELEASE UNDERWAY',nextDate:'2026-09-12',standardReleaseCfs:2800},river:{effectiveUpperCfs:2800,effectivePostMeadowCfs:3000},weather:{periods:[]},wave:[],conditions:{activeWarnings:0},seasonNotice:{}});
  assert.match(p.raft.headline,/outfitter/i);assert.match(p.raft.caution,/not commercial trip instructions/i);assert.doesNotMatch(p.raft.summary,/launch at|put in at/i);
});
