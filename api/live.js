import { getUSGS, getUSACE, getWeather, getNpsAlerts, latestUSGS, seriesUSGS } from '../lib/sources.js';
import { localDateParts, isIsoOnLocalDate, isReleaseDate, isFestDate, nextRelease } from '../lib/schedule.js';
import { detectReleaseOnset, recentObservations, freshness, classifyFlow, waveForecast, pointState, conditionsIndex, meadowTravelMinutes, lagAlignedObservation } from '../lib/engine.js';
import { buildPersonaDecisions } from '../lib/personas.js';

const SOURCE_BUDGET_MS = 6500;
function withinBudget(promise, label, ms=SOURCE_BUDGET_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} source budget exceeded ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control','public, s-maxage=180, stale-while-revalidate=900');
  const now = new Date();
  const local = localDateParts(now);

  const settled = await Promise.allSettled([
    withinBudget(getUSGS(),'USGS'),
    withinBudget(getUSACE(),'USACE'),
    withinBudget(getWeather(),'NWS'),
    withinBudget(getNpsAlerts(),'NPS')
  ]);
  const usgs = settled[0].status === 'fulfilled' ? settled[0].value : null;
  const usace = settled[1].status === 'fulfilled' ? settled[1].value : null;
  const weather = settled[2].status === 'fulfilled' ? settled[2].value : null;
  const nps = settled[3].status === 'fulfilled' ? settled[3].value : { enabled:false, alerts:[] };

  const parsed = usgs?.data || {};
  const tailStage = latestUSGS(parsed,'03189600','00065');
  const tailPrecip = latestUSGS(parsed,'03189600','00045');
  const belvaFlow = latestUSGS(parsed,'03192000','00060');
  const belvaStage = latestUSGS(parsed,'03192000','00065');
  const meadowFlow = latestUSGS(parsed,'03190000','00060');
  const meadowSeries = seriesUSGS(parsed,'03190000','00060');
  const tailSeries = seriesUSGS(parsed,'03189600','00065');
  const currentEventTailSeries = recentObservations(tailSeries, now, 18);
  const onset = detectReleaseOnset(currentEventTailSeries);
  const scheduled = isReleaseDate(local.date);

  const hasUsaceOutflow = Number.isFinite(usace?.outflowCfs);
  const usaceObservedFreshness = hasUsaceOutflow && usace?.outflowObservedAt ? freshness(usace.outflowObservedAt, now) : null;
  const usaceFresh = hasUsaceOutflow && usaceObservedFreshness && !usaceObservedFreshness.stale;
  const usaceUnstamped = hasUsaceOutflow && !usace?.outflowObservedAt;
  const actualReleaseSignal = usaceFresh && usace.outflowCfs >= 2000;
  const stageReleaseSignal = isIsoOnLocalDate(onset.onset, local.date);
  const confirmed = actualReleaseSignal || (scheduled && stageReleaseSignal);

  let status = 'BETWEEN RELEASES';
  let statusDetail = `Next scheduled release: ${nextRelease(local.date) || 'season complete'}`;
  if (scheduled && confirmed) {
    status = 'RELEASE UNDERWAY';
    statusDetail = actualReleaseSignal ? 'USACE outflow indicates release-level operations.' : 'Tailwater stage rise confirms the release pulse.';
  } else if (scheduled) {
    status = local.hour < 6 ? 'RELEASE DAY' : 'CONFIRMATION PENDING';
    statusDetail = local.hour < 6 ? 'A release is scheduled today; live confirmation will begin with observed operations.' : 'Release is scheduled today, but current source evidence is not strong enough to label it underway.';
  } else if (actualReleaseSignal) {
    status = 'ELEVATED RELEASE DETECTED';
    statusDetail = 'USACE outflow is elevated outside a listed 2026 recreation-release date.';
  }

  let effectiveUpper = usaceFresh ? usace.outflowCfs : null;
  let effectiveEstimated = false;
  if (!Number.isFinite(effectiveUpper) && confirmed) { effectiveUpper = 2800; effectiveEstimated = true; }
  const meadowFresh = meadowFlow ? freshness(meadowFlow.time, now) : null;
  const meadowLagMinutes = meadowFlow ? meadowTravelMinutes(meadowFlow.value) : null;
  const meadowAligned = Number.isFinite(meadowLagMinutes) ? lagAlignedObservation(meadowSeries, now, meadowLagMinutes) : null;
  const meadowUsable = meadowAligned && meadowFresh && !meadowFresh.stale && meadowAligned.alignmentDeltaMinutes <= 30;
  const meadowContribution = meadowUsable ? meadowAligned.value : null;
  const postMeadow = Number.isFinite(effectiveUpper) && Number.isFinite(meadowContribution) ? effectiveUpper + meadowContribution : effectiveUpper;
  const flowClass = classifyFlow(postMeadow);

  let confidence = 35;
  if (usaceFresh) confidence += 25;
  if (tailStage && !freshness(tailStage.time,now).stale) confidence += 18;
  if (belvaFlow && !freshness(belvaFlow.time,now).stale) confidence += 12;
  if (weather) confidence += 5;
  confidence = Math.min(95, confidence);

  const wave = confirmed && stageReleaseSignal ? waveForecast(onset.onset, effectiveUpper || 2800, meadowUsable ? meadowContribution : 0).map(p=>({ ...p, state:pointState(now.toISOString(),p) })) : [];
  const nextWave = wave.find(p => ['FORECAST','APPROACHING','HERE NOW'].includes(p.state) && p.id !== 'dam') || null;
  const activeWarnings = weather?.alerts?.filter(a=>/warning/i.test(a.event||'')).length || 0;
  const accessAlert = (nps?.alerts||[]).some(a=>/closure|closed|access/i.test(`${a.title} ${a.category}`));
  const score = conditionsIndex({ releaseConfirmed:confirmed, effectiveCfs:postMeadow, weather, activeWarnings, dataConfidence:confidence, accessAlert });

  const firstBelva = seriesUSGS(parsed,'03192000','00060')[0];
  const changeBelva = belvaFlow && firstBelva ? belvaFlow.value - firstBelva.value : null;
  const firstTail = tailSeries[0];
  const changeTail = tailStage && firstTail ? tailStage.value - firstTail.value : null;

  const seasonNotice={
    sourceDate:'2026-08-24',
    tailwaters:'Tailwaters Campground closed September 11–28 to increase parking capacity and improve traffic flow.',
    mason:"Mason’s Branch parking is limited and the access road closes when capacity is reached.",
    privateProperty:'Gated roads, posted areas and private property are not public access points.',
    source:'https://www.nps.gov/gari/planyourvisit/letter-to-gauley-boaters.htm',
    spectatorSource:'https://www.nps.gov/gari/faqs.htm',
    spectatorNote:'NPS identifies the Summersville Dam tailwaters as a place to watch rafters and boaters.'
  };

  const payload={
    generatedAt:now.toISOString(),
    local,
    mode:isFestDate(local.date) ? 'GAULEY FEST LIVE' : scheduled ? (confirmed?'RELEASE LIVE':'RELEASE FORECAST') : 'BETWEEN RELEASES',
    release:{ scheduled, confirmed, status, statusDetail, nextDate:nextRelease(local.date), standardReleaseCfs:2800, onset },
    river:{
      effectiveUpperCfs:effectiveUpper,
      effectivePostMeadowCfs:postMeadow,
      effectiveEstimated,
      flowClass,
      belvaFlowCfs:belvaFlow?.value ?? null,
      belvaStageFt:belvaStage?.value ?? null,
      meadowFlowCfs:meadowContribution,
      meadowNallenCurrentCfs:meadowFlow?.value ?? null,
      meadowLagMinutes:Number.isFinite(meadowLagMinutes)?Math.round(meadowLagMinutes):null,
      tailwaterStageFt:tailStage?.value ?? null,
      precipitationIn:tailPrecip?.value ?? null
    },
    wave,
    nextWave,
    conditions:{ score, confidence, activeWarnings, accessAlert },
    weather,
    nps,
    changes:{ belva24hCfs:changeBelva, tailwater24hFt:changeTail },
    freshness:{
      tailwater:tailStage?freshness(tailStage.time,now):null,
      belva:belvaFlow?freshness(belvaFlow.time,now):null,
      meadow:meadowFlow?freshness(meadowFlow.time,now):null,
      usace:usaceObservedFreshness
    },
    observations:{
      usaceOutflow:hasUsaceOutflow?{value:usace.outflowCfs,time:usace.outflowObservedAt,method:usace.method,series:usace.outflowSeries||null,usableForConfirmation:usaceFresh,unstamped:usaceUnstamped}:null,
      tailwaterStage:tailStage,
      belvaFlow,
      belvaStage,
      meadowFlow,
      meadowAligned
    },
    festival:{
      active:isFestDate(local.date),
      dates:'September 17–20, 2026',
      source:'https://www.americanwhitewater.org/nl/engage/events/gauley-fest/',
      note:isFestDate(local.date) ? 'Gauley Fest is underway. River status and access information on this page remain sourced separately from official agencies.' : 'Gauley Fest 2026 is September 17–20.'
    },
    seasonNotice,
    sources:{
      usgs:usgs?.url || 'https://waterdata.usgs.gov/',
      usace:usace?.url || 'https://water.usace.army.mil/overview/lrh/locations/summersville',
      nws:weather?.sourceUrl || 'https://api.weather.gov/',
      nps:'https://www.nps.gov/gari/planyourvisit/whitewater.htm',
      npsSpectator:'https://www.nps.gov/gari/faqs.htm',
      npsCommercial:'https://www.nps.gov/neri/planyourvisit/whitewater_commercial.htm',
      americanWhitewater:'https://www.americanwhitewater.org/content/River/view/river-detail/2378/main'
    },
    sourceErrors:settled.map((r,i)=>r.status==='rejected'?['USGS','USACE','NWS','NPS'][i]+': '+String(r.reason?.message||r.reason):null).filter(Boolean)
  };
  payload.personas=buildPersonaDecisions(payload);
  res.status(200).json(payload);
}
