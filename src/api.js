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
  };
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
    console.log('[PlacesAPI] Loaded ' + restaurants.length + ' Places results');
    return { restaurants, error: null };
  }

  const error = classifyError(result.status);
  console.error('[PlacesAPI] nearbySearch failed:', error);
  return { restaurants: [], error };
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

      // Update address if better
      if (details.formatted_address) {
        place.address = details.formatted_address;
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
  state.placesLoaded = true;

  const { restaurants, error } = await loadPlacesData(state.placesService, loc);

  if (error) {
    onError(error.message);
    return;
  }

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

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  // Promise-based API (recommended)
  loadPlacesData,
  fetchPlaceDetails,
  fetchPhotosForTopRestaurants,

  // Legacy callback-compatible wrappers (for index.html migration)
  loadPlacesDataLegacy,
  fetchPlaceDetailsLegacy,
  fetchPhotosForTopRestaurantsLegacy,

  // Utilities (useful for testing)
  buildRestaurantFromPlace,
  classifyError,
  withRetry,
};
