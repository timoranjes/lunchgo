/**
 * LunchGo Rendering Engine
 *
 * Extracted rendering functions from index.html. Handles all DOM
 * manipulation for restaurant lists, discovery cards, detail views,
 * map markers, random picker, and favorites.
 *
 * Uses a callback registry pattern for interactivity (card clicks,
 * toasts, etc.) so the module remains decoupled from index.html.
 *
 * Lazy loading: Uses IntersectionObserver for infinite scroll on
 * result sets > 50 restaurants. Falls back to "Load More" button
 * when IntersectionObserver is unavailable.
 *
 * Performance: All list rendering uses DocumentFragment for batched
 * DOM updates. Skeleton screens shown during initial load.
 *
 * @module render
 */

import { state } from './state.js';
import Store from './store.js';
import {
  haversine,
  formatDist,
  isValidRestaurant,
  hasValidCoordinates,
  renderStars,
  priceLevel,
  escHtml,
  escAttr,
  matchCuisine,
} from './utils.js';

// ---------------------------------------------------------------------------
// Callback Registry
// ---------------------------------------------------------------------------

/**
 * Callback registry for interactivity.
 * Set via setRenderCallbacks() from index.html.
 */
const _callbacks = {
  /** @type {function(string): void|null} */
  onCardClick: null,
  /** @type {function(string): void|null} */
  onShowToast: null,
  /** @type {function(string, function): void|null} */
  onFetchPlaceDetails: null,
  /** @type {function(import('./types.js').Restaurant, function): void|null} */
  onFetchRestaurantEnrichment: null,
  /** @type {function(import('./types.js').Restaurant[]): void|null} */
  onVisibleRestaurantsRendered: null,
  /** @type {function(): void|null} */
  onHideFavoritesPage: null,
};

const WALKABLE_DISTANCE_M = 2500;
const RANDOM_PICK_ROLL_INTERVAL_MS = 70;
const RANDOM_PICK_ROLL_COUNT = 18;

/**
 * Register callbacks for interactivity.
 *
 * @param {Object} cb - Callback map
 * @param {function(string): void} [cb.onCardClick] - Called when a restaurant card is clicked
 * @param {function(string): void} [cb.onShowToast] - Called to show a toast message
 * @param {function(string, function): void} [cb.onFetchPlaceDetails] - Called to fetch place details
 * @param {function(import('./types.js').Restaurant, function): void} [cb.onFetchRestaurantEnrichment] - Called to enrich a restaurant on demand
 * @param {function(import('./types.js').Restaurant[]): void} [cb.onVisibleRestaurantsRendered] - Called after the list view is rendered
 * @param {function(): void} [cb.onHideFavoritesPage] - Called to hide favorites page
 */
export function setRenderCallbacks(cb) {
  if (cb.onCardClick) _callbacks.onCardClick = cb.onCardClick;
  if (cb.onShowToast) _callbacks.onShowToast = cb.onShowToast;
  if (cb.onFetchPlaceDetails) _callbacks.onFetchPlaceDetails = cb.onFetchPlaceDetails;
  if (cb.onFetchRestaurantEnrichment) _callbacks.onFetchRestaurantEnrichment = cb.onFetchRestaurantEnrichment;
  if (cb.onVisibleRestaurantsRendered) _callbacks.onVisibleRestaurantsRendered = cb.onVisibleRestaurantsRendered;
  if (cb.onHideFavoritesPage) _callbacks.onHideFavoritesPage = cb.onHideFavoritesPage;
}

// ---------------------------------------------------------------------------
// Cuisine Config (mirrors index.html CUISINES array)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CuisineOption
 * @property {string} id - Cuisine identifier
 * @property {string} label - Display label in Traditional Chinese
 */

/** @type {CuisineOption[]} */
export const CUISINES = [
  { id: 'all', label: '全部' },
  { id: 'chinese', label: '中式' },
  { id: 'noodle', label: '粉麵' },
  { id: 'mixian', label: '米線' },
  { id: 'japanese', label: '日式' },
  { id: 'western', label: '西式' },
  { id: 'fast_food', label: '快餐' },
  { id: 'cafe', label: '咖啡' },
  { id: 'seafood', label: '海鮮' },
  { id: 'korean', label: '韓式' },
  { id: 'thai', label: '泰式' },
  { id: 'italian', label: '意式' },
  { id: 'bbq', label: '燒烤' },
  { id: 'hotpot', label: '火鍋' },
  { id: 'dessert', label: '甜品' },
];

function getRestaurantDistance(restaurant, location) {
  if (!location || !hasValidCoordinates(restaurant)) return undefined;
  const lat = parseFloat(/** @type {string} */ (restaurant.lat));
  const lng = parseFloat(/** @type {string} */ (restaurant.lng));
  if (!isFinite(lat) || !isFinite(lng)) return undefined;
  return haversine(location.lat, location.lng, lat, lng);
}

function getDistanceSortValue(distance) {
  return Number.isFinite(distance) ? distance : Infinity;
}

function getRestaurantSortDistance(restaurant, location) {
  if (!location || !hasValidCoordinates(restaurant)) return undefined;
  const lat = parseFloat(/** @type {string} */ (restaurant.lat));
  const lng = parseFloat(/** @type {string} */ (restaurant.lng));
  if (!isFinite(lat) || !isFinite(lng)) return undefined;
  return haversine(location.lat, location.lng, lat, lng);
}

function isWalkableRestaurant(restaurant) {
  return Number.isFinite(restaurant.distance) && restaurant.distance <= WALKABLE_DISTANCE_M;
}

function decorateCandidatesWithDistance(restaurants) {
  const loc = state.currentLocation;
  return restaurants.map((restaurant) => ({
    ...restaurant,
    distance: loc && hasValidCoordinates(restaurant)
      ? getRestaurantSortDistance(restaurant, loc)
      : restaurant.distance,
  }));
}

function uniqueCandidates(restaurants) {
  const seen = new Set();
  const result = [];
  for (const restaurant of restaurants || []) {
    if (!restaurant || !restaurant.id || seen.has(restaurant.id)) continue;
    seen.add(restaurant.id);
    result.push(restaurant);
  }
  return result;
}

function normalizeQueryText(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
}

function matchRandomQuery(restaurant, query) {
  const q = normalizeQueryText(query);
  if (!q) return true;
  const haystacks = [
    restaurant.name,
    restaurant.name_en,
    restaurant.address,
    restaurant.cuisine,
    restaurant.types?.join(' '),
  ].map(normalizeQueryText);
  return haystacks.some((haystack) => haystack.includes(q));
}

function getRandomPickBasePools() {
  const primarySource = state.filtered.length > 0 ? state.filtered : state.placesData;
  const primary = decorateCandidatesWithDistance(primarySource.filter(isValidRestaurant));
  const fallback = decorateCandidatesWithDistance(state.placesData.filter(isValidRestaurant));
  return { primary, fallback };
}

function applyRandomPickMode(list, mode, query) {
  let candidates = list;

  switch (mode) {
    case 'keyword':
      candidates = candidates.filter((restaurant) => matchRandomQuery(restaurant, query));
      break;
    case 'favorites':
      candidates = candidates.filter((restaurant) => Store.isFav(restaurant.id));
      break;
    case 'walkable':
    default:
      break;
  }

  return uniqueCandidates(candidates);
}

function buildRandomPickPools(mode, query, scope) {
  const { primary, fallback } = getRandomPickBasePools();
  const pools = [];

  const primaryWalkable = primary.filter((restaurant) => isWalkableRestaurant(restaurant));
  const fallbackWalkable = fallback.filter((restaurant) => isWalkableRestaurant(restaurant));
  const primaryNearby = primary.filter((restaurant) => Number.isFinite(restaurant.distance) && restaurant.distance <= WALKABLE_DISTANCE_M * 2);
  const fallbackNearby = fallback.filter((restaurant) => Number.isFinite(restaurant.distance) && restaurant.distance <= WALKABLE_DISTANCE_M * 2);
  const primaryCoords = primary.filter((restaurant) => Number.isFinite(restaurant.distance));
  const fallbackCoords = fallback.filter((restaurant) => Number.isFinite(restaurant.distance));

  pools.push(
    applyRandomPickMode(primaryWalkable, mode, query),
    applyRandomPickMode(fallbackWalkable, mode, query),
    applyRandomPickMode(primaryNearby, mode, query),
    applyRandomPickMode(fallbackNearby, mode, query),
    applyRandomPickMode(primaryCoords, mode, query),
    applyRandomPickMode(fallbackCoords, mode, query),
    applyRandomPickMode(primary, mode, query),
    applyRandomPickMode(fallback, mode, query),
  );

  if (scope === 'all') {
    pools.push(
      applyRandomPickMode(primaryCoords, 'walkable', ''),
      applyRandomPickMode(fallbackCoords, 'walkable', ''),
      applyRandomPickMode(primary, 'walkable', ''),
      applyRandomPickMode(fallback, 'walkable', ''),
    );
  }

  return pools.filter((pool) => Array.isArray(pool) && pool.length > 0);
}

function getRandomPickCandidates(mode, query, scope) {
  const pools = buildRandomPickPools(mode, query, scope);
  if (pools.length > 0) {
    return pools[0];
  }

  const { primary, fallback } = getRandomPickBasePools();
  return uniqueCandidates(primary.length > 0 ? primary : fallback);
}

function getRandomPickSettings() {
  const overlay = document.getElementById('random-overlay');
  const queryInput = document.getElementById('random-query-input');
  const modeButton = document.querySelector('#random-mode-bar .random-mode-btn.active');
  const scopeButton = document.querySelector('#random-scope-bar .random-scope-btn.active');
  return {
    mode: modeButton?.dataset.randomMode || overlay?.dataset.randomMode || state.randomPickMode || 'walkable',
    query: queryInput?.value || overlay?.dataset.randomQuery || state.randomPickQuery || '',
    scope: scopeButton?.dataset.randomScope || overlay?.dataset.randomScope || state.randomPickScope || 'walkable',
  };
}

function updateFavoriteButtonState(button, restaurantId) {
  const isFav = Store.isFav(restaurantId);
  button.textContent = isFav ? '♥' : '♡';
  button.classList.toggle('is-fav', isFav);
}

function bindFavoriteButton(button, restaurantId) {
  updateFavoriteButtonState(button, restaurantId);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const added = Store.toggleFav(restaurantId);
    updateFavoriteButtonState(button, restaurantId);
    if (document.getElementById('fav-page')?.classList.contains('active')) {
      renderFavorites();
    }
    if (_callbacks.onShowToast) {
      _callbacks.onShowToast(added ? '已收藏' : '已取消收藏');
    }
  });
}

function bindRestaurantCardInteractions(card, restaurant) {
  card.addEventListener('click', () => {
    if (_callbacks.onCardClick) {
      _callbacks.onCardClick(card.dataset.id);
    }
  });

  const favButton = card.querySelector('.rest-fav');
  if (favButton) {
    bindFavoriteButton(/** @type {HTMLButtonElement} */ (favButton), restaurant.id);
  }
}

/**
 * Replace an existing list card in place after data changes.
 *
 * @param {import('./types.js').Restaurant} restaurant
 */
export function patchRestaurantCard(restaurant) {
  const container = document.getElementById('rest-list');
  if (!container || !restaurant || !restaurant.id) return;

  const existing = container.querySelector('.rest-card[data-id="' + restaurant.id + '"]');
  if (!existing) return;

  const temp = document.createElement('div');
  temp.innerHTML = renderCardTemplate(restaurant);
  const replacement = temp.firstElementChild;
  if (!replacement) return;

  bindRestaurantCardInteractions(/** @type {HTMLElement} */ (replacement), restaurant);
  existing.replaceWith(replacement);
}

/**
 * Render a compact loading placeholder for an unenriched card.
 *
 * @param {import('./types.js').Restaurant} restaurant
 * @returns {string}
 */
function renderCardLoadingMeta(restaurant) {
  if (restaurant.enrichment_status === 'loading') {
    return '<span class="rest-loading-badge">補充資料中</span>';
  }
  if (restaurant.enrichment_status === 'failed') {
    return '<span class="rest-loading-badge rest-loading-badge-error">資料暫缺</span>';
  }
  if (!restaurant.enrichment_status || restaurant.enrichment_status === 'pending') {
    return '<span class="rest-loading-badge">等待補充</span>';
  }
  return '';
}

/**
 * Render a trust label for restaurant location quality.
 *
 * @param {import('./types.js').Restaurant} restaurant
 * @returns {string}
 */
function renderLocationTrustLabel(restaurant) {
  if (restaurant.location_status === 'approximate') {
    return '<span class="detail-location-trust detail-location-trust-approx">座標約略</span>';
  }
  if (restaurant.location_status === 'missing') {
    return '<span class="detail-location-trust detail-location-trust-missing">未標示位置</span>';
  }
  return '';
}

// ---------------------------------------------------------------------------
// Template Functions
// ---------------------------------------------------------------------------

/**
 * Generate skeleton card HTML for loading state.
 *
 * @param {number} count - Number of skeleton cards to generate
 * @returns {string} HTML string
 */
export function renderSkeletonCards(count) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html +=
      '<div class="skeleton-card">' +
      '<div class="skeleton-thumb"></div>' +
      '<div class="skeleton-body">' +
      '<div class="skeleton-line skeleton-line-medium"></div>' +
      '<div class="skeleton-line skeleton-line-short"></div>' +
      '<div class="skeleton-line"></div>' +
      '</div>' +
      '</div>';
  }
  return html;
}

/**
 * Generate HTML for a single restaurant card (list view).
 *
 * @param {import('./types.js').Restaurant} r - Restaurant object
 * @returns {string} HTML string
 */
export function renderCardTemplate(r) {
  const dist = Number.isFinite(r.distance) ? formatDist(r.distance) : '';
  const district = r.district_tc || r.district || '';
  const stars = r.rating ? renderStars(r.rating) : '';
  const price = r.price_level ? priceLevel(r.price_level) : '';
  const locationStatus =
    r.location_status === 'approximate' ? '座標約略' :
    r.location_status === 'missing' ? '未標示位置' : '';
  const favText = Store.isFav(r.id) ? '♥' : '♡';

  let thumbHtml = '<div class="rest-card-thumb">';
  if (r.photos && r.photos.length > 0) {
    thumbHtml +=
      '<img src="' +
      escAttr(r.photos[0]) +
      '" alt="" loading="lazy" onerror="this.classList.add(\'img-error\')" />';
  }
  thumbHtml += '</div>';

  let tags = '';
  if (district) tags += '<span class="tag tag-district">' + escHtml(district) + '</span>';
  if (locationStatus) tags += '<span class="tag tag-status">' + escHtml(locationStatus) + '</span>';
  if (dist) tags += '<span class="tag tag-distance">' + escHtml(dist) + '</span>';
  if (r.cuisine)
    tags += '<span class="tag tag-cuisine">' + escHtml(r.cuisine.split(',')[0]) + '</span>';
  if (price) tags += '<span class="tag tag-price">' + escHtml(price.trim()) + '</span>';
  if (!r.photos || r.photos.length === 0) {
    tags += renderCardLoadingMeta(r);
  }

  return (
    '<div class="rest-card" data-id="' +
    escAttr(r.id) +
    '">' +
    '<button class="rest-fav" type="button" aria-label="' +
    escAttr(Store.isFav(r.id) ? '取消收藏' : '收藏') +
    '">' +
    favText +
    '</button>' +
    '<div class="rest-card-top">' +
    thumbHtml +
    '<div class="rest-card-body">' +
    '<div class="rest-name">' +
    escHtml(r.name || '') +
    '</div>' +
    (r.name_en && r.name_en !== r.name
      ? '<div class="rest-name-en">' + escHtml(r.name_en) + '</div>'
      : '') +
    (stars
      ? '<div class="rest-rating">' +
        '<span class="stars">' +
        stars +
        '</span>' +
        '<span class="rating-num">' +
        r.rating +
        '</span>' +
        (r.user_ratings_total
          ? '<span class="rating-count">(' + r.user_ratings_total + ')</span>'
          : '') +
        '</div>'
      : '') +
    '<div class="rest-info">' +
    (dist ? '<span class="rest-info-item">' + escHtml(dist) + '</span>' : '') +
    (price ? '<span class="rest-info-item">' + escHtml(price) + '</span>' : '') +
    '</div>' +
    '<div class="rest-tags">' +
    tags +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

/**
 * Generate HTML for a single discovery card.
 *
 * @param {import('./types.js').Restaurant} r - Restaurant object
 * @returns {string} HTML string
 */
export function renderDiscoveryCardTemplate(r) {
  const dist = Number.isFinite(r.distance) ? formatDist(r.distance) : '';
  let imgHtml = '';
  if (r.photos && r.photos.length > 0) {
    imgHtml =
      '<img src="' + escAttr(r.photos[0]) + '" alt="" loading="lazy" onerror="this.classList.add(\'img-error\')" />';
  }

  return (
    '<div class="discovery-card" data-id="' +
    escAttr(r.id) +
    '">' +
    '<div class="discovery-card-img">' +
    imgHtml +
    '</div>' +
    '<div class="discovery-card-body">' +
    '<div class="discovery-card-name">' +
    escHtml(r.name || '') +
    '</div>' +
    '<div class="discovery-card-meta">' +
    (dist ? dist + ' · ' : '') +
    (r.price_level ? priceLevel(r.price_level) : '') +
    '</div>' +
    (!r.rating ? '<div class="discovery-card-placeholder">補充中</div>' : '') +
    '<div class="discovery-card-rating">' +
    '<span class="stars">' +
    renderStars(r.rating) +
    '</span>' +
    '<span class="rating-num">' +
    r.rating +
    '</span>' +
    (r.user_ratings_total
      ? '<span class="rating-count">(' + r.user_ratings_total + ')</span>'
      : '') +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

/**
 * Generate HTML for a restaurant card in the favorites view.
 *
 * @param {import('./types.js').Restaurant} r - Restaurant object
 * @param {string} [dist] - Pre-computed distance string
 * @returns {string} HTML string
 */
export function renderFavCardTemplate(r, dist) {
  const district = r.district_tc || r.district || '';
  const stars = r.rating ? renderStars(r.rating) : '';
  const price = r.price_level ? priceLevel(r.price_level) : '';
  const locationStatus =
    r.location_status === 'approximate' ? '座標約略' :
    r.location_status === 'missing' ? '未標示位置' : '';
  const favText = Store.isFav(r.id) ? '♥' : '♡';

  let thumbHtml = '<div class="rest-card-thumb">';
  if (r.photos && r.photos.length > 0) {
    thumbHtml +=
      '<img src="' +
      escAttr(r.photos[0]) +
      '" alt="" loading="lazy" onerror="this.classList.add(\'img-error\')" />';
  }
  thumbHtml += '</div>';

  let tags = '';
  if (district) tags += '<span class="tag tag-district">' + escHtml(district) + '</span>';
  if (locationStatus) tags += '<span class="tag tag-status">' + escHtml(locationStatus) + '</span>';
  if (dist) tags += '<span class="tag tag-distance">' + escHtml(dist) + '</span>';
  if (r.cuisine)
    tags += '<span class="tag tag-cuisine">' + escHtml(r.cuisine.split(',')[0]) + '</span>';

  return (
    '<div class="rest-card" data-id="' +
    escAttr(r.id) +
    '">' +
    '<button class="rest-fav" type="button" aria-label="' +
    escAttr(Store.isFav(r.id) ? '取消收藏' : '收藏') +
    '">' +
    favText +
    '</button>' +
    '<div class="rest-card-top">' +
    thumbHtml +
    '<div class="rest-card-body">' +
    '<div class="rest-name">' +
    escHtml(r.name || '') +
    '</div>' +
    (r.name_en && r.name_en !== r.name
      ? '<div class="rest-name-en">' + escHtml(r.name_en) + '</div>'
      : '') +
    (stars
      ? '<div class="rest-rating">' +
        '<span class="stars">' +
        stars +
        '</span>' +
        '<span class="rating-num">' +
        r.rating +
        '</span>' +
        (r.user_ratings_total
          ? '<span class="rating-count">(' + r.user_ratings_total + ')</span>'
          : '') +
        '</div>'
      : '') +
    '<div class="rest-info">' +
    (dist ? '<span class="rest-info-item">' + escHtml(dist) + '</span>' : '') +
    (price ? '<span class="rest-info-item">' + escHtml(price) + '</span>' : '') +
    '</div>' +
    '<div class="rest-tags">' +
    tags +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

// ---------------------------------------------------------------------------
// Lazy Loading / Infinite Scroll
// ---------------------------------------------------------------------------

/** @type {IntersectionObserver|null} */
let _loadMoreObserver = null;
let _renderVersion = 0;

/**
 * Set up IntersectionObserver for infinite scroll lazy loading.
 * Observes a sentinel element at the bottom of the list.
 * When visible, loads the next batch.
 *
 * @param {function(): void} onLoadMore - Callback to load next batch
 */
export function setupLazyLoading(onLoadMore) {
  if (_loadMoreObserver) {
    _loadMoreObserver.disconnect();
    _loadMoreObserver = null;
  }

  if (!('IntersectionObserver' in window)) {
    return;
  }

  const sentinel = document.getElementById('load-more-sentinel');
  if (!sentinel) return;

  _loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        onLoadMore();
      }
    },
    { rootMargin: '200px' }
  );

  _loadMoreObserver.observe(sentinel);
}

/**
 * Tear down the lazy loading observer.
 */
export function teardownLazyLoading() {
  if (_loadMoreObserver) {
    _loadMoreObserver.disconnect();
    _loadMoreObserver = null;
  }
}

// ---------------------------------------------------------------------------
// Main Render Functions
// ---------------------------------------------------------------------------

/**
 * Main render orchestrator.
 *
 * Filters, sorts, and renders the restaurant list.
 * Updates discovery section, list view, and map markers.
 *
 * @param {boolean} [reset=true] - Whether to reset pagination
 */
export function updateDisplay(reset) {
  if (reset === undefined) reset = true;
  const renderVersion = ++_renderVersion;

  let list = state.placesData;

  // VALIDATION: Filter out invalid entries first
  const preValidationCount = list.length;
  list = list.filter(isValidRestaurant);
  const filteredCount = preValidationCount - list.length;

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(
      (r) =>
        (r.name && r.name.toLowerCase().includes(q)) ||
        (r.name_en && r.name_en.toLowerCase().includes(q)) ||
        (r.address && r.address.toLowerCase().includes(q)) ||
        (r.cuisine && r.cuisine.toLowerCase().includes(q))
    );
  }

  if (state.activeCuisine !== 'all') {
    list = list.filter((r) => matchCuisine(r, state.activeCuisine));
  }

  if (state.activePrice !== 'all') {
    const targetPrice = parseInt(state.activePrice, 10);
    list = list.filter((r) => r.price_level === targetPrice);
  }

  const loc = state.currentLocation;
  if (loc) {
    list = list.map((r) => ({
      ...r,
      distance: getRestaurantDistance(r, loc),
    }));
  }

  if (state.currentSort === 'rating') {
    list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  } else {
    state.currentSort = 'distance';
    list.sort((a, b) => getDistanceSortValue(a.distance) - getDistanceSortValue(b.distance));
  }

  state.filtered = list;

  const total = list.length;
  const resultCountEl = document.getElementById('result-count');
  if (resultCountEl) {
    resultCountEl.textContent = total + ' 間餐廳';
  }

  if (reset) {
    state.loadMoreIndex = 0;
  }

  const scheduleRender = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb) => setTimeout(cb, 16);

  scheduleRender(() => {
    if (renderVersion !== _renderVersion) return;
    renderDiscovery(list);
    renderList(list);
    if (state.map) renderMapMarkers(list);
  });

  const emptyEl = document.getElementById('empty-state');
  if (emptyEl) {
    const hasResults = preValidationCount > 0;
    if (list.length === 0 && hasResults) {
      emptyEl.innerHTML = '找不到餐廳（已過濾 ' + filteredCount + ' 筆無效資料）';
      emptyEl.style.display = 'block';
    } else if (list.length === 0) {
      emptyEl.textContent = '找不到餐廳';
      emptyEl.style.display = 'block';
    } else {
      emptyEl.style.display = 'none';
    }
  }
}

/**
 * Render the discovery / recommendations section.
 *
 * Shows top-rated restaurants in a horizontal scroll carousel.
 * Only visible when there are rated restaurants.
 *
 * @param {import('./types.js').Restaurant[]} list - Filtered restaurant list
 */
export function renderDiscovery(list) {
  const section = document.getElementById('discovery-section');
  const scroll = document.getElementById('discovery-scroll');
  const subtitle = document.getElementById('discovery-subtitle');

  if (!section || !scroll || !subtitle) return;

  const rated = list.filter((r) => Number.isFinite(r.rating) && Number(r.rating) >= 4.7);

  if (rated.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';

  const sorted = [...rated].sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    return (b.user_ratings_total || 0) - (a.user_ratings_total || 0);
  });

  const top = sorted.slice(0, 20);

  if (state.activeCuisine !== 'all') {
    const cuisineLabel = CUISINES.find((c) => c.id === state.activeCuisine);
    subtitle.textContent = (cuisineLabel ? cuisineLabel.label : '') + ' 4.7+ 高分餐廳';
  } else {
    subtitle.textContent = '評分 4.7+';
  }

  scroll.innerHTML = top.map(renderDiscoveryCardTemplate).join('');

  scroll.querySelectorAll('.discovery-card').forEach((card) => {
    card.addEventListener('click', () => {
      if (_callbacks.onCardClick) {
        _callbacks.onCardClick(/** @type {HTMLElement} */ (card).dataset.id);
      }
    });
  });
}

/**
 * Render the restaurant list with lazy loading / pagination.
 *
 * For result sets > 50, uses IntersectionObserver for infinite scroll
 * with a "Load More" button fallback. Renders in batches of
 * state.loadMoreStep (default 50) using DocumentFragment for
 * batched DOM updates.
 *
 * @param {import('./types.js').Restaurant[]} list - Filtered restaurant list
 */
export function renderList(list) {
  const container = document.getElementById('rest-list');
  const loadMoreEl = document.getElementById('load-more');
  const loadMoreBtn = document.getElementById('load-more-btn');

  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = '';
    if (loadMoreEl) loadMoreEl.style.display = 'none';
    return;
  }

  const end = Math.min(state.loadMoreIndex + state.loadMoreStep, list.length);
  const display = list.slice(0, end);
  state.loadMoreIndex = end;

  const fragment = document.createDocumentFragment();
  const temp = document.createElement('div');
  display.forEach((r) => {
    temp.innerHTML = renderCardTemplate(r);
    const card = temp.firstElementChild;
    if (card) {
      bindRestaurantCardInteractions(/** @type {HTMLElement} */ (card), r);
      fragment.appendChild(card);
    }
  });

  container.innerHTML = '';
  container.appendChild(fragment);

  if (_callbacks.onVisibleRestaurantsRendered) {
    const visibleRestaurants = display.map((r) => {
      const current = state.placesData.find((x) => x.id === r.id);
      return current || r;
    });
    _callbacks.onVisibleRestaurantsRendered(visibleRestaurants);
  }

  if (loadMoreEl && loadMoreBtn) {
    if (end < list.length) {
      loadMoreBtn.textContent = '載入更多 (' + (list.length - end) + ' 家)';
      loadMoreEl.style.display = 'block';
    } else {
      loadMoreEl.style.display = 'none';
    }
  }
}

/**
 * Load the next batch of restaurants (for lazy loading).
 *
 * @param {import('./types.js').Restaurant[]} list - Full filtered list
 */
export function loadMoreRestaurants(list) {
  const container = document.getElementById('rest-list');
  const loadMoreEl = document.getElementById('load-more');
  const loadMoreBtn = document.getElementById('load-more-btn');

  if (!container) return;

  const end = Math.min(state.loadMoreIndex + state.loadMoreStep, list.length);
  const nextBatch = list.slice(state.loadMoreIndex, end);
  state.loadMoreIndex = end;

  const fragment = document.createDocumentFragment();
  const temp = document.createElement('div');
  nextBatch.forEach((r) => {
    temp.innerHTML = renderCardTemplate(r);
    const card = temp.firstElementChild;
    if (card) {
      bindRestaurantCardInteractions(/** @type {HTMLElement} */ (card), r);
      fragment.appendChild(card);
    }
  });
  container.appendChild(fragment);

  if (_callbacks.onVisibleRestaurantsRendered) {
    const visibleCards = Array.from(container.querySelectorAll('.rest-card'))
      .map((card) => state.placesData.find((r) => r.id === card.dataset.id))
      .filter(Boolean);
    _callbacks.onVisibleRestaurantsRendered(/** @type {import('./types.js').Restaurant[]} */ (visibleCards));
  }

  if (loadMoreEl && loadMoreBtn) {
    if (end < list.length) {
      loadMoreBtn.textContent = '載入更多 (' + (list.length - end) + ' 家)';
      loadMoreEl.style.display = 'block';
    } else {
      loadMoreEl.style.display = 'none';
    }
  }
}

// ---------------------------------------------------------------------------
// Map Rendering
// ---------------------------------------------------------------------------

/**
 * Render Google Maps markers for the restaurant list.
 *
 * Clears existing markers and creates new ones with color coding
 * by rating (green >= 4, orange >= 3, red < 3).
 *
 * @param {import('./types.js').Restaurant[]} list - Filtered restaurant list
 */
export function renderMapMarkers(list) {
  if (!state.map || typeof google === 'undefined') return;

  state.markers.forEach((m) => m.setMap(null));
  state.markers = [];

  const bounds = state.map.getBounds();
  const visible = bounds
    ? list.filter((r) => {
          if (!hasValidCoordinates(r)) return false;
          try {
            return bounds.contains({
              lat: parseFloat(/** @type {string} */ (r.lat)),
              lng: parseFloat(/** @type {string} */ (r.lng)),
            });
          } catch {
            return false;
          }
        })
    : list.filter((r) => {
          return hasValidCoordinates(r);
        });

  const display = visible.slice(0, 500);
  display.forEach((r) => {
    const marker = new google.maps.Marker({
      position: {
        lat: parseFloat(/** @type {string} */ (r.lat)),
        lng: parseFloat(/** @type {string} */ (r.lng)),
      },
      map: state.map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 6,
        fillColor:
          r.rating >= 4
            ? '#07C160'
            : r.rating >= 3
              ? '#F39C12'
              : '#E74C3C',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      },
    });
    marker.addListener('click', () => {
      if (_callbacks.onCardClick) {
        _callbacks.onCardClick(r.id);
      }
    });
    state.markers.push(marker);
  });
}

// ---------------------------------------------------------------------------
// Detail View
// ---------------------------------------------------------------------------

/**
 * Show the restaurant detail view.
 *
 * Renders restaurant info, photos, address, opening hours,
 * and a mini map. Fetches additional details from Places API.
 *
 * @param {string} id - Restaurant ID
 */
export function showDetail(id) {
  const r = state.placesData.find((x) => x.id === id);
  if (!r) return;

  closeRandomPick();

  const loc = state.currentLocation;
  const hasCoords = hasValidCoordinates(r);
  const dist = loc && hasCoords ? formatDist(getRestaurantDistance(r, loc)) : '';
  const isFav = Store.isFav(r.id);

  const favBtn = document.getElementById('detail-fav');
  if (favBtn) {
    favBtn.textContent = isFav ? '\u2665' : '\u2661';
    favBtn.className = 'detail-fav' + (isFav ? ' is-fav' : '');
  }

  const content = document.getElementById('detail-content');
  if (!content) return;

  const photosHtml = r.photos && r.photos.length > 0
    ? '<div class="detail-photos" id="detail-photos-section">' +
      r.photos
        .map((p) => '<img class="detail-photo" src="' + escAttr(p) + '" alt="" />')
        .join('') +
      '</div>'
    : '<div class="detail-section detail-photos detail-photos-placeholder" id="detail-photos-section">' +
      '<div class="detail-placeholder">補充圖片中</div>' +
      '</div>';

  content.innerHTML =
    '<div class="detail-hero">' +
    '<div class="detail-name">' +
    escHtml(r.name || '') +
    '</div>' +
    (r.name_en && r.name_en !== r.name
      ? '<div class="detail-name-en">' + escHtml(r.name_en) + '</div>'
      : '') +
    (r.rating
      ? '<div class="detail-rating-row">' +
        '<span class="detail-stars">' +
        renderStars(r.rating) +
        '</span>' +
        '<span class="detail-rating-score">' +
        r.rating +
        '</span>' +
        (r.user_ratings_total
          ? '<span class="detail-rating-count">(' +
            r.user_ratings_total +
            ' 則評價)</span>'
          : '') +
        '</div>'
      : '') +
    '<div class="detail-meta">' +
    (dist ? '<span class="detail-meta-item">' + escHtml(dist) + '</span>' : '') +
    (r.price_level
      ? '<span class="detail-meta-item">' + priceLevel(r.price_level) + '</span>'
      : '') +
    (r.district_tc || r.district
      ? '<span class="detail-meta-item">' +
        escHtml(r.district_tc || /** @type {string} */ (r.district)) +
        '</span>'
      : '') +
    renderLocationTrustLabel(r) +
    '</div>' +
    '</div>' +
    photosHtml +
    '<div class="detail-section">' +
    '<div class="detail-section-title">地址</div>' +
    '<div class="detail-address">' +
    escHtml(r.address || '暫無地址資料') +
    '</div>' +
    '</div>' +
    '<div class="detail-section" id="detail-hours-section">' +
    '<div class="detail-section-title">營業時間</div>' +
    '<div class="loading" style="padding:16px;"><div class="loading-spinner"></div></div>' +
    '</div>' +
    (hasCoords
      ? '<div class="detail-section">' +
        '<div class="detail-section-title">位置</div>' +
        '<div class="detail-map" id="detail-map"></div>' +
        '</div>' +
        '<div class="detail-actions">' +
        "<button class=\"action-btn action-btn-secondary\" onclick=\"window.open('https://maps.google.com/?q=" +
        encodeURIComponent(r.name || '') +
        '&query=' +
        parseFloat(/** @type {string} */ (r.lat)) +
        ',' +
        parseFloat(/** @type {string} */ (r.lng)) +
        "', '_blank')\">Google 地圖</button>" +
        "<button class=\"action-btn action-btn-primary\" onclick=\"window.open('https://www.google.com/maps/dir/?api=1&destination=" +
        parseFloat(/** @type {string} */ (r.lat)) +
        ',' +
        parseFloat(/** @type {string} */ (r.lng)) +
        "', '_blank')\">導航</button>" +
        '</div>'
      : '<div class="detail-section">' +
        '<div class="detail-section-title">位置</div>' +
        '<div class="detail-address">暫無座標資料</div>' +
        '</div>');

  const detailView = document.getElementById('detail-view');
  if (detailView) {
    detailView.dataset.restaurantId = r.id;
    detailView.classList.add('active');
  }

  if (_callbacks.onFetchRestaurantEnrichment && r.enrichment_status !== 'ready') {
    r.enrichment_status = 'loading';
    _callbacks.onFetchRestaurantEnrichment(r, (updated, result) => {
      if (!updated) return;

      const photosSection = document.getElementById('detail-photos-section');
      if (photosSection && updated.photos && updated.photos.length > 0) {
        photosSection.outerHTML =
          '<div class="detail-photos" id="detail-photos-section">' +
          updated.photos
            .map((p) => '<img class="detail-photo" src="' + escAttr(p) + '" alt="" />')
            .join('') +
          '</div>';
      }

      const section = document.getElementById('detail-hours-section');
      if (!section) return;

      if (result && result.details) {
        const details = result.details;
        const openingHours = details.opening_hours || null;
        const phone = details.formatted_phone_number || details.phone || '';
        const website = details.website || '';
        let hoursHtml = '<div class="detail-section-title">營業時間</div>';

        if (openingHours) {
          const isOpen = typeof openingHours.isOpen === 'function'
            ? openingHours.isOpen()
            : false;
          hoursHtml +=
            '<div class="detail-hours">' +
            '<div class="detail-hours-row">' +
            '<span class="' +
            (isOpen ? 'detail-hours-open' : 'detail-hours-closed') +
            '">' +
            (isOpen ? '營業中' : '已歇業') +
            '</span>' +
            '</div>' +
            (openingHours.weekday_text || [])
              .map((w) => {
                const [day, time] = w.split(': ');
                return (
                  '<div class="detail-hours-row">' +
                  '<span class="detail-hours-day">' +
                  escHtml(day) +
                  '</span>' +
                  '<span class="detail-hours-time">' +
                  escHtml(time) +
                  '</span>' +
                  '</div>'
                );
              })
              .join('') +
            '</div>';
        } else {
          hoursHtml += '<div style="color:var(--text-muted);font-size:13px;">暫無營業時間資料</div>';
        }

        if (phone) {
          hoursHtml +=
            '<div style="margin-top:12px;"><span style="font-weight:500;">電話: </span>' +
            escHtml(phone) +
            '</div>';
        }
        if (website) {
          hoursHtml +=
            '<div style="margin-top:4px;"><span style="font-weight:500;">網站: </span><a href="' +
            escAttr(website) +
            '" target="_blank" rel="noopener noreferrer" style="color:var(--brand);">前往網站</a></div>';
        }
        section.outerHTML =
          '<div class="detail-section" id="detail-hours-section">' +
          hoursHtml +
          '</div>';
        const addressNode = document.querySelector('#detail-view .detail-address');
        if (addressNode && updated.address) {
          addressNode.textContent = updated.address;
        }
      } else if (result?.status === 'failed') {
        section.innerHTML =
          '<div class="detail-section-title">營業時間</div>' +
          '<div style="color:var(--text-muted);font-size:13px;">暫無補充資料</div>';
      }
    });
  } else if (r.place_id && _callbacks.onFetchPlaceDetails) {
    _callbacks.onFetchPlaceDetails(r.place_id, (details) => {
      if (!details) return;
      const section = document.getElementById('detail-hours-section');
      if (!section) return;
      let hoursHtml = '<div class="detail-section-title">營業時間</div>';
      if (details.opening_hours) {
        const isOpen = details.opening_hours.isOpen
          ? details.opening_hours.isOpen()
          : false;
        hoursHtml += '<div class="detail-hours">' +
          '<div class="detail-hours-row">' +
          '<span class="' +
          (isOpen ? 'detail-hours-open' : 'detail-hours-closed') +
          '">' +
          (isOpen ? '營業中' : '已歇業') +
          '</span>' +
          '</div>' +
          (details.opening_hours.weekday_text || [])
            .map((w) => {
              const [day, time] = w.split(': ');
              return (
                '<div class="detail-hours-row">' +
                '<span class="detail-hours-day">' +
                escHtml(day) +
                '</span>' +
                '<span class="detail-hours-time">' +
                escHtml(time) +
                '</span>' +
                '</div>'
              );
            })
            .join('') +
          '</div>';
      } else {
        hoursHtml +=
          '<div style="color:var(--text-muted);font-size:13px;">暫無營業時間資料</div>';
      }
      if (details.formatted_phone_number) {
        hoursHtml +=
          '<div style="margin-top:12px;"><span style="font-weight:500;">電話: </span>' +
          details.formatted_phone_number +
          '</div>';
      }
      if (details.website) {
        hoursHtml +=
          '<div style="margin-top:4px;"><span style="font-weight:500;">網站: </span><a href="' +
          details.website +
          '" target="_blank" style="color:var(--brand);">前往網站</a></div>';
      }
      section.innerHTML = hoursHtml;
    });
  }

  setTimeout(() => {
    if (!hasCoords) return;
    const mapEl = document.getElementById('detail-map');
    if (mapEl && !mapEl.dataset.init && typeof google !== 'undefined') {
      mapEl.dataset.init = '1';
      const miniMap = new google.maps.Map(mapEl, {
        zoomControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: false,
      });
      miniMap.setCenter({
        lat: parseFloat(/** @type {string} */ (r.lat)),
        lng: parseFloat(/** @type {string} */ (r.lng)),
      });
      miniMap.setZoom(16);
      new google.maps.Marker({
        position: {
          lat: parseFloat(/** @type {string} */ (r.lat)),
          lng: parseFloat(/** @type {string} */ (r.lng)),
        },
        map: miniMap,
      });
    }
  }, 100);
}

// ---------------------------------------------------------------------------
// Random Picker
// ---------------------------------------------------------------------------

/** @type {number|null} */
let _rollInterval = null;
/** @type {number|null} */
let _randomAutoStartTimer = null;

function clearRandomAutoStartTimer() {
  if (_randomAutoStartTimer) {
    clearTimeout(_randomAutoStartTimer);
    _randomAutoStartTimer = null;
  }
}

/**
 * Open the random picker overlay.
 *
 * Shows a rolling animation that cycles through candidate restaurants,
 * then reveals a random selection.
 */
export function openRandomPick() {
  const overlay = document.getElementById('random-overlay');
  const setup = document.getElementById('random-setup');
  const footer = document.getElementById('random-footer');
  const body = document.getElementById('random-body');
  const subtitle = document.getElementById('random-subtitle');
  const queryInput = document.getElementById('random-query-input');
  const modeButtons = document.querySelectorAll('#random-mode-bar .random-mode-btn');
  const scopeButtons = document.querySelectorAll('#random-scope-bar .random-scope-btn');

  if (!overlay || !footer || !body) return;

  const settings = getRandomPickSettings();

  overlay.classList.add('active');
  overlay.dataset.randomMode = settings.mode;
  overlay.dataset.randomQuery = settings.query;
  overlay.dataset.randomScope = settings.scope;
  const autoStart = !setup;
  if (setup) setup.style.display = '';
  footer.style.display = 'none';
  body.style.display = '';
  if (subtitle) {
    subtitle.textContent = autoStart ? '讓我幫你決定！' : '先揀模式，再開始抽';
  }

  if (queryInput) {
    queryInput.value = settings.query;
  }
  modeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.randomMode === settings.mode);
  });
  scopeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.randomScope === settings.scope);
  });

  clearRandomAutoStartTimer();
  if (autoStart) {
    startRandomPick();
  } else {
    _randomAutoStartTimer = setTimeout(() => {
      _randomAutoStartTimer = null;
      const currentOverlay = document.getElementById('random-overlay');
      if (!currentOverlay || !currentOverlay.classList.contains('active')) return;
      startRandomPick();
    }, 900);
  }
}

/**
 * Start the random picker using the current setup state.
 */
export function startRandomPick() {
  const overlay = document.getElementById('random-overlay');
  const setup = document.getElementById('random-setup');
  const footer = document.getElementById('random-footer');
  const body = document.getElementById('random-body');
  const subtitle = document.getElementById('random-subtitle');

  if (!overlay || !footer || !body) return;

  clearRandomAutoStartTimer();
  const settings = getRandomPickSettings();
  const candidates = getRandomPickCandidates(settings.mode, settings.query, settings.scope);

  if (candidates.length === 0) {
    if (_callbacks.onShowToast) {
      _callbacks.onShowToast('暫無可用餐廳');
    }
    return;
  }

  state.randomPickMode = settings.mode;
  state.randomPickQuery = settings.query;
  state.randomPickScope = settings.scope;
  overlay.classList.add('active');
  overlay.dataset.randomMode = settings.mode;
  overlay.dataset.randomQuery = settings.query;
  overlay.dataset.randomScope = settings.scope;
  if (setup) setup.style.display = 'none';
  footer.style.display = 'none';
  body.style.display = '';

  if (subtitle) {
    if (settings.mode === 'keyword' && settings.query) {
      subtitle.textContent = `幫你搵「${settings.query}」`;
    } else if (settings.mode === 'favorites') {
      subtitle.textContent = '收藏盲選，交俾我';
    } else {
      subtitle.textContent = settings.scope === 'walkable' ? '附近步行可達優先' : '讓我幫你決定！';
    }
  }

  let rollCount = 0;
  const maxRolls = RANDOM_PICK_ROLL_COUNT;
  const rollingNameEl = document.getElementById('random-rolling-name');

  _rollInterval = setInterval(() => {
    const randomIdx = Math.floor(Math.random() * candidates.length);
    const r = candidates[randomIdx];
    if (rollingNameEl) {
      rollingNameEl.textContent = r.name || '未知餐廳';
    }
    rollCount++;

    if (rollCount >= maxRolls) {
      clearInterval(_rollInterval);
      _rollInterval = null;
      showRandomResult(candidates);
    }
  }, RANDOM_PICK_ROLL_INTERVAL_MS);

  if (rollingNameEl && candidates.length > 0) {
    rollingNameEl.textContent = candidates[0].name || '未知餐廳';
  }
}

/**
 * Show the random picker result.
 *
 * @param {import('./types.js').Restaurant[]} candidates - Eligible restaurants
 */
export function showRandomResult(candidates) {
  const idx = Math.floor(Math.random() * candidates.length);
  const r = candidates[idx];
  state.randomPickResult = r;

  const body = document.getElementById('random-body');
  const footer = document.getElementById('random-footer');
  const subtitle = document.getElementById('random-subtitle');

  const dist = r.distance ? formatDist(r.distance) : '';
  const district = r.district_tc || r.district || '';
  const detailParts = [];
  if (district) detailParts.push(district);
  if (dist) detailParts.push(dist);
  if (r.price_level) detailParts.push(priceLevel(r.price_level));
  if (r.location_status === 'approximate') detailParts.push('座標約略');
  if (r.location_status === 'missing') detailParts.push('未標示位置');

  if (body) body.style.display = 'none';
  if (footer) footer.style.display = '';
  if (subtitle) subtitle.textContent = '找到了！';

  const resultName = document.getElementById('random-result-name');
  const resultDetail = document.getElementById('random-result-detail');
  const resultRating = document.getElementById('random-result-rating');

  if (resultName) resultName.textContent = r.name || '未知餐廳';
  if (resultDetail) resultDetail.textContent = detailParts.join(' · ') || '';
  if (resultRating) {
    resultRating.innerHTML = r.rating
      ? '<span class="stars" style="color:var(--star);font-size:14px;">' +
        renderStars(r.rating) +
        '</span>' +
        ' <span style="font-weight:600;">' +
        r.rating +
        '</span>' +
        (r.user_ratings_total
          ? ' <span style="color:var(--text-muted);font-size:12px;">(' +
            r.user_ratings_total +
            ' 則)</span>'
          : '')
      : '<span style="color:var(--text-muted);">暫無評分</span>';
  }
  if (subtitle) {
    subtitle.textContent = '找到了！';
  }
}

/**
 * Close the random picker overlay.
 */
export function closeRandomPick() {
  const overlay = document.getElementById('random-overlay');
  if (overlay) overlay.classList.remove('active');
  state.randomPickResult = null;
  clearRandomAutoStartTimer();
  if (overlay) {
    overlay.dataset.randomMode = '';
    overlay.dataset.randomQuery = '';
    overlay.dataset.randomScope = '';
  }
  if (_rollInterval) {
    clearInterval(_rollInterval);
    _rollInterval = null;
  }
}

/**
 * Reroll the random picker (show a new random result).
 */
export function rerollRandom() {
  const overlay = document.getElementById('random-overlay');
  const mode = overlay?.dataset.randomMode || state.randomPickMode || 'walkable';
  const query = overlay?.dataset.randomQuery || state.randomPickQuery || '';
  const scope = overlay?.dataset.randomScope || state.randomPickScope || 'walkable';
  state.randomPickMode = mode;
  state.randomPickQuery = query;
  state.randomPickScope = scope;
  startRandomPick();
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

/** Current favorites sort mode. */
export let favSortMode = 'recent';

const DEFAULT_LOCATION_GROUPS = [
  {
    id: 'hong_kong_island',
    label: '港島',
    locations: [
      { id: 'central', label: '中環', lat: 22.2808, lng: 114.1588, isDefault: true },
      { id: 'causeway_bay', label: '銅鑼灣', lat: 22.2783, lng: 114.1825, isDefault: true },
      { id: 'quarry_bay', label: '鰂魚涌', lat: 22.2855, lng: 114.2158, isDefault: true },
      { id: 'wan_chai', label: '灣仔', lat: 22.2776, lng: 114.1729, isDefault: true },
      { id: 'sheung_wan', label: '上環', lat: 22.2866, lng: 114.1516, isDefault: true },
      { id: 'admiralty', label: '金鐘', lat: 22.2794, lng: 114.1650, isDefault: true },
      { id: 'north_point', label: '北角', lat: 22.2915, lng: 114.2003, isDefault: true },
      { id: 'eastern', label: '柴灣', lat: 22.2674, lng: 114.2411, isDefault: true },
      { id: 'southern', label: '海怡 / 黃竹坑', lat: 22.2495, lng: 114.1640, isDefault: true },
    ],
  },
  {
    id: 'kowloon',
    label: '九龍',
    locations: [
      { id: 'mong_kok', label: '旺角', lat: 22.3193, lng: 114.1694, isDefault: true },
      { id: 'tsim_sha_tsui', label: '尖沙咀', lat: 22.2977, lng: 114.1728, isDefault: true },
      { id: 'yau_mai_tei', label: '油麻地', lat: 22.3068, lng: 114.1715, isDefault: true },
      { id: 'kowloon_city', label: '九龍城', lat: 22.3313, lng: 114.1896, isDefault: true },
      { id: 'sham_shui_po', label: '深水埗', lat: 22.3326, lng: 114.1621, isDefault: true },
      { id: 'wong_tai_sin', label: '黃大仙', lat: 22.3419, lng: 114.1923, isDefault: true },
      { id: 'kwun_tong', label: '觀塘', lat: 22.3141, lng: 114.2256, isDefault: true },
      { id: 'lam_tin', label: '藍田 / 油塘', lat: 22.3019, lng: 114.2350, isDefault: true },
    ],
  },
  {
    id: 'new_territories',
    label: '新界',
    locations: [
      { id: 'shatin', label: '沙田', lat: 22.3813, lng: 114.1880, isDefault: true },
      { id: 'tsuen_wan', label: '荃灣', lat: 22.3709, lng: 114.1095, isDefault: true },
      { id: 'tuen_mun', label: '屯門', lat: 22.3914, lng: 113.9799, isDefault: true },
      { id: 'yuen_long', label: '元朗', lat: 22.4452, lng: 114.0222, isDefault: true },
      { id: 'tai_po', label: '大埔', lat: 22.4458, lng: 114.1656, isDefault: true },
      { id: 'north', label: '上水 / 粉嶺', lat: 22.5007, lng: 114.1262, isDefault: true },
      { id: 'sai_kung', label: '西貢', lat: 22.3816, lng: 114.2724, isDefault: true },
      { id: 'kwai_tsing', label: '葵青', lat: 22.3544, lng: 114.1271, isDefault: true },
    ],
  },
  {
    id: 'islands',
    label: '離島',
    locations: [
      { id: 'islands', label: '離島', lat: 22.2670, lng: 113.9760, isDefault: true },
      { id: 'tung_chung', label: '東涌', lat: 22.2898, lng: 113.9407, isDefault: true },
      { id: 'cheung_chau', label: '長洲', lat: 22.2040, lng: 114.0290, isDefault: true },
      { id: 'mui_wo', label: '梅窩', lat: 22.2649, lng: 114.0001, isDefault: true },
    ],
  },
];

/**
 * Show the favorites page.
 */
export function showFavoritesPage() {
  const favPage = document.getElementById('fav-page');
  const viewToggle = document.getElementById('view-toggle');
  const randomPickBtn = document.getElementById('random-pick-btn');

  if (favPage) favPage.classList.add('active');
  if (viewToggle) viewToggle.style.display = 'none';
  if (randomPickBtn) randomPickBtn.style.display = 'none';

  renderFavorites();
}

/**
 * Hide the favorites page.
 */
export function hideFavoritesPage() {
  const favPage = document.getElementById('fav-page');
  const viewToggle = document.getElementById('view-toggle');
  const randomPickBtn = document.getElementById('random-pick-btn');

  if (favPage) favPage.classList.remove('active');
  if (viewToggle) viewToggle.style.display = '';
  if (randomPickBtn) randomPickBtn.style.display = '';
}

/**
 * Render the favorites list.
 */
export function renderFavorites() {
  const favIds = Store.getFavorites();
  const container = document.getElementById('fav-list');
  const emptyEl = document.getElementById('fav-empty');

  if (!container) return;

  if (favIds.length === 0) {
    container.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  // Filter out saved favorites that no longer exist in placesData (e.g., filtered by validation)
  let favs = favIds
    .map((id) => state.placesData.find((r) => r.id === id))
    .filter(Boolean);

  switch (favSortMode) {
    case 'name':
      favs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      break;
    case 'distance':
      if (state.currentLocation) {
        favs = favs.map((r) => ({
          ...r,
          _favDist: haversine(
            state.currentLocation.lat,
            state.currentLocation.lng,
            parseFloat(/** @type {string} */ (r.lat)),
            parseFloat(/** @type {string} */ (r.lng))
          ),
        }));
        favs.sort(
          (a, b) =>
            (a._favDist || Infinity) - (b._favDist || Infinity)
        );
      }
      break;
    case 'recent':
    default:
      favs.reverse();
      break;
  }

  const fragment = document.createDocumentFragment();
  const temp = document.createElement('div');
  favs.forEach((r) => {
    const dist = state.currentLocation
      ? formatDist(
          haversine(
            state.currentLocation.lat,
            state.currentLocation.lng,
            parseFloat(/** @type {string} */ (r.lat)),
            parseFloat(/** @type {string} */ (r.lng))
          )
        )
      : '';
    temp.innerHTML = renderFavCardTemplate(r, dist);
    const card = temp.firstElementChild;
    if (card) {
      bindRestaurantCardInteractions(/** @type {HTMLElement} */ (card), r);
      card.addEventListener('click', () => {
        if (_callbacks.onHideFavoritesPage) {
          _callbacks.onHideFavoritesPage();
        }
        if (_callbacks.onCardClick) {
          _callbacks.onCardClick(/** @type {HTMLElement} */ (card).dataset.id);
        }
      });
      fragment.appendChild(card);
    }
  });

  container.innerHTML = '';
  container.appendChild(fragment);
}

/**
 * Set the favorites sort mode.
 *
 * @param {'recent'|'name'|'distance'} mode - Sort mode
 */
export function setFavSortMode(mode) {
  favSortMode = mode;
}

// ---------------------------------------------------------------------------
// Location Modal
// ---------------------------------------------------------------------------

/**
 * Show the location selection modal.
 *
 * @param {Array<Object>|function(Object): void} defaultLocationsOrCallback - Default locations array or callback
 * @param {function(Object): void} [maybeOnSelectLocation] - Callback when a location is selected
 */
export function showLocationModal(defaultLocationsOrCallback, maybeOnSelectLocation) {
  const defaultLocations = Array.isArray(defaultLocationsOrCallback) ? defaultLocationsOrCallback : [];
  const onSelectLocation = Array.isArray(defaultLocationsOrCallback)
    ? maybeOnSelectLocation
    : /** @type {function(Object): void} */ (defaultLocationsOrCallback);
  const customLocs = Store.getCustomLocations();

  const defaultContainer = document.getElementById('loc-list');
  if (defaultContainer) {
    const grouped = [];
    if (defaultLocations.length > 0) {
      const legacyQuickIds = ['central', 'causeway_bay', 'mong_kok', 'tsim_sha_tsui', 'quarry_bay'];
      const quickLocations = legacyQuickIds
        .map((id) => defaultLocations.find((loc) => loc.id === id))
        .filter(Boolean);
      grouped.push(
        '<div class="loc-group" data-group="legacy-quick">' +
        '<div class="loc-group-title">快捷地點</div>' +
        '<div class="loc-group-grid">' +
        quickLocations.map((loc) => {
          const isCurrent = state.currentLocation && state.currentLocation.id === loc.id;
          return (
            '<button type="button" class="loc-item loc-default-item" data-location-id="' +
            escAttr(loc.id) +
            '">' +
            '<div class="loc-item-main">' +
            '<div class="loc-item-name">' + escHtml(loc.label) + '</div>' +
            '</div>' +
            (isCurrent ? '<span class="loc-current">目前</span>' : '') +
            '</button>'
          );
        }).join('') +
        '</div>' +
        '</div>'
      );
    }

    DEFAULT_LOCATION_GROUPS.forEach((group) => {
      const groupLocations = (group.locations || []).filter((loc) => {
        if (defaultLocations.length === 0) return true;
        return defaultLocations.some((item) => item.id === loc.id);
      });
      if (groupLocations.length === 0) return;
      grouped.push(
        '<div class="loc-group" data-group="' + escAttr(group.id) + '">' +
        '<div class="loc-group-title">' + escHtml(group.label) + '</div>' +
        '<div class="loc-group-grid">' +
        groupLocations
          .map((loc) => {
            const isCurrent = state.currentLocation && state.currentLocation.id === loc.id;
            return (
              '<button type="button" class="loc-region-item" data-location-id="' +
              escAttr(loc.id) +
              '">' +
              '<div class="loc-item-main">' +
              '<div class="loc-item-name">' + escHtml(loc.label) + '</div>' +
              '</div>' +
              (isCurrent ? '<span class="loc-current">目前</span>' : '') +
              '</button>'
            );
          })
          .join('') +
        '</div>' +
        '</div>'
      );
    });

    defaultContainer.innerHTML = grouped.join('') || '<div style="font-size:12px;color:var(--text-muted);padding:4px 0;">尚未提供預設地點</div>';

    defaultContainer.querySelectorAll('[data-location-id]').forEach((item) => {
      item.addEventListener('click', () => {
        const loc = defaultLocations.find((l) => l.id === item.dataset.locationId);
        if (loc && onSelectLocation) onSelectLocation(loc);
      });
    });
  }

  const customContainer = document.getElementById('custom-loc-list');
  if (customContainer) {
    if (customLocs.length === 0) {
      customContainer.innerHTML =
        '<div style="font-size:12px;color:var(--text-muted);padding:4px 0;">尚未新增自訂地點</div>';
    } else {
      customContainer.innerHTML = customLocs
        .map((cl) => {
          const isCurrent =
            state.currentLocation && state.currentLocation.id === cl.id;
          return (
            '<div class="loc-custom-item" data-custom-id="' +
            escAttr(cl.id) +
            '">' +
            '<div class="loc-item-main">' +
            '<div class="loc-item-name">' + escHtml(cl.label) + '</div>' +
            (cl.address ? '<div class="loc-item-sub">' + escHtml(cl.address) + '</div>' : '') +
            '</div>' +
            (isCurrent ? '<span class="loc-current">目前</span>' : '') +
            '<button class="loc-item-delete" data-del-id="' +
            escAttr(cl.id) +
            '">×</button>' +
            '</div>'
          );
        })
        .join('');

      customContainer.querySelectorAll('.loc-custom-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          const target = /** @type {HTMLElement} */ (e.target);
          if (target.classList.contains('loc-item-delete')) {
            e.stopPropagation();
            const delId = target.dataset.delId;
            Store.removeCustomLocation(delId);
            showLocationModal(defaultLocations, onSelectLocation);
            return;
          }
          const cl = customLocs.find(
            (l) => l.id === item.dataset.customId
          );
          if (cl) onSelectLocation(cl);
        });
      });
    }
  }

  const locModal = document.getElementById('loc-modal');
  if (locModal) locModal.classList.add('active');
}

/**
 * Hide the location selection modal.
 */
export function hideLocationModal() {
  const locModal = document.getElementById('loc-modal');
  if (locModal) locModal.classList.remove('active');
}


