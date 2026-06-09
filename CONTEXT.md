# LunchGo — Project Context

**Last updated:** 2026-06-09
**Status:** Active — deployed, daily data refresh via GitHub Actions

## OVERVIEW
LunchGo 搵食 — H5 mobile web app for finding lunch spots in Hong Kong. Vanilla JS SPA + Google Maps/Places API. Python data pipeline (FEHD licenses + OSM).

## CURRENT FOCUS
- App is functional and deployed
- Daily automated data refresh (2AM UTC via GitHub Actions)
- 17,195+ restaurants across 18 HK districts

## RESEARCH & DECISIONS
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05 | Single-file architecture | No build step needed for this scale; simpler deployment |
| 2026-05 | District-chunked data | Lazy loading for performance; 18 separate JSON files |
| 2026-05 | FEHD + OSM merge | Government license data + OpenStreetMap for comprehensive coverage |
| 2026-05 | Vanilla JS only | No framework overhead; target audience uses low-end phones |

## KEY FINDINGS
- FEHD (Food and Environmental Hygiene Department) publishes license data as XML
- Overpass API (OpenStreetMap) provides restaurant locations + cuisine tags
- Multi-strategy matching: exact name → proximity + name similarity for merging datasets
- Google Places API used at runtime for live data; local JSON is pipeline output only

## KNOWN ISSUES
- Google Maps API key is placeholder in index.html — needs real key for deployment
- No test coverage — manual QA only
- Legacy data files (hk_restaurants.json, hk_restaurants_v2.json) still in repo but deprecated

## NEXT STEPS
- Replace API key placeholder for production
- Consider adding user reviews/ratings
- Expand cuisine matching accuracy
