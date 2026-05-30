/**
 * State management module for LunchGo.
 *
 * Provides a reactive state object with change notifications via
 * subscribe/unsubscribe pattern. All state mutations trigger events
 * that subscribers can listen to.
 *
 * @module state
 */

/**
 * @typedef {Object} LunchGoState
 * @property {import('./types.js').Restaurant[]} placesData - Array of restaurant place objects
 * @property {import('./types.js').Restaurant[]} filtered - Filtered subset after search/cuisine/sort
 * @property {import('./types.js').Location|null} currentLocation - Selected location
 * @property {string} currentLocationLabel - Human-readable label for current location
 * @property {'distance'|'rating'} currentSort - Active sort key
 * @property {string} searchQuery - Current text search input
 * @property {'list'|'map'} currentView - Active view: 'list' | 'map'
 * @property {string} activeCuisine - Selected cuisine filter ID, 'all' for none
 * @property {string} activePrice - Selected price filter ID, 'all' means no filter
 * @property {'walkable'|'keyword'|'favorites'} randomPickMode - Random picker mode
 * @property {string} randomPickQuery - Random picker keyword query
 * @property {'walkable'|'all'} randomPickScope - Candidate scope for random picker
 * @property {object|null} map - Google Maps instance
 * @property {object[]} markers - Array of Google Maps Marker instances
 * @property {object|null} placesService - Google Maps PlacesService instance
 * @property {boolean} placesLoaded - Whether Places data has been fetched
 * @property {object|null} geocoder - Google Maps Geocoder instance
 * @property {object|null} autocomplete - Google Maps Autocomplete instance
 * @property {import('./types.js').Restaurant|null} randomPickResult - Result of random picker
 * @property {boolean} discoveryVisible - Whether discovery section is visible
 * @property {number} loadMoreIndex - Pagination: index of next batch to render
 * @property {number} loadMoreStep - Pagination: batch size (default 50)
 * @property {string[]} loadingErrors - Array of error messages from data loading
 */

/** @type {LunchGoState} */
const _state = {
  placesData: [],
  filtered: [],
  currentLocation: null,
  currentLocationLabel: '',
  currentSort: 'distance',
  searchQuery: '',
  currentView: 'list',
  activeCuisine: 'all',
  activePrice: 'all',
  randomPickMode: 'walkable',
  randomPickQuery: '',
  randomPickScope: 'walkable',
  map: null,
  markers: [],
  placesService: null,
  placesLoaded: false,
  geocoder: null,
  autocomplete: null,
  randomPickResult: null,
  discoveryVisible: false,
  loadMoreIndex: 0,
  loadMoreStep: 50,
  loadingErrors: [],
};

/** @type {Set<function(string, *, *): void>} */
const _listeners = new Set();

/**
 * Notify all subscribers of a state change.
 *
 * @param {string} key - The state property that changed
 * @param {*} newValue - The new value
 * @param {*} oldValue - The previous value
 */
function _notify(key, newValue, oldValue) {
  for (const fn of _listeners) {
    try {
      fn(key, newValue, oldValue);
    } catch {
      // Subscriber errors should not break the app
    }
  }
}

/**
 * Reactive proxy that fires notifications on state mutations.
 *
 * Handles both direct property assignment (state.foo = bar) and
 * array mutations via set traps. Note: array methods like push/pop
 * mutate in-place and trigger a notification for the array property.
 */
const state = new Proxy(_state, {
  set(target, key, value) {
    if (typeof key !== 'string') return true;
    const oldValue = /** @type {any} */ (target)[key];
    const changed = oldValue !== value;
    /** @type {any} */ (target)[key] = value;
    if (changed) {
      _notify(key, value, oldValue);
    }
    return true;
  },
});

/**
 * Subscribe to state changes.
 *
 * The listener receives (key, newValue, oldValue) for every
 * state property mutation.
 *
 * @param {function(string, *, *): void} listener - Callback invoked on each change
 * @returns {function(): void} Unsubscribe function
 *
 * @example
 * import { state, subscribe } from './src/state.js';
 *
 * const unsub = subscribe((key, newVal, oldVal) => {
 *   console.log(`${key} changed from`, oldVal, 'to', newVal);
 * });
 *
 * state.searchQuery = 'pizza'; // triggers listener
 * unsub(); // stop listening
 */
function subscribe(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('subscribe expects a function');
  }
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/**
 * Unsubscribe a specific listener.
 *
 * Prefer using the unsubscribe function returned by subscribe().
 * This is provided for cases where you only have the listener reference.
 *
 * @param {function(string, *, *): void} listener - The callback to remove
 */
function unsubscribe(listener) {
  _listeners.delete(listener);
}

/**
 * Get a snapshot of all state keys (useful for debugging).
 *
 * @returns {string[]} Array of state property names
 */
function keys() {
  return Object.keys(_state);
}

/**
 * Reset state to initial values (useful for testing).
 *
 * @param {Partial<LunchGoState>} overrides - Properties to set after reset
 */
function reset(overrides = {}) {
  /** @type {LunchGoState} */
  const initial = {
    placesData: [],
    filtered: [],
    currentLocation: null,
    currentLocationLabel: '',
    currentSort: 'distance',
    searchQuery: '',
    currentView: 'list',
    activeCuisine: 'all',
    activePrice: 'all',
    randomPickMode: 'walkable',
    randomPickQuery: '',
    randomPickScope: 'walkable',
    map: null,
    markers: [],
    placesService: null,
    placesLoaded: false,
    geocoder: null,
    autocomplete: null,
    randomPickResult: null,
    discoveryVisible: false,
    loadMoreIndex: 0,
    loadMoreStep: 50,
    loadingErrors: [],
  };
  const stateKeys = /** @type {(keyof LunchGoState)[]} */ (keys());
  for (const key of stateKeys) {
    /** @type {any} */ (_state)[key] = /** @type {any} */ (initial)[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    /** @type {any} */ (_state)[key] = value;
  }
}

export { state, subscribe, unsubscribe, keys, reset };
