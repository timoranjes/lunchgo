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

/**
 * Normalize a restaurant name for merge matching.
 *
 * Strips punctuation and spaces so "McDonald's" and "Mcdonalds" both map
 * to the same key while keeping Chinese names intact.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeRestaurantName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^0-9a-z\u4e00-\u9fff]+/g, '');
}

/**
 * Compare two restaurant names for loose matching.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function nameSimilarityScore(a, b) {
  const left = normalizeRestaurantName(a);
  const right = normalizeRestaurantName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.95;

  const leftTokens = left.match(/[\u4e00-\u9fff]+|[a-z0-9]+/g) || [];
  const rightTokens = right.match(/[\u4e00-\u9fff]+|[a-z0-9]+/g) || [];
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const rightSet = new Set(rightTokens);
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightSet.has(token)) overlap += 1;
  }

  return overlap / Math.max(leftTokens.length, rightTokens.length);
}

/**
 * Merge Google Places extras into a local restaurant record without
 * overwriting canonical FEHD fields like address or coordinates.
 *
 * @param {import('./types.js').Restaurant} local
 * @param {import('./types.js').Restaurant} place
 */
function mergeGooglePlaceIntoLocal(local, place) {
  if (!local || !place) return;

  local.place_id = local.place_id || place.place_id || '';
  local.rating = place.rating || local.rating || 0;
  local.user_ratings_total = place.user_ratings_total || local.user_ratings_total || 0;
  local.price_level = place.price_level || local.price_level || 0;
  local.types = Array.isArray(place.types) && place.types.length > 0 ? place.types.slice() : (local.types || []);
  local.cuisine = local.cuisine || place.cuisine || (
    local.types
      .filter((t) => String(t || '').trim())
      .join(', ')
  );
  local.photos = Array.isArray(place.photos) ? place.photos.slice(0, 5) : (local.photos || []);
  local.photo_refs = Array.isArray(place.photo_refs) ? place.photo_refs.slice(0, 5) : (local.photo_refs || []);
  local.phone = place.phone || local.phone || '';
  local.website = place.website || local.website || '';
  local.opening_hours = place.opening_hours || local.opening_hours || null;
  local.business_status = place.business_status || local.businessStatus || local.business_status || '';
  local.permanently_closed = place.permanently_closed === true || local.permanently_closed === true;
  local.enrichment_status = local.enrichment_status || 'pending';
}

function normalizeBusinessStatus(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

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

  const businessStatus = String(obj.business_status || obj.businessStatus || '').trim();
  const permanentlyClosed = obj.permanently_closed === true || obj.permanently_closed === 'true';

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
    business_status: businessStatus,
    permanently_closed: permanentlyClosed,
    enrichment_status: inferredSource === 'places' ? 'ready' : 'pending',
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

  const mergedLocal = localData.map((restaurant) => ({ ...restaurant }));

  /** @type {Map<string, import('./types.js').Restaurant[]>} */
  const localByName = new Map();
  for (const local of mergedLocal) {
    for (const rawName of [local.name, local.name_en]) {
      const key = normalizeRestaurantName(rawName);
      if (!key) continue;
      if (!localByName.has(key)) {
        localByName.set(key, []);
      }
      localByName.get(key).push(local);
    }
  }

  const matchedLocalIds = new Set();
  const matchedPlaceIds = new Set();

  for (const place of placesData) {
    const placeId = String(place.place_id || '').trim();
    const businessStatus = normalizeBusinessStatus(place?.business_status || place?.businessStatus || '');
    const isClosedPlace =
      !!place &&
      (place.permanently_closed === true || businessStatus === 'CLOSED_PERMANENTLY' || businessStatus === 'CLOSED');
    const exactKeys = [
      normalizeRestaurantName(place.name),
      normalizeRestaurantName(place.name_en),
    ].filter(Boolean);

    let bestLocal = null;
    let bestScore = 0;

    /**
     * Evaluate a local record as a potential match.
     *
     * @param {import('./types.js').Restaurant} local
     */
    const consider = (local) => {
      if (!local || matchedLocalIds.has(local.id)) return;

      if (placeId && local.place_id && String(local.place_id).trim() === placeId) {
        bestLocal = local;
        bestScore = 1;
        return;
      }

      const nameScore = Math.max(
        nameSimilarityScore(local.name, place.name),
        nameSimilarityScore(local.name, place.name_en),
        nameSimilarityScore(local.name_en, place.name),
        nameSimilarityScore(local.name_en, place.name_en),
      );
      if (nameScore < 0.75) return;

      let score = nameScore;
      const localHasCoords = hasValidCoordinates(local);
      const placeHasCoords = hasValidCoordinates(place);
      if (localHasCoords && placeHasCoords) {
        const localLat = parseFloat(String(local.lat));
        const localLng = parseFloat(String(local.lng));
        const placeLat = parseFloat(String(place.lat));
        const placeLng = parseFloat(String(place.lng));
        const dist = haversine(localLat, localLng, placeLat, placeLng);
        if (dist > DEDUP_RADIUS_M) return;
        score += Math.max(0, (DEDUP_RADIUS_M - dist) / DEDUP_RADIUS_M) * 0.2;
      } else if (nameScore < 0.9) {
        return;
      }

      const localAddress = String(local.address || '');
      const placeAddress = String(place.address || place.vicinity || '');
      if (localAddress && placeAddress) {
        const localTokens = localAddress
          .normalize('NFKC')
          .toLowerCase()
          .replace(/[，,。．、;；:：()（）\[\]{}]/g, ' ')
          .match(/[\u4e00-\u9fff]+|[a-z0-9]+/g) || [];
        const placeTokens = placeAddress
          .normalize('NFKC')
          .toLowerCase()
          .replace(/[，,。．、;；:：()（）\[\]{}]/g, ' ')
          .match(/[\u4e00-\u9fff]+|[a-z0-9]+/g) || [];
        const localSet = new Set(localTokens.filter((token) => token.length > 1));
        const placeSet = new Set(placeTokens.filter((token) => token.length > 1));
        let overlap = 0;
        for (const token of localSet) {
          if (placeSet.has(token)) overlap += 1;
        }
        const addressScore = overlap / Math.max(localSet.size, placeSet.size, 1);
        const localDistrict = String(local.district_tc || local.district || '').trim();
        const placeDistrict = String(place.district_tc || place.district || '').trim();
        const districtMismatch = localDistrict && placeDistrict && localDistrict !== placeDistrict;
        const isStrictSameName = nameScore >= 0.95;
        const hasStrongAddress = addressScore >= 0.5;

        if (districtMismatch && !hasStrongAddress && !isStrictSameName) return;
        if (addressScore < 0.2 && districtMismatch) return;
        if (addressScore < 0.25 && !isStrictSameName) return;
      }

      if (score > bestScore) {
        bestScore = score;
        bestLocal = local;
      }
    };

    for (const key of exactKeys) {
      const candidates = localByName.get(key) || [];
      for (const local of candidates) {
        consider(local);
      }
    }

    if (!bestLocal) {
      for (const local of mergedLocal) {
        consider(local);
      }
    }

    if (bestLocal) {
      matchedLocalIds.add(bestLocal.id);
      if (placeId) {
        matchedPlaceIds.add(placeId);
      }
      if (isClosedPlace) {
        bestLocal.business_status = 'CLOSED_PERMANENTLY';
        bestLocal.permanently_closed = true;
      } else {
        mergeGooglePlaceIntoLocal(bestLocal, place);
      }
      continue;
    }

    if (isClosedPlace) {
      if (placeId) {
        matchedPlaceIds.add(placeId);
      }
      continue;
    }
  }

  const unmatchedPlaces = placesData.filter((place) => {
    const placeId = String(place.place_id || '').trim();
    return !placeId || !matchedPlaceIds.has(placeId);
  });

  const combined = [...mergedLocal, ...unmatchedPlaces];
  return combined.filter((restaurant) => {
    const businessStatus = normalizeBusinessStatus(restaurant?.business_status || restaurant?.businessStatus || '');
    if (restaurant?.permanently_closed === true || businessStatus === 'CLOSED_PERMANENTLY' || businessStatus === 'CLOSED') {
      return false;
    }
    return true;
  });
}
