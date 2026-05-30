/**
 * Google Places API service module for LunchGo.
 *
 * Wraps the Google Maps Places JavaScript SDK with:
 * - Promise-based API for async/await usage
 * - Retry logic with exponential backoff for transient failures
 * - Progress tracking for batch operations
 * - Structured error handling (invalid key, network, rate limiting)
 *
 * All functions accept a `placesService` instance (google.maps.places.PlacesService)
 * because the SDK requires a map-bound service object.
 *
 * @module api
 */

import Store from './store.js';

/** @typedef {import('./types.js').Restaurant} Restaurant */
/** @typedef {import('./types.js').Location} Location */
/** @typedef {import('./types.js').PlacesResult} PlacesResult */
/** @typedef {import('./types.js').PlacesDetails} PlacesDetails */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Places API status codes that are retryable (transient failures).
 * INVALID_REQUEST and OVER_QUERY_LIMIT are retried; ZERO_RESULTS is not.
 */
const RETRYABLE_STATUSES = new Set([
  'UNKNOWN_ERROR',
  'OVER_QUERY_LIMIT',
  'REQUEST_DENIED', // may be transient during key propagation
]);

/** Maximum retry attempts for transient failures. */
const MAX_RETRIES = 3;

/** Base delay in milliseconds for exponential backoff. */
const BASE_DELAY_MS = 500;

/** Fields requested from Places getDetails for photo enrichment. */
const PHOTO_ENRICH_FIELDS = [
  'photos',
  'formatted_address',
  'opening_hours',
  'formatted_phone_number',
  'website',
  'price_level',
];

/** Fields requested from Places getDetails for detail view. */
const DETAIL_FIELDS = [
  'name',
  'formatted_address',
  'formatted_phone_number',
  'opening_hours',
  'rating',
  'user_ratings_total',
  'price_level',
  'photos',
  'types',
  'url',
  'website',
  'geometry',
  'reviews',
];

/** Google Places types to exclude from cuisine string. */
const NON_CUISINE_TYPES = new Set([
  'restaurant',
  'food',
  'point_of_interest',
  'establishment',
]);

/** Cache key for restaurant enrichment payloads. */
const ENRICHMENT_CACHE_KEY = 'places_enrichment_cache_v1';

/** How long successful enrichment payloads stay cached. */
const ENRICHMENT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** Max number of cached enrichment entries to keep around. */
const ENRICHMENT_CACHE_MAX_ENTRIES = 500;

/** Words that do not help distinguish Hong Kong addresses. */
const ADDRESS_STOP_WORDS = new Set([
  '香港',
  '新界',
  '九龍',
  '港島',
  '中國',
  '香港特別行政區',
  '香港特區',
  '香港島',
  '商場',
  '商業',
  '商業中心',
  '中心',
  '大廈',
  '廣場',
  '樓',
  '層',
  '地下',
  '地庫',
  '地段',
  '段',
  '座',
  '室',
  '號',
  '鋪',
  '舖',
  '店',
  '部分',
  '部份',
  '位置',
  '前',
  '側',
  '旁',
  '對面',
  '露天',
  '及',
  '與',
  '和',
  '樓上',
  '樓下',
  '街市',
  '屋苑',
  '屋邨',
  '屋村',
  '村',
  '邨',
  '苑',
  '場',
  '區',
  '大樓',
  '酒店',
  '飯店',
]);

/**
 * Normalize a string for loose search matching.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Split an address into comparison tokens.
 *
 * @param {string} value
 * @returns {string[]}
 */
function tokenizeAddress(value) {
  const normalized = normalizeText(value)
    .replace(/[，,。．、;；:：()（）\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ');
  const rawTokens = normalized.match(/[\u4e00-\u9fff]+|[a-z0-9]+/g) || [];
  const tokens = [];

  for (const token of rawTokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    if (ADDRESS_STOP_WORDS.has(trimmed)) continue;
    if (/^\d+$/.test(trimmed)) continue;
    if (trimmed.length < 2) continue;
    tokens.push(trimmed);
  }

  return [...new Set(tokens)];
}

/**
 * Score whether two addresses describe the same place.
 *
 * @param {string} fehdAddress
 * @param {string} candidateAddress
 * @returns {number} 0..1
 */
function addressAgreementScore(fehdAddress, candidateAddress) {
  const a = tokenizeAddress(fehdAddress);
  const b = tokenizeAddress(candidateAddress);
  if (a.length === 0 || b.length === 0) return 0;

  const setB = new Set(b);
  let overlap = 0;
  for (const token of a) {
    if (setB.has(token)) overlap += 1;
  }

  return overlap / Math.max(a.length, b.length);
}

/**
 * Build a single text-search query from a restaurant record.
 *
 * @param {Restaurant} restaurant
 * @returns {string}
 */
function buildSearchQuery(restaurant) {
  return [
    restaurant.name || '',
    restaurant.name_en || '',
    restaurant.address || '',
    restaurant.district_tc || restaurant.district || '',
  ]
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * Build the cache entry key for a restaurant.
 *
 * @param {Restaurant} restaurant
 * @returns {string}
 */
function getEnrichmentCacheKey(restaurant) {
  return String(restaurant.id || '').trim();
}

/**
 * Read the enrichment cache and prune expired entries.
 *
 * @returns {Record<string, { ts: number, expiresAt: number, value: any }>}
 */
function readEnrichmentCache() {
  const cache = Store.get(ENRICHMENT_CACHE_KEY, {});
  const now = Date.now();
  /** @type {Record<string, { ts: number, expiresAt: number, value: any }>} */
  const fresh = {};

  for (const [key, entry] of Object.entries(cache || {})) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.expiresAt !== 'number' || entry.expiresAt <= now) continue;
    fresh[key] = entry;
  }

  if (Object.keys(fresh).length !== Object.keys(cache || {}).length) {
    Store.set(ENRICHMENT_CACHE_KEY, fresh);
  }

  return fresh;
}

/**
 * Save a successful enrichment payload in localStorage.
 *
 * @param {string} key
 * @param {*} value
 */
function writeEnrichmentCache(key, value) {
  const cache = readEnrichmentCache();
  const now = Date.now();
  cache[key] = {
    ts: now,
    expiresAt: now + ENRICHMENT_CACHE_TTL_MS,
    value,
  };

  const entries = Object.entries(cache).sort((a, b) => a[1].ts - b[1].ts);
  while (entries.length > ENRICHMENT_CACHE_MAX_ENTRIES) {
    const [oldestKey] = entries.shift();
    delete cache[oldestKey];
  }

  Store.set(ENRICHMENT_CACHE_KEY, cache);
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Structured error for Places API failures.
 *
 * @typedef {Object} PlacesError
 * @property {string} status - Google Places status string
 * @property {string} message - Human-readable error message
 * @property {string} kind - Error category: 'auth' | 'quota' | 'network' | 'unknown'
 * @property {number} [retryAfter] - Suggested retry delay in ms (for rate limiting)
 */

/**
 * Classify a Google Places status into an error category.
 *
 * @param {string} status - Google Places status code
 * @returns {PlacesError}
 */
function classifyError(status) {
  switch (status) {
    case 'INVALID_REQUEST':
      return { status, message: '無效的請求參數', kind: 'unknown' };
    case 'ZERO_RESULTS':
      return { status, message: '找不到附近餐廳', kind: 'unknown' };
    case 'OVER_QUERY_LIMIT':
      return { status, message: 'API 配額已用盡，請稍後再試', kind: 'quota', retryAfter: 2000 };
    case 'REQUEST_DENIED':
      return { status, message: 'API 請求被拒絕（請檢查 API Key）', kind: 'auth' };
    case 'NOT_FOUND':
      return { status, message: '找不到該地點', kind: 'unknown' };
    case 'UNKNOWN_ERROR':
      return { status, message: '伺服器錯誤，請稍後再試', kind: 'network' };
    default:
      return { status, message: '未知錯誤: ' + status, kind: 'unknown' };
  }
}

// ---------------------------------------------------------------------------
// Retry utility
// ---------------------------------------------------------------------------

/**
 * Sleep for a given number of milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Result object from a Places API operation.
 *
 * @typedef {Object} PlacesResult_
 * @property {*} data
 * @property {string} status
 */

/**
 * Execute an async operation with exponential backoff retry.
 *
 * @template T
 * @param {function(): Promise<PlacesResult_>} operation
 * @param {number} [maxRetries]
 * @returns {Promise<PlacesResult_>}
 */
async function withRetry(operation, maxRetries = MAX_RETRIES) {
  /** @type {PlacesResult_} */
  let lastError = { status: 'UNKNOWN_ERROR', data: null };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      if (!RETRYABLE_STATUSES.has(result.status)) {
        return result;
      }

      // Retryable failure — wait and retry
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn('[PlacesAPI] Retryable status:', result.status, '(attempt', attempt + 1, '/', maxRetries + 1, ')');
      lastError = result;
      await sleep(delay);
    } catch (err) {
      // Network-level error (e.g., timeout, offline)
      console.warn('[PlacesAPI] Network error (attempt', attempt + 1, '/', maxRetries + 1, '):', err);
      lastError = { status: 'NETWORK_ERROR', data: null };
      await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
    }
  }

  // All retries exhausted
  return lastError;
}

// ---------------------------------------------------------------------------
// Promise wrappers for callback-based Places API
// ---------------------------------------------------------------------------

/**
 * @param {any} placesService
 * @param {object} request
 * @returns {Promise<PlacesResult_>}
 */
function nearbySearchPromise(placesService, request) {
  return new Promise((resolve) => {
    placesService.nearbySearch(request, (/** @type {*} */ results, /** @type {string} */ status) => {
      resolve({ data: results || [], status });
    });
  });
}

/**
 * @param {any} placesService
 * @param {object} request
 * @returns {Promise<PlacesResult_>}
 */
function textSearchPromise(placesService, request) {
  return new Promise((resolve) => {
    placesService.textSearch(request, (/** @type {*} */ results, /** @type {string} */ status) => {
      resolve({ data: results || [], status });
    });
  });
}

/**
 * @param {any} placesService
 * @param {object} request
 * @returns {Promise<PlacesResult_>}
 */
function getDetailsPromise(placesService, request) {
  return new Promise((resolve) => {
    placesService.getDetails(request, (/** @type {*} */ details, /** @type {string} */ status) => {
      resolve({ data: details, status });
    });
  });
}

// ---------------------------------------------------------------------------
// Restaurant schema builder
// ---------------------------------------------------------------------------

/**
 * Build a Restaurant object from a Places nearbySearch result.
 * Preserves the exact schema: id, name, name_en, lat, lng, address,
 * rating, user_ratings_total, price_level, types, cuisine, photos,
 * photo_refs, place_id, source, amenity.
 *
 * @param {PlacesResult} p - Places nearbySearch result
 * @returns {Restaurant}
 */
function buildRestaurantFromPlace(p) {
  const placeId = p.place_id || Math.random().toString(36).slice(2);
  const types = p.types || [];

  return {
    id: 'place_' + placeId,
    name: p.name || '',
    name_en: p.name || '',
    lat: p.geometry?.location?.lat(),
    lng: p.geometry?.location?.lng(),
    address: p.vicinity || '',
    rating: p.rating || 0,
    user_ratings_total: p.user_ratings_total || 0,
    price_level: p.price_level || 0,
    types: types,
    cuisine: types
      .filter((t) => !NON_CUISINE_TYPES.has(t))
      .join(', '),
    photos: [],
    photo_refs: (p.photos || []).slice(0, 5).map((ph) => ph.photo_reference),
    place_id: placeId,
    source: 'places',
    amenity: 'restaurant',
    enrichment_status: 'pending',
  };
}

/**
 * Extract a cacheable enrichment payload from Google details.
 *
 * @param {PlacesDetails & { place_id?: string, name?: string, geometry?: any, rating?: number, user_ratings_total?: number, price_level?: number, types?: string[] }} place
 * @returns {Record<string, any>}
 */
function buildEnrichmentPayload(place) {
  const payload = {
    place_id: place.place_id || '',
    name: place.name || '',
    name_en: place.name || '',
    rating: place.rating || 0,
    user_ratings_total: place.user_ratings_total || 0,
    price_level: place.price_level || 0,
    opening_hours: place.opening_hours || null,
    phone: place.formatted_phone_number || '',
    website: place.website || '',
    photos: [],
    photo_refs: [],
    types: place.types || [],
    source: 'places',
    enrichment_status: 'ready',
  };

  if (place.photos && place.photos.length > 0) {
    payload.photos = place.photos.slice(0, 5).map((/** @type {*} */ ph) =>
      typeof ph.getUrl === 'function'
        ? ph.getUrl({ maxWidth: 400, maxHeight: 300 })
        : ''
    ).filter(Boolean);
    payload.photo_refs = place.photos.slice(0, 5).map((/** @type {*} */ ph) => ph.photo_reference).filter(Boolean);
  }

  if (place.geometry?.location && typeof place.geometry.location.lat === 'function') {
    payload.lat = place.geometry.location.lat();
  }
  if (place.geometry?.location && typeof place.geometry.location.lng === 'function') {
    payload.lng = place.geometry.location.lng();
  }

  return payload;
}

/**
 * Compute a loose similarity score between two restaurant names.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function nameSimilarityScore(a, b) {
  const left = normalizeText(a).replace(/[^\w\u4e00-\u9fff]+/g, '');
  const right = normalizeText(b).replace(/[^\w\u4e00-\u9fff]+/g, '');
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
 * Pick the best text-search candidate for a restaurant.
 *
 * @param {Restaurant} restaurant
 * @param {PlacesResult[]} results
 * @returns {PlacesResult|null}
 */
function pickBestTextSearchResult(restaurant, results) {
  let best = null;
  let bestScore = 0;
  const targetAddress = restaurant.address || '';
  const targetName = restaurant.name_en || restaurant.name || '';

  for (const candidate of results || []) {
    if (!candidate || !candidate.place_id) continue;
    const candidateName = candidate.name || '';
    const candidateAddress = candidate.vicinity || '';
    const nameScore = Math.max(
      nameSimilarityScore(restaurant.name || '', candidateName),
      nameSimilarityScore(targetName, candidateName),
    );
    const addressScore = addressAgreementScore(targetAddress, candidateAddress);
    const queryBias = buildSearchQuery(restaurant)
      .split(' ')
      .filter(Boolean)
      .some((part) => normalizeText(candidateName).includes(part) || normalizeText(candidateAddress).includes(part))
      ? 0.1
      : 0;
    const total = (nameScore * 0.65) + (addressScore * 0.3) + queryBias;
    if (total > bestScore) {
      bestScore = total;
      best = candidate;
    }
  }

  return bestScore >= 0.35 ? best : null;
}

/**
 * Fetch and apply enrichment for a restaurant record.
 *
 * @param {object} placesService
 * @param {Restaurant} restaurant
 * @param {object} [options]
 * @param {boolean} [options.forceRefresh=false]
 * @returns {Promise<{ restaurant: Restaurant, details: PlacesDetails|null, matchedPlace: PlacesResult|null, fromCache: boolean, status: string, error: PlacesError|null }>}
 */
async function enrichRestaurantData(placesService, restaurant, options = {}) {
  const forceRefresh = options.forceRefresh || false;
  const cacheKey = getEnrichmentCacheKey(restaurant);
  const cached = !forceRefresh ? readEnrichmentCache()[cacheKey] : null;

  if (cached && cached.value) {
    applyEnrichmentPayload(restaurant, cached.value, { keepExistingCoordinates: true });
    return {
      restaurant,
      details: /** @type {PlacesDetails|null} */ (cached.value),
      matchedPlace: null,
      fromCache: true,
      status: 'cached',
      error: null,
    };
  }

  if (!placesService || !restaurant) {
    return {
      restaurant,
      details: null,
      matchedPlace: null,
      fromCache: false,
      status: 'unavailable',
      error: { status: 'NO_SERVICE', message: 'PlacesService 未初始化', kind: 'unknown' },
    };
  }

  /** @type {PlacesDetails|null} */
  let details = null;
  /** @type {PlacesResult|null} */
  let matchedPlace = null;
  let error = null;

  if (restaurant.place_id) {
    const detailResult = await fetchPlaceDetails(placesService, restaurant.place_id);
    details = detailResult.details;
    error = detailResult.error;
  } else {
    const query = buildSearchQuery(restaurant);
    if (query) {
      const searchResult = await withRetry(() =>
        textSearchPromise(placesService, {
          query,
          type: 'restaurant',
        })
      );

      if (searchResult.status === 'OK' && Array.isArray(searchResult.data) && searchResult.data.length > 0) {
        matchedPlace = pickBestTextSearchResult(restaurant, searchResult.data);
        if (matchedPlace && matchedPlace.place_id) {
          const detailResult = await fetchPlaceDetails(placesService, matchedPlace.place_id);
          details = detailResult.details;
          error = detailResult.error;
        } else {
          error = classifyError('ZERO_RESULTS');
        }
      } else {
        error = classifyError(searchResult.status);
      }
    } else {
      error = classifyError('INVALID_REQUEST');
    }
  }

  if (details) {
    const payload = buildEnrichmentPayload({
      ...details,
      place_id: matchedPlace?.place_id || restaurant.place_id || '',
      name: details.name || matchedPlace?.name || restaurant.name,
    });
    applyEnrichmentPayload(restaurant, payload, { keepExistingCoordinates: true });
    writeEnrichmentCache(cacheKey, payload);
    return {
      restaurant,
      details,
      matchedPlace,
      fromCache: false,
      status: 'ok',
      error: null,
    };
  }

  return {
    restaurant,
    details: null,
    matchedPlace,
    fromCache: false,
    status: 'failed',
    error,
  };
}

/**
 * Enrich a restaurant card or detail view.
 *
 * @param {object} placesService
 * @param {Restaurant} restaurant
 * @param {object} [options]
 * @returns {Promise<{ restaurant: Restaurant, details: PlacesDetails|null, matchedPlace: PlacesResult|null, fromCache: boolean, status: string, error: PlacesError|null }>}
 */
async function fetchRestaurantEnrichment(placesService, restaurant, options = {}) {
  return enrichRestaurantData(placesService, restaurant, options);
}

/**
 * Apply enrichment data to an existing restaurant record.
 *
 * @param {Restaurant} restaurant
 * @param {Record<string, any>} payload
 * @param {object} [options]
 * @param {boolean} [options.keepExistingCoordinates=false]
 * @returns {Restaurant}
 */
function applyEnrichmentPayload(restaurant, payload, options = {}) {
  const keepExistingCoordinates = options.keepExistingCoordinates || false;
  const preserveAddress = options.preserveAddress !== false;

  restaurant.name = payload.name || restaurant.name || '';
  restaurant.name_en = payload.name_en || restaurant.name_en || restaurant.name || '';
  if (!preserveAddress && payload.address) {
    restaurant.address = payload.address;
  }
  restaurant.rating = payload.rating || restaurant.rating || 0;
  restaurant.user_ratings_total = payload.user_ratings_total || restaurant.user_ratings_total || 0;
  restaurant.price_level = payload.price_level || restaurant.price_level || 0;
  restaurant.opening_hours = payload.opening_hours || restaurant.opening_hours || null;
  restaurant.phone = payload.phone || restaurant.phone || '';
  restaurant.website = payload.website || restaurant.website || '';
  restaurant.photos = Array.isArray(payload.photos) ? payload.photos.slice(0, 5) : (restaurant.photos || []);
  restaurant.photo_refs = Array.isArray(payload.photo_refs) ? payload.photo_refs.slice(0, 5) : (restaurant.photo_refs || []);
  restaurant.types = Array.isArray(payload.types) ? payload.types.slice() : (restaurant.types || []);
  restaurant.cuisine = restaurant.cuisine || (
    restaurant.types
      .filter((t) => !NON_CUISINE_TYPES.has(t))
      .join(', ')
  );
  restaurant.place_id = payload.place_id || restaurant.place_id || '';
  restaurant.source = restaurant.source || payload.source || 'places';
  restaurant.enrichment_status = payload.enrichment_status || 'ready';
  restaurant.enrichment_error = '';

  if (!keepExistingCoordinates) {
    if (payload.lat !== undefined && payload.lat !== null && isFinite(payload.lat)) {
      restaurant.lat = payload.lat;
    }
    if (payload.lng !== undefined && payload.lng !== null && isFinite(payload.lng)) {
      restaurant.lng = payload.lng;
    }
  }

  return restaurant;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load nearby restaurants using Google Places nearbySearch.
 *
 * Includes retry logic for transient failures and structured error reporting.
 *
 * @param {object} placesService - google.maps.places.PlacesService instance
 * @param {Location} loc - Current location with { lat, lng }
 * @param {object} [options]
 * @param {number} [options.radius=2000] - Search radius in meters
 * @param {function(number, number): void} [options.onProgress] - Callback(current, total)
 * @returns {Promise<{ restaurants: Restaurant[], error: PlacesError|null }>}
 */
async function loadPlacesData(placesService, loc, options = {}) {
  const radius = options.radius || 2000;
  const onProgress = options.onProgress;

  if (!placesService) {
    return { restaurants: [], error: { status: 'NO_SERVICE', message: 'PlacesService 未初始化', kind: 'unknown' } };
  }

  if (onProgress) onProgress(0, 1);

  const request = {
    location: { lat: loc.lat, lng: loc.lng },
    radius: radius,
    type: 'restaurant',
  };

  const result = await withRetry(() => nearbySearchPromise(placesService, request));

  if (onProgress) onProgress(1, 1);

  if (result.status === 'OK' && result.data) {
    const restaurants = result.data.map(buildRestaurantFromPlace);
    // [PlacesAPI] Results logged via logger module
    return { restaurants, error: null };
  }

  const error = classifyError(result.status);
  console.error('[PlacesAPI] nearbySearch failed:', error);
  return { restaurants: [], error };
}

/**
 * Load nearby restaurants with a 10-second timeout.
 *
 * @param {object} placesService - google.maps.places.PlacesService instance
 * @param {Location} loc - Current location with { lat, lng }
 * @param {object} [options]
 * @returns {Promise<{ restaurants: Restaurant[], error: PlacesError|null }>}
 */
async function loadPlacesDataWithTimeout(placesService, loc, options = {}) {
  const timeoutMs = 10000;
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Places API 請求逾時')), timeoutMs);
  });

  try {
    return await Promise.race([
      loadPlacesData(placesService, loc, options),
      timeoutPromise,
    ]);
  } catch (err) {
    if (err.message && err.message.includes('逾時')) {
      return { restaurants: [], error: { status: 'TIMEOUT', message: 'API 請求逾時，請稍後再試', kind: 'network' } };
    }
    return { restaurants: [], error: { status: 'UNKNOWN_ERROR', message: err.message || '未知錯誤', kind: 'unknown' } };
  }
}

/**
 * Fetch detailed information for a single place.
 *
 * @param {object} placesService - google.maps.places.PlacesService instance
 * @param {string} placeId - Google Places place_id
 * @returns {Promise<{ details: PlacesDetails|null, error: PlacesError|null }>}
 */
async function fetchPlaceDetails(placesService, placeId) {
  if (!placesService) {
    return { details: null, error: { status: 'NO_SERVICE', message: 'PlacesService 未初始化', kind: 'unknown' } };
  }

  if (!placeId) {
    return { details: null, error: { status: 'INVALID_REQUEST', message: '缺少 place_id', kind: 'unknown' } };
  }

  const result = await withRetry(() =>
    getDetailsPromise(placesService, {
      placeId: placeId,
      fields: DETAIL_FIELDS,
    })
  );

  if (result.status === 'OK' && result.data) {
    return { details: result.data, error: null };
  }

  const error = classifyError(result.status);
  console.error('[PlacesAPI] getDetails failed for', placeId, ':', error);
  return { details: null, error };
}

/**
 * Fetch photos and enrichment data for a batch of restaurants.
 *
 * Fires onProgress(current, total) after each restaurant completes.
 * Calls onComplete(restaurants) when all are done.
 *
 * @param {Restaurant[]} places - Array of restaurant objects to enrich (mutated in place)
 * @param {object} placesService - google.maps.places.PlacesService instance
 * @param {object} [options]
 * @param {function(number, number): void} [options.onProgress] - Callback(current, total)
 * @param {function(Restaurant[]): void} [options.onComplete] - Callback(enriched places)
 * @returns {Promise<void>}
 */
async function fetchPhotosForTopRestaurants(places, placesService, options = {}) {
  const onProgress = options.onProgress;
  const onComplete = options.onComplete;

  if (!placesService || places.length === 0) {
    if (onComplete) onComplete(places);
    return;
  }

  const total = places.length;
  let completed = 0;

  // Process sequentially to avoid rate limiting
  for (const place of places) {
    if (!place.place_id) {
      completed++;
      if (onProgress) onProgress(completed, total);
      continue;
    }

    const result = await withRetry(() =>
      getDetailsPromise(placesService, {
        placeId: place.place_id,
        fields: PHOTO_ENRICH_FIELDS,
      }),
      2 // fewer retries for batch ops
    );

    if (result.status === 'OK' && result.data) {
      const details = result.data;

      // Update photos
      if (details.photos && details.photos.length > 0) {
        place.photos = details.photos.slice(0, 5).map((/** @type {*} */ ph) =>
          ph.getUrl({ maxWidth: 400, maxHeight: 300 })
        );
        place.photo_refs = details.photos.slice(0, 5).map((/** @type {*} */ ph) => ph.photo_reference);
      }

      // Update price level
      if (details.price_level) {
        place.price_level = details.price_level;
      }

      // Update hours/phone/website
      if (details.opening_hours) {
        place.opening_hours = details.opening_hours;
      }
      if (details.formatted_phone_number) {
        place.phone = details.formatted_phone_number;
      }
      if (details.website) {
        place.website = details.website;
      }
    }

    completed++;
    if (onProgress) onProgress(completed, total);
  }

  if (onComplete) onComplete(places);
}

// ---------------------------------------------------------------------------
// Legacy callback-compatible wrappers
// ---------------------------------------------------------------------------

/**
 * @param {any} state
 * @param {Location} loc
 * @param {function(): void} onUpdateDisplay
 * @param {function(string): void} onError
 * @returns {Promise<void>}
 */
async function loadPlacesDataLegacy(state, loc, onUpdateDisplay, onError) {
  if (!state.placesService || state.placesLoaded) return;

  const { restaurants, error } = await loadPlacesDataWithTimeout(state.placesService, loc);

  if (error) {
    onError(error.message);
    return;
  }

  state.placesLoaded = true;
  state.placesData = restaurants;

  const topPlaces = state.placesData.slice(0, 20);
  await fetchPhotosForTopRestaurants(topPlaces, state.placesService, {
    onComplete: () => {
      onUpdateDisplay();
    },
  });
}

/**
 * @param {any} state
 * @param {string} placeId
 * @param {function(PlacesDetails|null): void} callback
 */
function fetchPlaceDetailsLegacy(state, placeId, callback) {
  if (!state.placesService) {
    callback(null);
    return;
  }

  fetchPlaceDetails(state.placesService, placeId).then(({ details }) => {
    callback(details);
  }).catch(() => {
    callback(null);
  });
}

/**
 * @param {Restaurant[]} places
 * @param {any} state
 * @param {function(): void} onComplete
 */
function fetchPhotosForTopRestaurantsLegacy(places, state, onComplete) {
  if (!state.placesService || places.length === 0) {
    if (onComplete) onComplete();
    return;
  }

  fetchPhotosForTopRestaurants(places, state.placesService, {
    onComplete: () => {
      if (onComplete) onComplete();
    },
  });
}

/**
 * @param {any} state
 * @param {Restaurant} restaurant
 * @param {function(Restaurant|null, { details: PlacesDetails|null, matchedPlace: PlacesResult|null, fromCache: boolean, status: string, error: PlacesError|null }): void} callback
 * @param {{ forceRefresh?: boolean }} [options]
 */
function fetchRestaurantEnrichmentLegacy(state, restaurant, callback, options = {}) {
  if (!state.placesService || !restaurant) {
    callback(restaurant || null, {
      details: null,
      matchedPlace: null,
      fromCache: false,
      status: 'unavailable',
      error: { status: 'NO_SERVICE', message: 'PlacesService 未初始化', kind: 'unknown' },
    });
    return;
  }

  fetchRestaurantEnrichment(state.placesService, restaurant, options)
    .then((result) => callback(result.restaurant, result))
    .catch((error) => {
      callback(restaurant, {
        details: null,
        matchedPlace: null,
        fromCache: false,
        status: 'failed',
        error: { status: 'UNKNOWN_ERROR', message: error?.message || '未知錯誤', kind: 'unknown' },
      });
    });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  // Promise-based API (recommended)
  loadPlacesData,
  fetchPlaceDetails,
  fetchPhotosForTopRestaurants,
  fetchRestaurantEnrichment,

  // Legacy callback-compatible wrappers (for index.html migration)
  loadPlacesDataLegacy,
  fetchPlaceDetailsLegacy,
  fetchPhotosForTopRestaurantsLegacy,
  fetchRestaurantEnrichmentLegacy,

  // Utilities (useful for testing)
  buildRestaurantFromPlace,
  classifyError,
  withRetry,
};
