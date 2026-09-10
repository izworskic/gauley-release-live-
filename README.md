# Gauley Release Live

A live decision-support and release-wave tracking tool for the Gauley River below Summersville Dam.

## What makes it different

This is not a gauge page. It combines authoritative release scheduling, USACE reservoir operations, USGS tailwater/downstream observations, NWS weather and an empirical release-wave routing model to answer: **where is the release water now, and when should it reach important downstream locations?**

## Data sources

- NPS Gauley River 2026 release schedule and boating-season notice
- USACE Summersville Lake current conditions
- USGS 03189600 Gauley River Below Summersville Dam: stage / precipitation
- USGS 03192000 Gauley River Above Belva: discharge / stage
- USGS 03190000 Meadow River at Nallen: lag-aligned tributary proxy (the gauge is ~11 river miles upstream of the mouth)
- NOAA/NWS point forecast and alerts
- American Whitewater for named rapid / established access geography

## Safety boundary

The conditions index describes release integrity, hydrology, weather, source confidence and access context. It is **not** a personal safety score and never determines whether someone should paddle Class IV–V whitewater.

## Run locally

The UI is static. Vercel provides the `/api/*.js` serverless functions. Tests require only Node 22.

```bash
npm test
npm run verify
```

For live NPS API alerts, optionally set `NPS_API_KEY`. Without it the product retains the verified 2026 NPS season notice and links directly to NPS for current updates.

## Model status

Release-wave timing is intentionally empirical and conservative. Arrival windows are only emitted after an observed tailwater onset is detected. Downstream uncertainty widens with distance. Meadow River contribution is never added simultaneously from Nallen; it is time-aligned to an initial modeled travel lag and remains explicitly estimated. The initial timing curve is calibrated to the published/observed broad constraint that the dam signal reaches the Belva reach on the order of several hours; live 2026 release events should be stored and used to refine the timing model.
