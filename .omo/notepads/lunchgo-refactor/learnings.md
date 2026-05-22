# LunchGo Refactor Learnings

## Task 1: Project Scaffolding (2026-05-22)
- Project had zero Node.js infrastructure before scaffolding
- Playwright 1.60.0 installed successfully
- Configured for mobile viewport testing (375x667) matching H5 target
- `tests/` directory created for test files
- `src/` directory created for future JS extraction (Task 2)
- Web server config uses `http-server` for serving static files during tests

## Task 3: State Management Module (2026-05-22)
- State object extracted from index.html:211-235 to `src/state.js`
- 19 state properties preserved exactly: placesData, filtered, currentLocation, currentLocationLabel, currentSort, searchQuery, currentView, activeCuisine, map, markers, placesService, placesLoaded, geocoder, autocomplete, randomPickResult, discoveryVisible, loadMoreIndex, loadMoreStep, loadingErrors
- Proxy-based reactivity: all property assignments trigger (key, newValue, oldValue) notifications
- subscribe() returns unsubscribe function; direct unsubscribe() also available
- reset() utility for testing with optional overrides
- package.json updated with `"type": "module"` to enable ES modules without warnings
- 26 direct state mutations found in index.html (state.xxx = patterns) - all compatible with Proxy set trap
- Array mutations (state.markers.push, state.placesData.slice) work through Proxy but only fire notification for the array property itself

## Task 4: Store (localStorage) Module (2026-05-22)
- Store object extracted from index.html:238-264 to `src/store.js` (160 lines)
- 10 methods preserved: get, set, getLocation, setLocation, getFavorites, toggleFav, isFav, getCustomLocations, addCustomLocation, removeCustomLocation
- localStorage keys use `lg_` prefix: `lg_loc`, `lg_favs`, `lg_custom_locs` — all backward compatible
- Error handling improved: `catch {}` replaced with `logStoreError()` that logs QuotaExceededError and SecurityError as console.warn
- Graceful degradation maintained: errors don't break the app, defaults are returned on get failures
- index.html script tag changed to `type="module"` to support ES module imports
- Store imported at top of module script: `import Store from './src/store.js'`
- Inline Store definition replaced with comment: `// -- Storage -- (imported from src/store.js)`

## Task 5: Utility Functions Module (2026-05-22)
- 7 utility functions extracted from index.html to `src/utils.js` (177 lines)
- Functions: `haversine()`, `formatDist()`, `renderStars()`, `priceLevel()`, `escHtml()`, `escAttr()`, `matchCuisine()`
- All functions are pure (no side effects) and exported as named exports
- `matchCuisine()` improved: CUISINE_MAP extracted as module-level constant, Chinese character patterns separated into `NOODLE_CN_PATTERNS` and `MIXIAN_CN_PATTERNS` arrays
- Bug fix: original `matchCuisine()` used `nameCn.toLowerCase()` for Chinese char matching — now uses original case since Chinese characters are case-insensitive and `.toLowerCase()` was unnecessary
- All 42 call sites in index.html preserved — function signatures unchanged
- index.html reduced by ~80 lines (from 1466 to 1387)
- Verified: all functions produce identical output via node test

## Task 6: Type Definitions + JSDoc (2026-05-22)
- Created `src/types.js` with 20+ JSDoc typedefs covering all domain types
- Types defined: Restaurant (22 fields), Location (DefaultLocation + CustomLocation union), LunchGoState (19 properties), Store (10 methods), PlacesResult, PlacesDetails, PlacesGeometry, PlacesPhoto, PlacesOpeningHours, CuisineOption, DistrictIndex, DistrictEntry, DistrictRow, DistrictData, SortConfig, MapsConfig
- Restaurant type covers both Google Places source (all fields) and FEHD/OSM pipeline source (optional rating, photos, etc.)
- DistrictRow documents the compact array format: positional fields [id, name, name_en, lat, lng, address, district, district_tc, licence_type, expiry, endorsements]
- Created `tsconfig.json` with checkJs enabled, noEmit, strict mode, ES2020 target
- Installed TypeScript as dev dependency (package.json updated)
- Fixed type errors in existing modules:
  - state.js: Array typedefs now use typed generics (Restaurant[], string[]), Proxy set trap narrowed key to string, reset() uses keyof cast for safe iteration
  - store.js: catch blocks cast unknown to Error for strict mode compatibility
  - utils.js: matchCuisine() param typed as Restaurant via import('./types.js')
- `npx tsc --noEmit` passes with zero errors
- Types.js uses `export {}` to be a valid ES module without runtime exports
- src/state.js and src/store.js now import types from types.js via JSDoc `@import` syntax

## Task 7: Python Test Infrastructure (2026-05-22)
- Created `requirements-test.txt` with pytest>=7.0 and pytest-cov>=4.0
- Created `pytest.ini` configured for test discovery in `scripts/` directory
- Created `scripts/test_enrich_data.py` with 11 tests covering pure functions:
  - `normalize_name()` — suffix stripping, empty input
  - `name_similarity()` — identical names, unrelated names
  - `haversine_km()` — known distance, same point
  - `assign_district()` — valid district code for HK coordinates
  - `parse_osm_element()` — valid element, missing name, missing coords
- Test module uses `sys.path.insert` + `importlib` to import enrich_data without __init__.py
- System Python is 3.14.4 (CI uses 3.11 — compatible)
- `python3 -m pytest scripts/test_enrich_data.py -v` passes 11/11
- No modifications to enrich_data.py logic
- No heavy dependencies added (stdlib + requests only)

## Task 8: Google Places API Service Module (2026-05-22)
- Created `src/api.js` (489 lines) extracting Google Places integration from index.html
- Three primary exports: `loadPlacesData()`, `fetchPlaceDetails()`, `fetchPhotosForTopRestaurants()`
- Promise-based API with retry logic (exponential backoff, max 3 retries for transient failures)
- Error classification system: `classifyError()` maps Google status codes to {status, message, kind}
- Retryable statuses: UNKNOWN_ERROR, OVER_QUERY_LIMIT, REQUEST_DENIED
- Restaurant schema preserved exactly: id, name, name_en, lat, lng, address, rating, user_ratings_total, price_level, types, cuisine, photos, photo_refs, place_id, source, amenity
- Legacy wrappers (`loadPlacesDataLegacy`, etc.) for drop-in replacement in index.html
- index.html inline functions replaced with thin delegating wrappers (lines 244-280)
- `npx tsc --noEmit` passes with zero errors
- `@type` inline casts required for Google Maps SDK callback params (no TypeScript definitions)
- `PlacesResult_` typedef needed for `withRetry` generic return type inference

## Task 15: Python Data Pipeline Modernization (2026-05-22)
- `scripts/enrich_data.py` modernized: 503 → 604 lines (net +101 from new helpers, -100 from removed docstrings)
- Added `from __future__ import annotations` for forward reference type hints
- All 10 public functions have type hints (parameters + return types)
- Type aliases defined: `FehdRecord`, `OsmElement`, `ParsedOsmPlace`, `MergedRestaurant`
- Replaced `urllib.request` with `requests` library (already installed system-wide v2.32.5)
- Created `requirements.txt` with `requests>=2.28.0`
- Added `_retry_with_backoff()` helper with exponential backoff (2s → 4s → 8s, max 60s, 3 retries)
- Added `_http_get()` and `_http_post()` wrappers with standard headers and `raise_for_status()`
- Replaced all `print()` calls with `logging` module (`logger.info`, `logger.warning`, `logger.error`)
- Added `_setup_logging()` with `--verbose`/`-v` CLI flag support
- FIELDS array order preserved exactly — compact JSON output format unchanged
- FEHD XML parsing logic unchanged (same `ET.fromstring`, same tag extraction)
- Overpass query structure unchanged (same endpoints, same query string)
- All 11 existing tests pass without modification
- Module docstring preserved (existed in original)
- Section divider comments preserved (existed in original as organizational markers)
