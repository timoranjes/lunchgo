/**
 * Store - localStorage wrapper for LunchGo
 *
 * All keys are prefixed with 'lg_' to avoid collisions.
 * Gracefully degrades when localStorage is unavailable or quota exceeded.
 *
 * @module store
 */

const PREFIX = 'lg_';

/**
 * Log localStorage errors without breaking the app.
 * @param {string} operation - The operation that failed (e.g., 'get', 'set')
 * @param {Error} error - The caught error
 */
function logStoreError(operation, error) {
  const err = /** @type {Error} */ (error);
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    console.warn(`[Store] ${operation}: localStorage quota exceeded`);
  } else if (error instanceof DOMException && error.name === 'SecurityError') {
    console.warn(`[Store] ${operation}: localStorage access denied (private browsing?)`);
  } else {
    console.warn(`[Store] ${operation}:`, err.message);
  }
}

/**
 * Deep clone a value to prevent external mutation of stored data.
 * @param {*} value - Value to clone
 * @returns {*} Cloned value
 */
function deepClone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

/**
 * @typedef {Object} Location
 * @property {number} lat - Latitude
 * @property {number} lng - Longitude
 * @property {string} label - Display label
 */

/**
 * @typedef {Object} CustomLocation
 * @property {string} id - Unique identifier
 * @property {number} lat - Latitude
 * @property {number} lng - Longitude
 * @property {string} label - Display label
 * @property {string} [address] - Resolved address or place description
 * @property {string} [place_id] - Google Places place_id if available
 * @property {string} [source] - How the location was created
 */

const Store = {
  /**
   * Get a value from localStorage by key.
   * @param {string} key - Storage key (without prefix)
   * @param {*} [def] - Default value if key doesn't exist
   * @returns {*} Parsed value or default
   */
  get(key, def) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw !== null ? JSON.parse(raw) : def;
    } catch (error) {
      logStoreError('get', /** @type {Error} */ (error));
      return def;
    }
  },

  /**
   * Set a value in localStorage by key.
   * @param {string} key - Storage key (without prefix)
   * @param {*} val - Value to store (must be JSON-serializable)
   */
  set(key, val) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(val));
    } catch (error) {
      logStoreError('set', /** @type {Error} */ (error));
    }
  },

  /**
   * Get the current selected location.
   * @returns {Location|null} Current location or null
   */
  getLocation() {
    return Store.get('loc', null);
  },

  /**
   * Set the current selected location.
   * @param {Location|null} loc - Location object or null to clear
   */
  setLocation(loc) {
    Store.set('loc', loc);
  },

  /**
   * Get the list of favorite restaurant IDs.
   * @returns {string[]} Array of favorite IDs
   */
  getFavorites() {
    return Store.get('favs', []);
  },

  /**
   * Toggle a restaurant ID in favorites.
   * @param {string} id - Restaurant ID to toggle
   * @returns {boolean} true if added, false if removed
   */
  toggleFav(id) {
    const favs = Store.getFavorites();
    const idx = favs.indexOf(id);
    if (idx >= 0) {
      favs.splice(idx, 1);
    } else {
      favs.push(id);
    }
    Store.set('favs', favs);
    return idx < 0;
  },

  /**
   * Check if a restaurant ID is in favorites.
   * @param {string} id - Restaurant ID to check
   * @returns {boolean} true if favorited
   */
  isFav(id) {
    return Store.getFavorites().includes(id);
  },

  /**
   * Get the list of custom user-defined locations.
   * @returns {CustomLocation[]} Array of custom locations
   */
  getCustomLocations() {
    const locs = Store.get('custom_locs', []);
    return Array.isArray(locs)
      ? locs.map((loc) => ({
          ...loc,
          address: loc?.address || '',
          place_id: loc?.place_id || '',
          source: loc?.source || '',
        }))
      : [];
  },

  /**
   * Add a custom location.
   * @param {CustomLocation} loc - Location to add
   * @returns {CustomLocation[]} Updated list of custom locations
   */
  addCustomLocation(loc) {
    const locs = Store.getCustomLocations();
    const normalized = {
      id: loc.id || 'custom_' + Date.now(),
      lat: Number(loc.lat),
      lng: Number(loc.lng),
      label: String(loc.label || '').trim(),
      address: String(loc.address || '').trim(),
      place_id: String(loc.place_id || '').trim(),
      source: String(loc.source || 'manual').trim() || 'manual',
      isCustom: true,
    };
    const idx = locs.findIndex((item) => item.id === normalized.id);
    if (idx >= 0) {
      locs[idx] = { ...locs[idx], ...normalized };
    } else {
      locs.push(normalized);
    }
    Store.set('custom_locs', locs);
    return locs;
  },

  /**
   * Remove a custom location by ID.
   * @param {string} id - Location ID to remove
   * @returns {CustomLocation[]} Updated list of custom locations
   */
  removeCustomLocation(id) {
    const locs = Store.getCustomLocations().filter(l => l.id !== id);
    Store.set('custom_locs', locs);
    return locs;
  },
};

export default Store;
