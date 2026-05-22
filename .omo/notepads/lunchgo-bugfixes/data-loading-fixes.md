# Data Loading Bug Fixes

## Date: 2026-05-22

## Task 1: List View Hanging + Task 2: Map View Not Showing Restaurants

### Root Causes

1. **`loadPlacesDataLegacy` sets `state.placesLoaded = true` BEFORE API call completes** (api.js:415)
   - If API fails, subsequent calls return early due to check on line 414
   - User sees hanging spinner with no recovery path

2. **`state.placesService` only created in `initMap()`** (app.js:170)
   - `initMap()` is called only when switching to map view
   - List view calls `loadPlacesData()` which requires `state.placesService`
   - Chicken-and-egg: list view can't load data without map being initialized first

3. **`renderMapMarkers` filters by `bounds.contains()` without null check** (render.js:602)
   - If map bounds aren't ready, `getBounds()` returns null/undefined
   - `bounds.contains()` throws, all markers filtered out

### Fixes Applied

#### `src/app.js`
- **Moved `state.placesService` initialization to `init()`** (line ~327)
  - Uses `new google.maps.places.PlacesService(document.createElement('div'))`
  - PlacesService accepts any HTMLElement, not just a visible map
  - Removed duplicate initialization from `initMap()`

#### `src/api.js`
- **Fixed `loadPlacesDataLegacy` to set `state.placesLoaded = true` AFTER success** (line ~413)
  - Moved flag from before API call to after successful response
  - On error, flag remains false allowing retry

- **Added `loadPlacesDataWithTimeout()` wrapper** (line ~290)
  - 10-second timeout via `Promise.race()`
  - Returns structured error with `status: 'TIMEOUT'` on expiry
  - `loadPlacesDataLegacy` now calls this instead of `loadPlacesData` directly

#### `src/render.js`
- **Fixed `renderMapMarkers` bounds null check** (line ~599)
  - If `bounds` is null/undefined, skip bounds filter and show all markers with valid coords
  - Ternary: `bounds ? list.filter(bounds.contains) : list.filter(hasCoords)`

### Verification
- All three files pass `node --check` syntax validation
- No files modified outside `src/api.js`, `src/app.js`, `src/render.js`
- Existing error handling preserved (retry logic, error banners, etc.)

---

## Task 3: Location Selection UX — Map-Based Picker with Search

### Date: 2026-05-22

### Problem
- Location modal showed hardcoded preset locations (中環、銅鑼灣、旺角、尖沙咀、鰂魚涌)
- Users had to manually add custom locations via a separate modal flow
- No search capability for finding arbitrary locations

### Changes Applied

#### `index.html` (lines 105-123)
- **Removed** `<div id="loc-list">` that rendered preset locations
- **Added** `<div class="loc-search-bar">` with search input (`#loc-search-input`)
- **Added** "在地圖上選點" button (`#map-pick-loc-btn`) alongside GPS button
- **Kept** GPS button (`#gps-btn`) and custom locations section unchanged

#### `src/app.js` (lines 371-420)
- **Changed** `showLocationModal(DEFAULT_LOCATIONS, selectLocation)` → `showLocationModal(selectLocation)`
- **Added** Google Places Autocomplete on `#loc-search-input`:
  - `types: ['geocode']` for address/place search
  - `componentRestrictions: { country: 'hk' }` to limit to Hong Kong
  - On `place_changed`: creates location object and calls `selectLocation()`
- **Added** `#map-pick-loc-btn` handler:
  - Hides modal, switches to map view
  - Listens for map click, creates location from clicked coordinates
  - Reverse geocodes via `state.geocoder` for readable label
  - Calls `selectLocation()` to switch

#### `src/render.js` (lines 1128-1185)
- **Simplified** `showLocationModal()` signature: removed `defaultLocations` parameter
- **Removed** preset location rendering (entire `#loc-list` population block)
- **Kept** custom locations rendering and delete handling unchanged

#### `src/styles.css` (lines 257-290)
- **Added** `.loc-search-bar` styles matching existing search bar pattern
- **Added** `.loc-search-results` dropdown styles (positioned below input)
- Uses existing design tokens: `var(--border)`, `var(--brand)`, `var(--bg)`, `var(--card)`

### Verification
- `node --check src/app.js` ✓
- `node --check src/render.js` ✓
- `DEFAULT_LOCATIONS` still exported (used for initial location fallback in `init()`)
- `Store.setLocation()`, `Store.addCustomLocation()`, `Store.removeCustomLocation()` APIs unchanged
- GPS functionality preserved (`useGPS()` in app.js)
- Custom location saving flow preserved (add-loc-modal still works)

---

## Task 4: Price Budget Filter

### Date: 2026-05-22

### Problem
- No price filtering existed; users could only filter by cuisine
- Requested: price filter chips ($, $, $$, $$) alongside cuisine bar

### Changes Applied

#### `src/state.js`
- **Added** `activePrice: 'all'` to `_state` initial object (line ~44)
- **Added** `@property {string} activePrice` to `LunchGoState` typedef (line ~21)
- **Added** `activePrice: 'all'` to `reset()` initial object (line ~164)

#### `src/types.js`
- **Added** `@property {string} activePrice` to `LunchGoState` typedef (line ~168)

#### `index.html` (line ~35)
- **Added** `<div class="price-bar" id="price-bar"></div>` below cuisine bar

#### `src/styles.css` (lines ~103-116)
- **Added** `.price-bar` styles matching `.cuisine-bar` pattern
- **Added** `.price-chip` styles matching `.cuisine-chip` pattern
- **Added** `.price-chip.active` with `var(--brand)` background

#### `src/app.js`
- **Added** `PRICE_LEVELS` constant: `[{id:'all',label:'全部'}, {id:'1',label:'
}, {id:'2',label:'$'}, {id:'3',label:'$
}, {id:'4',label:'$$'}]`
- **Added** `renderPriceBar()` function mirroring `renderCuisineBar()` pattern
- **Added** `renderPriceBar()` call in `init()` alongside `renderCuisineBar()`
- **Added** `.price-bar` visibility toggle in view switcher (list/map views)

#### `src/render.js` (updateDisplay, line ~383)
- **Added** price filtering after cuisine filter:
  - When `state.activePrice !== 'all'`, filters by `r.price_level === parseInt(state.activePrice, 10)`
  - Works alongside cuisine filter (both can be active simultaneously)

### Verification
- All four JS files pass `node --check` syntax validation
- No files modified outside `src/state.js`, `src/types.js`, `src/app.js`, `src/render.js`, `index.html`, `src/styles.css`
- Existing cuisine filter functionality preserved
- Restaurant schema unchanged (uses existing `price_level` property)

---

## Task 5: Merge Local JSON Data with Google Places

### Date: 2026-05-22

### Problem
- App only loaded restaurants from Google Places API (~60 results per query)
- Local JSON data in `data/district_*.json` (17,195+ restaurants) was not used by the app

### Changes Applied

#### `src/local-data.js` (NEW FILE)
- **`loadDistrictIndex()`** — fetches and caches `district_index.json`
- **`loadDistrictData(districtName)`** — fetches a single district JSON file, parses compact array format, caches result
- **`loadAllDistrictData()`** — fetches all 18 districts in parallel, deduplicates by ID
- **`loadNearbyDistricts(loc, radiusKm)`** — computes district centroids, loads only districts within radius (default 10km), falls back to all districts if none nearby
- **`parseCompactRecord(row, fields)`** — converts compact array row to full Restaurant object using `fields` header mapping
- **`mergeRestaurants(localData, placesData)`** — deduplicates by place_id or name+proximity (50m threshold via haversine), Places results take priority

#### `src/app.js`
- **Added import** for `loadNearbyDistricts` and `mergeRestaurants` from `./local-data.js`
- **Refactored `loadPlacesData()`** — now returns `Restaurant[]` instead of mutating state directly; uses `loadPlacesDataWithTimeout` from api.js directly
- **Updated `loadRestaurants()`** — two-phase loading:
  1. Load local district data first (nearby districts by location), display immediately via `updateDisplay()`
  2. Fetch Google Places, merge with local data via `mergeRestaurants()`, display combined results
  3. Graceful fallback: if local data fails, continues with Places only

### Key Design Decisions
- **Lazy loading by proximity**: `loadNearbyDistricts()` computes district centroids and only loads districts within 10km of current location, avoiding loading all 17K restaurants at once
- **Dedup strategy**: name+proximity matching (50m radius) since local data lacks place_id; Places version wins (has ratings, photos)
- **Error resilience**: local data load failure doesn't block Places API; Places failure doesn't block local data display
- **Caching**: both district index and individual district files are cached to avoid re-fetching on location changes

### Verification
- `node --check src/local-data.js` ✓
- `node --check src/app.js` ✓
- No district JSON files modified
- Restaurant schema unchanged
- Google Places integration preserved

---

## Task 6: Map UI Overlap — View Toggle & Map Tile Toggle

### Date: 2026-05-22

### Problem
- `.view-toggle` was at `bottom: 20px; right: 20px` — overlapped with Google Maps bottom-right controls (scale, map type controls)
- `.map-tile-toggle` was at `top: 10px; right: 10px` — overlapped with Google Maps top-right controls (Street View pegman, map type selector, fullscreen button)
- Both controls competed for the same screen corners as Google's injected controls

### Changes Applied

#### `src/styles.css` (line 120)
- **`.view-toggle`**: Changed from `bottom: 20px; right: 20px` → `bottom: 20px; left: 50%; transform: translateX(-50%)`
  - Centered at bottom of screen, avoids all Google Maps corner controls
  - No conflict with `.random-pick-btn` (which stays at `bottom: 20px; left: 20px`)
  - `transform: translateX(-50%)` is standard centering technique, no animation conflict

#### `src/styles.css` (line 188)
- **`.map-tile-toggle`**: Changed from `top: 10px; right: 10px` → `top: 10px; left: 10px`
  - Moved to top-left corner, away from Google Maps top-right controls
  - Google Maps zoom control is top-left by default but uses its own container; the 10px offset provides clearance
  - z-index remains `1001` (above map at `900`, below info panel at `1000`)

### Verification
- CSS brace balance: 193 open / 193 close — valid
- No files modified outside `src/styles.css`
- z-index hierarchy preserved: `map-view(900) < view-toggle(999) < map-info-panel(1000) < map-tile-toggle(1001)`
- No functional changes — only repositioning
