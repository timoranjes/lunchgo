# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-22
**Commit:** 9a6e640
**Branch:** main

## OVERVIEW
LunchGo 搵食 — H5 mobile web app for finding lunch spots in Hong Kong. Single-file vanilla JS SPA using Google Maps + Places API. Python data pipeline fetches FEHD government licenses + OpenStreetMap data.

## STRUCTURE
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

## CONVENTIONS
- **No build step** — edit files directly, deploy static
- **Single-file architecture** — all HTML/CSS/JS in `index.html`
- **CSS variables** — theming via `:root` vars (brand: `#07C160`)
- **localStorage keys** — always prefixed `lg_`
- **Python scripts** — stdlib only + `requests`; no virtualenv, no requirements.txt
- **Data format** — district JSON uses compact array format, not object-per-record
- **Language** — Traditional Chinese (zh-TW/zh-HK) for UI text

## ANTI-PATTERNS (THIS PROJECT)
- **Do NOT split `index.html`** — architecture is intentionally single-file; no bundler exists
- **Do NOT add framework** — vanilla JS only; no React/Vue/Svelte
- **Do NOT add build tooling** — no webpack/vite/parcel; direct static hosting
- **Hardcoded API key** — `GOOGLE_MAPS_API_KEY` in `index.html` line ~637 (placeholder `YOUR_API_KEY_HERE`)
- **Error swallowing** — `catch {}` in Store.get/set (line ~700) — intentional for localStorage quota errors
- **No tests** — zero test coverage; manual QA only
- **Legacy data files** — `hk_restaurants.json` and `hk_restaurants_v2.json` are deprecated; use `district_*.json`

## UNIQUE STYLES
- **District-chunked data** — 18 district JSON files for lazy loading (not used by current app; pipeline output)
- **FEHD + OSM merge** — multi-strategy matching: exact name → proximity + name similarity
- **WeChat-style UI** — green brand `#07C160`, rounded cards, mobile-first
- **Cuisine matching** — bilingual (English types + Chinese chars in name/address)

## COMMANDS
```bash
# Run data pipeline locally
python scripts/enrich_data.py

# Run legacy data fetcher
python scripts/update_restaurants.py

# No build/test commands — static files only
```

## NOTES
- Google Maps API key must be replaced in `index.html` before deployment
- GitHub Actions runs daily at 2AM UTC; commits directly to `main`
- Data directory contains 17,195+ restaurants across 18 HK districts
- App uses Google Places API at runtime, NOT local JSON files (local data is pipeline output only)
