# AGENTS.md — projects/lunchgo/

## Scope
LunchGo 搵食 — H5 mobile web app for finding lunch spots in Hong Kong. Single-file vanilla JS SPA using Google Maps + Places API. Python data pipeline fetches FEHD government licenses + OpenStreetMap data.

**Last updated:** 2026-06-09
**Status:** Active — deployed, daily data refresh via GitHub Actions

## Structure
```
lunchgo/
├── index.html              # ENTIRE APP — HTML + CSS + JS (1952 lines)
├── data/                   # Restaurant JSON (district-chunked, 22 files)
├── scripts/                # Python data pipeline (2 files)
│   ├── update_restaurants.py  # Legacy: district-by-district Overpass fetch
│   └── enrich_data.py         # Current: FEHD + OSM merge with proximity matching
└── .github/workflows/
    └── update-restaurants.yml # Daily cron (2AM UTC) → runs enrich_data.py → commits
```

## Commands
```bash
# Run data pipeline locally
python scripts/enrich_data.py

# Run legacy data fetcher
python scripts/update_restaurants.py

# No build/test commands — static files only
```

## Boundaries
✅ Allowed: Edit index.html, scripts, data pipeline
✅ Allowed: Modify GitHub Actions workflow
❌ Never: Split index.html into multiple files (single-file architecture)
❌ Never: Add framework (React/Vue/Svelte) or build tooling (webpack/vite)
❌ Never: Expose Google Maps API key in public repos

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| UI changes | `index.html` lines 7-469 (CSS) | CSS vars in `:root`, mobile-first |
| App logic | `index.html` lines 640+ (JS) | All vanilla JS, no modules |
| State management | `index.html` ~line 672 | `const state = {...}` |
| localStorage | `index.html` ~line 699 | `const Store = {...}`, keys prefixed `lg_` |
| Google Places integration | `index.html` ~line 809 | `loadPlacesData()`, `fetchPlaceDetails()` |
| Restaurant rendering | `index.html` ~line 1055 | `renderList()`, `renderDiscovery()` |
| Map view | `index.html` ~line 1376 | `renderMapMarkers()` |
| Random picker | `index.html` ~line 1224 | `openRandomPick()` |
| Data pipeline | `scripts/enrich_data.py` | FEHD XML + Overpass API → district JSON |
| Data schema | `data/district_index.json` | Index manifest for lazy loading |
| CI/CD | `.github/workflows/update-restaurants.yml` | Daily data refresh |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `state` | Object | index.html:672 | Runtime state (places, filters, view, map) |
| `Store` | Object | index.html:699 | localStorage wrapper (favs, locations) |
| `CUISINES` | Array | index.html:645 | 15 cuisine filter options |
| `DEFAULT_LOCATIONS` | Array | index.html:664 | 5 hardcoded HK locations |
| `loadPlacesData()` | Function | index.html:809 | Google Places nearbySearch |
| `updateDisplay()` | Function | index.html:933 | Main render orchestrator |
| `renderList()` | Function | index.html:1055 | Card list with pagination |
| `showDetail()` | Function | index.html:1408 | Restaurant detail view |
| `haversine()` | Function | index.html:728 | Distance calculation |
| `matchCuisine()` | Function | index.html:762 | Cuisine filter with CN char matching |

## Conventions
- **No build step** — edit files directly, deploy static
- **Single-file architecture** — all HTML/CSS/JS in `index.html`
- **CSS variables** — theming via `:root` vars (brand: `#07C160`)
- **localStorage keys** — always prefixed `lg_`
- **Python scripts** — stdlib only + `requests`; no virtualenv, no requirements.txt
- **Data format** — district JSON uses compact array format, not object-per-record
- **Language** — Traditional Chinese (zh-TW/zh-HK) for UI text

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
- 17,195+ restaurants across 18 HK districts

## KNOWN ISSUES
- Google Maps API key is placeholder in index.html — needs real key for deployment
- No test coverage — manual QA only
- Legacy data files (hk_restaurants.json, hk_restaurants_v2.json) still in repo but deprecated

## NEXT STEPS
- Replace API key placeholder for production
- Consider adding user reviews/ratings
- Expand cuisine matching accuracy
