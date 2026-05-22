# LunchGo Bug Fixes & Feature Additions

**Created:** 2026-05-22
**Branch:** main

## Context

The LunchGo app has been refactored from single-file to modular ES6+ architecture. Now we need to fix bugs and add features reported by the user.

## Issues to Fix

### 1. List View Hanging + Map View Empty
- **Symptom**: App hangs on "載入餐廳..." spinner, list never populates
- **Root cause**: Google Places API may be failing silently or timing out
- **Fix**: Add proper error handling, timeout, and fallback to local JSON data

### 2. Location Selection UX
- **Current**: Shows preset locations (中環、銅鑼灣、旺角、尖沙咀、鰂魚涌)
- **Requested**: Remove presets, allow users to search and select map locations directly
- **Fix**: Replace preset list with map-based location picker + search autocomplete

### 3. Price Budget Filter
- **Missing**: No price range filtering
- **Requested**: Add price budget filter ($, $$, $$$, $$$$)
- **Fix**: Add price filter chips alongside cuisine filter

### 4. Restaurant Data Completeness
- **Current**: Only Google Places API (limited results per query)
- **Requested**: More comprehensive data like OpenRice
- **Fix**: Merge local JSON data (FEHD + OSM from data pipeline) with Google Places results

### 5. Map UI Overlap
- **Current**: View toggle buttons (列表、地圖) overlap with Google Maps controls
- **Fix**: Reposition view toggle or adjust z-index/positioning

## TODOs

- [x] 1. Fix list view hanging - add timeout, error recovery, fallback to local data
- [x] 2. Fix map view not showing restaurants - debug marker rendering
- [x] 3. Remove preset locations, implement map-based location picker with search
- [x] 4. Add price budget filter ($, $$, $$$, $$$$)
- [x] 5. Merge local JSON data with Google Places for comprehensive restaurant list
- [x] 6. Fix map UI overlap - reposition view toggle buttons

## Final Verification Wave

- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright skill)
- [x] F4. Scope Fidelity Check — deep
