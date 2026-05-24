/**
 * LunchGo Utility Functions
 *
 * Pure utility functions for distance calculation, formatting,
 * HTML escaping, and cuisine matching.
 *
 * @module utils
 */

/**
 * Calculate the great-circle distance between two points on Earth
 * using the Haversine formula.
 *
 * @param {number} lat1 - Latitude of point 1 (degrees)
 * @param {number} lon1 - Longitude of point 1 (degrees)
 * @param {number} lat2 - Latitude of point 2 (degrees)
 * @param {number} lon2 - Longitude of point 2 (degrees)
 * @returns {number} Distance in meters
 */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Format a distance in meters to a human-readable string.
 *
 * @param {number} m - Distance in meters
 * @returns {string} Formatted distance (e.g., "350m", "1.2km") or empty string for invalid input
 */
export function formatDist(m) {
  if (m === undefined || m === null || isNaN(m)) return '';
  return m < 1000 ? Math.round(m) + 'm' : (m / 1000).toFixed(1) + 'km';
}

/**
 * Render a star rating string using Unicode star characters.
 *
 * @param {number} rating - Rating value (0-5)
 * @returns {string} Star string (e.g., "★★★☆☆") or empty string for no rating
 */
export function renderStars(rating) {
  if (!rating) return '';
  const full = Math.floor(rating);
  const half = rating - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '\u2605'.repeat(full) + (half ? '\u2606' : '') + '\u2606'.repeat(empty);
}

/**
 * Format a price level as dollar signs.
 *
 * @param {number} n - Price level (1-4)
 * @returns {string} Dollar sign string (e.g., "$$  ") or empty string for no price
 */
export function priceLevel(n) {
  if (!n) return '';
  return '$'.repeat(n) + ' '.repeat(Math.max(0, 4 - n));
}

/**
 * Escape HTML special characters for safe insertion into HTML content.
 *
 * @param {*} s - Value to escape (converted to string)
 * @returns {string} HTML-escaped string
 */
export function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escape HTML special characters for safe insertion into HTML attribute values.
 *
 * @param {*} s - Value to escape (converted to string)
 * @returns {string} Attribute-escaped string
 */
export function escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Cuisine keyword mapping for matching places to cuisine categories.
 * Each cuisine ID maps to an array of keywords to search in types, cuisine, and name fields.
 *
 * @type {Record<string, string[]>}
 */
const CUISINE_MAP = {
  chinese: ['chinese', 'chinese_restaurant', 'dim_sum', 'cantonese', 'asian'],
  noodle: [
    'noodle', 'ramen', 'noodle_shop', '麵', '粉', '米线', '米線',
    '河粉', '伊麵', '意粉',
  ],
  mixian: ['mixian', '米線', '米线', '譚仔', '谭仔', '一風堂', 'monsoon'],
  japanese: ['japanese', 'japanese_restaurant', 'sushi', 'ramen', '居酒屋', '日料'],
  western: ['western', 'american', 'european', 'french', 'british'],
  fast_food: ['fast_food', 'meal_takeaway', 'meal_delivery', '快餐', '茶餐廳', '冰室'],
  cafe: ['cafe', 'coffee', 'bakery', 'dessert', '咖啡', 'cake'],
  seafood: ['seafood', '海鮮'],
  korean: ['korean', 'korean_restaurant', '韓式', 'bbq', '烤肉'],
  thai: ['thai', 'thai_restaurant', '泰式'],
  italian: ['italian', 'italian_restaurant', 'pizza', '意式'],
  bbq: ['bbq', 'barbecue', '烧烤', '燒烤', '烤肉', '串燒'],
  hotpot: ['hotpot', 'hot_pot', '火鍋', '打边炉', '打邊爐'],
  dessert: ['dessert', 'dessert_shop', '甜品', '糖水', 'ice_cream', '冰淇淋'],
};

/**
 * Chinese character patterns for enhanced noodle cuisine matching.
 * Checks name and address fields for specific Chinese characters.
 *
 * @type {string[]}
 */
const NOODLE_CN_PATTERNS = ['麵', '面', '粉', '河粉', '伊麵'];

/**
 * Chinese character patterns for enhanced mixian cuisine matching.
 * Checks name field for mixian-related Chinese terms.
 *
 * @type {string[]}
 */
const MIXIAN_CN_PATTERNS = ['米线', '米線', '譚仔', '谭仔'];

/**
 * Check if a place matches a given cuisine category.
 *
 * @param {import('./types.js').Restaurant} place - Place object
 * @param {string} cuisineId - Cuisine category ID
 * @returns {boolean} True if the place matches the cuisine category
 */
export function matchCuisine(place, cuisineId) {
  if (cuisineId === 'all') return true;

  const types = (place.types || []).join(' ').toLowerCase();
  const cuisine = (place.cuisine || '').toLowerCase();
  const name = (place.name || '').toLowerCase();
  const nameCn = place.name || ''; // Keep original case for Chinese char matching
  const address = (place.address || '').toLowerCase();

  // Enhanced mixian matching: check Chinese characters in name
  if (cuisineId === 'mixian') {
    for (const pattern of MIXIAN_CN_PATTERNS) {
      if (nameCn.includes(pattern)) return true;
    }
  }

  // Enhanced noodle matching: check Chinese characters in name and address
  if (cuisineId === 'noodle') {
    for (const pattern of NOODLE_CN_PATTERNS) {
      if (nameCn.includes(pattern) || address.includes(pattern)) return true;
    }
  }

  // Standard keyword matching across types, cuisine, and name
  const keywords = CUISINE_MAP[cuisineId] || [];
  return keywords.some(
    (k) => types.includes(k) || cuisine.includes(k) || name.includes(k)
  );
}

/**
 * Validate a restaurant object for display-worthiness.
 * Filters out entries with missing/invalid names, bad coordinates,
 * and unmatched FEHD records that have fake hash-generated locations.
 *
 * @param {import('./types.js').Restaurant} restaurant - Restaurant to validate
 * @returns {boolean} True if the restaurant should be displayed
 */
export function isValidRestaurant(restaurant) {
  const name = (restaurant.name || '').trim();
  if (name.length < 2) return false;

  if (restaurant.lat === undefined || restaurant.lat === null ||
      restaurant.lng === undefined || restaurant.lng === null) {
    return false;
  }

  const lat = parseFloat(/** @type {string} */ (restaurant.lat));
  const lng = parseFloat(/** @type {string} */ (restaurant.lng));

  if (!isFinite(lat) || !isFinite(lng)) return false;
  if (lat === 0 || lng === 0) return false;
  if (lat < 22.11 || lat > 22.57 || lng < 113.83 || lng > 114.43) return false;

  // Validate rating: must be 0-5 or undefined/null
  if (restaurant.rating !== undefined && restaurant.rating !== null) {
    const rating = typeof restaurant.rating === 'number' ? restaurant.rating : parseFloat(String(restaurant.rating));
    if (!isNaN(rating) && (rating < 0 || rating > 5)) return false;
  }

  if (restaurant.source === 'fehd') return false;

  return true;
}
