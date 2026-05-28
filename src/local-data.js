/**
 * Local district data loader for LunchGo.
 *
 * Loads restaurant data from district-chunked JSON files (data/district_*.json)
 * and merges with Google Places results. Local data provides comprehensive
 * coverage (17K+ restaurants) while Places adds ratings, photos, and details.
 *
 * Compact array format: each district file has a `fields` header and `rows`
 * array. Rows are positional arrays, not objects.
 *
 * @module local-data
 */

import { haversine, hasValidCoordinates } from './utils.js';

/** @typedef {import('./types.js').Restaurant} Restaurant */
/** @typedef {import('./types.js').DistrictIndex} DistrictIndex */
/** @typedef {import('./types.js').DistrictData} DistrictData */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Proximity threshold in meters for dedup matching. */
const DEDUP_RADIUS_M = 50;

/** Base path for district JSON files. */
const DATA_BASE = 'data/';

// ---------------------------------------------------------------------------
// District index loading
// ---------------------------------------------------------------------------

/** Cached district index to avoid re-fetching. */
let _cachedIndex = null;

/**
 * Fetch and parse the district index manifest.
 *
 * @returns {Promise<DistrictIndex>}
 */
export async function loadDistrictIndex() {
  if (_cachedIndex) return _cachedIndex;
  const resp = await fetch(DATA_BASE + 'district_index.json');
  if (!resp.ok) throw new Error('Failed to load district index: ' + resp.status);
  _cachedIndex = await resp.json();
  return _cachedIndex;
}

// ---------------------------------------------------------------------------
// Per-district loading
// ---------------------------------------------------------------------------

/** Cache of loaded district data keyed by district name. */
const _districtCache = new Map();

/**
 * Fetch and parse a single district JSON file.
 *
 * @param {string} districtName - District key from index (e.g., 'Southern')
 * @returns {Promise<Restaurant[]>}
 */
export async function loadDistrictData(districtName) {
  if (_districtCache.has(districtName)) {
    return _districtCache.get(districtName);
  }

  const index = await loadDistrictIndex();
  const entry = index.districts[districtName];
  if (!entry) throw new Error('Unknown district: ' + districtName);

  const resp = await fetch(entry.url || entry.file);
  if (!resp.ok) throw new Error('Failed to load ' + districtName + ': ' + resp.status);

  /** @type {DistrictData} */
  const data = await resp.json();
  const restaurants = data.rows.map((row) => parseCompactRecord(row, data.fields));
  _districtCache.set(districtName, restaurants);
  return restaurants;
}

/**
 * Fetch all district files and return combined restaurant list.
 *
 * Loads districts in parallel for speed. Results are deduplicated
 * by ID (same restaurant may appear in multiple districts).
 *
 * @returns {Promise<Restaurant[]>}
 */
export async function loadAllDistrictData() {
  const index = await loadDistrictIndex();
  const districtNames = Object.keys(index.districts);

  const results = await Promise.all(
    districtNames.map((name) =>
      loadDistrictData(name).catch((err) => {
        console.warn('[LocalData] Failed to load district', name + ':', err);
        return [];
      })
    )
  );

  // Flatten and deduplicate by ID
  const seen = new Set();
  const merged = [];
  for (const list of results) {
    for (const r of list) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      }
    }
  }

  return merged;
}

/**
 * Load districts near a given location.
 *
 * Computes the centroid of each district from its cached data (or loads
 * it on demand), then returns restaurants from districts within the
 * specified radius. Falls back to all districts if none are nearby.
 *
 * @param {{ lat: number, lng: number }} loc - Target location
 * @param {number} [radiusKm=10] - Search radius in kilometers
 * @returns {Promise<Restaurant[]>}
 */
export async function loadNearbyDistricts(loc, radiusKm = 10) {
  const index = await loadDistrictIndex();
  const districtNames = Object.keys(index.districts);
  const radiusM = radiusKm * 1000;

  // Compute district centroids (cache them)
  const centroids = await Promise.all(
    districtNames.map(async (name) => {
      const restaurants = await loadDistrictData(name);
      const valid = restaurants.filter(hasValidCoordinates);
      if (valid.length === 0) return { name, lat: 0, lng: 0, count: 0 };
      let sumLat = 0, sumLng = 0;
      for (const r of valid) {
        sumLat += parseFloat(r.lat);
        sumLng += parseFloat(r.lng);
      }
      return {
        name,
        lat: sumLat / valid.length,
        lng: sumLng / valid.length,
        count: valid.length,
      };
    })
  );

  // Find nearby districts
  const nearby = centroids.filter((c) => {
    if (c.count === 0) return false;
    return haversine(loc.lat, loc.lng, c.lat, c.lng) <= radiusM;
  });

  // If no districts within radius, load all (user may be in an area
  // not covered by a single district centroid)
  const targets = nearby.length > 0 ? nearby : centroids;

  // Load all target districts in parallel
  const results = await Promise.all(
    targets.map((c) => loadDistrictData(c.name))
  );

  // Flatten and deduplicate by ID
  const seen = new Set();
  const merged = [];
  for (const list of results) {
    for (const r of list) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      }
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Compact record parser
// ---------------------------------------------------------------------------

/**
 * Convert a compact array row to a Restaurant object.
 *
 * Uses the `fields` header from the district JSON to map positional
 * values to named properties.
 *
 * @param {Array<string|number>} row - Compact array row
 * @param {string[]} fields - Field names from district JSON header
 * @returns {Restaurant}
 */
export function parseCompactRecord(row, fields) {
  /** @type {Record<string, string|number>} */
  const obj = {};
  for (let i = 0; i < fields.length && i < row.length; i++) {
    obj[fields[i]] = row[i];
  }

  // Infer source from ID prefix (district JSON v2 doesn't have source field)
  const id = String(obj.id || '');
  const inferredSource = obj.source ||
                         (id.startsWith('fehd_') ? 'fehd' :
                          id.startsWith('osm_') ? 'osm' :
                          id.startsWith('place_') ? 'places' : 'local');

  // Handle coordinates: preserve null for validation, don't convert to 0
  const rawLat = obj.lat;
  const rawLng = obj.lng;
  const lat = (rawLat === null || rawLat === undefined) ? null :
              (typeof rawLat === 'number' ? rawLat : parseFloat(String(rawLat)));
  const lng = (rawLng === null || rawLng === undefined) ? null :
              (typeof rawLng === 'number' ? rawLng : parseFloat(String(rawLng)));
  const normalizedLat = (lat === null || !isFinite(lat) || lat === 0) ? null : lat;
  const normalizedLng = (lng === null || !isFinite(lng) || lng === 0) ? null : lng;
  const explicitStatus = String(obj.location_status || obj.locationStatus || '').trim();
  const inferredStatus = explicitStatus || (
    normalizedLat === null || normalizedLng === null ? 'missing' :
    inferredSource === 'fehd'
      ? 'approximate'
      : 'exact'
  );

  return {
    id: id,
    name: String(obj.name || ''),
    name_en: String(obj.name_en || obj.name || ''),
    lat: normalizedLat,
    lng: normalizedLng,
    address: String(obj.address || ''),
    rating: 0,
    user_ratings_total: 0,
    price_level: 0,
    types: [],
    cuisine: '',
    photos: [],
    photo_refs: [],
    place_id: '',
    source: inferredSource,
    amenity: 'restaurant',
    district: String(obj.district || ''),
    district_tc: String(obj.district_tc || ''),
    licence_type: String(obj.licence_type || ''),
    expiry: String(obj.expiry || ''),
    endorsements: Array.isArray(obj.endorsements) ? obj.endorsements : [],
    location_status: inferredStatus,
  };
}

// ---------------------------------------------------------------------------
// Merge logic
// ---------------------------------------------------------------------------

/**
 * Merge local district data with Google Places results.
 *
 * Deduplication strategy:
 * 1. By place_id: if local record has a place_id matching a Places result
 * 2. By name + proximity: same name within DEDUP_RADIUS_M meters
 *
 * Places results take priority (they have ratings, photos, etc.).
 * Local records fill in gaps for restaurants not in Places.
 *
 * @param {Restaurant[]} localData - Restaurants from district JSON files
 * @param {Restaurant[]} placesData - Restaurants from Google Places API
 * @returns {Restaurant[]} Combined, deduplicated list
 */
export function mergeRestaurants(localData, placesData) {
  if (!placesData || placesData.length === 0) return localData;
  if (!localData || localData.length === 0) return placesData;

  // Build a set of Places place_ids for quick lookup
  const placesById = new Map();
  for (const p of placesData) {
    if (p.place_id) {
      placesById.set(p.place_id, p);
    }
  }

  // Dedup local data against Places: remove local records that match
  // a Places result by place_id or name+proximity
  const dedupedLocal = [];
  for (const local of localData) {
    // Check place_id match
    if (local.place_id && placesById.has(local.place_id)) {
      continue; // Places version wins
    }

    // Check name + proximity match
    let isDuplicate = false;
    const localLat = parseFloat(String(local.lat));
    const localLng = parseFloat(String(local.lng));
    const localName = (local.name || '').trim().toLowerCase();

    if (localName && isFinite(localLat) && isFinite(localLng)) {
      for (const p of placesData) {
        const pName = (p.name || '').trim().toLowerCase();
        if (pName !== localName) continue;

        const pLat = parseFloat(String(p.lat));
        const pLng = parseFloat(String(p.lng));
        if (!isFinite(pLat) || !isFinite(pLng)) continue;

        const dist = haversine(localLat, localLng, pLat, pLng);
        if (dist <= DEDUP_RADIUS_M) {
          isDuplicate = true;
          break;
        }
      }
    }

    if (!isDuplicate) {
      dedupedLocal.push(local);
    }
  }

  // Combine: local first (comprehensive), then Places (enriched)
  return [...dedupedLocal, ...placesData];
}
