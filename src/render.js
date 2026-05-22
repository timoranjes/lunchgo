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
  /** @type {function(): void|null} */
  onHideFavoritesPage: null,
};

/**
 * Register callbacks for interactivity.
 *
 * @param {Object} cb - Callback map
 * @param {function(string): void} [cb.onCardClick] - Called when a restaurant card is clicked
 * @param {function(string): void} [cb.onShowToast] - Called to show a toast message
 * @param {function(string, function): void} [cb.onFetchPlaceDetails] - Called to fetch place details
 * @param {function(): void} [cb.onHideFavoritesPage] - Called to hide favorites page
 */
export function setRenderCallbacks(cb) {
  if (cb.onCardClick) _callbacks.onCardClick = cb.onCardClick;
  if (cb.onShowToast) _callbacks.onShowToast = cb.onShowToast;
  if (cb.onFetchPlaceDetails) _callbacks.onFetchPlaceDetails = cb.onFetchPlaceDetails;
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
  const dist = r.distance ? formatDist(r.distance) : '';
  const district = r.district_tc || r.district || '';
  const stars = r.rating ? renderStars(r.rating) : '';
  const price = r.price_level ? priceLevel(r.price_level) : '';

  let thumbHtml = '<div class="rest-card-thumb">';
  if (r.photos && r.photos.length > 0) {
    thumbHtml +=
      '<img src="' +
      escAttr(r.photos[0]) +
      '" alt="" loading="lazy" onerror="this.style.display=\'none\'" />';
  }
  thumbHtml += '</div>';

  let tags = '';
  if (district) tags += '<span class="tag tag-district">' + escHtml(district) + '</span>';
  if (dist) tags += '<span class="tag tag-distance">' + escHtml(dist) + '</span>';
  if (r.cuisine)
    tags += '<span class="tag tag-cuisine">' + escHtml(r.cuisine.split(',')[0]) + '</span>';
  if (price) tags += '<span class="tag tag-price">' + escHtml(price.trim()) + '</span>';

  return (
    '<div class="rest-card" data-id="' +
    escAttr(r.id) +
    '">' +
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
  const dist = r.distance ? formatDist(r.distance) : '';
  let imgHtml = '';
  if (r.photos && r.photos.length > 0) {
    imgHtml =
      '<img src="' + escAttr(r.photos[0]) + '" alt="" loading="lazy" />';
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

  let thumbHtml = '<div class="rest-card-thumb">';
  if (r.photos && r.photos.length > 0) {
    thumbHtml +=
      '<img src="' +
      escAttr(r.photos[0]) +
      '" alt="" loading="lazy" onerror="this.style.display=\'none\'" />';
  }
  thumbHtml += '</div>';

  let tags = '';
  if (district) tags += '<span class="tag tag-district">' + escHtml(district) + '</span>';
  if (dist) tags += '<span class="tag tag-distance">' + escHtml(dist) + '</span>';
  if (r.cuisine)
    tags += '<span class="tag tag-cuisine">' + escHtml(r.cuisine.split(',')[0]) + '</span>';

  return (
    '<div class="rest-card" data-id="' +
    escAttr(r.id) +
    '">' +
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
      distance: haversine(
        loc.lat,
        loc.lng,
        parseFloat(/** @type {string} */ (r.lat)),
        parseFloat(/** @type {string} */ (r.lng))
      ),
    }));
  }

  switch (state.currentSort) {
    case 'distance':
      list.sort((a, b) => (a.distance || 0) - (b.distance || 0));
      break;
    case 'rating':
      list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      break;
    case 'name':
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      break;
  }

  state.filtered = list;

  const total = list.length;
  const resultCountEl = document.getElementById('result-count');
  if (resultCountEl) {
    resultCountEl.textContent = total + ' 家餐廳';
  }

  if (reset) {
    state.loadMoreIndex = 0;
  }

  const scheduleRender = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : requestAnimationFrame;

  scheduleRender(() => {
    renderDiscovery(list);
    renderList(list);
    if (state.map) renderMapMarkers(list);
  });

  const loadingEl = document.getElementById('loading-state');
  if (loadingEl) loadingEl.style.display = 'none';

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

  const rated = list.filter((r) => r.rating && r.rating > 0);

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
    subtitle.textContent = (cuisineLabel ? cuisineLabel.label : '') + '高分餐廳';
  } else {
    subtitle.textContent = '評分 ' + top[0].rating.toFixed(1) + ' 起';
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
      card.addEventListener('click', () => {
        if (_callbacks.onCardClick) {
          _callbacks.onCardClick(/** @type {HTMLElement} */ (card).dataset.id);
        }
      });
      fragment.appendChild(card);
    }
  });

  container.innerHTML = '';
  container.appendChild(fragment);

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
      card.addEventListener('click', () => {
        if (_callbacks.onCardClick) {
          _callbacks.onCardClick(/** @type {HTMLElement} */ (card).dataset.id);
        }
      });
      fragment.appendChild(card);
    }
  });
  container.appendChild(fragment);

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
        if (!r.lat || !r.lng) return false;
        try {
          return bounds.contains({
            lat: parseFloat(/** @type {string} */ (r.lat)),
            lng: parseFloat(/** @type {string} */ (r.lng)),
          });
        } catch {
          return false;
        }
      })
    : list.filter((r) => r.lat && r.lng);

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
  const dist = loc
    ? formatDist(
        haversine(
          loc.lat,
          loc.lng,
          parseFloat(/** @type {string} */ (r.lat)),
          parseFloat(/** @type {string} */ (r.lng))
        )
      )
    : '';
  const isFav = Store.isFav(r.id);

  const favBtn = document.getElementById('detail-fav');
  if (favBtn) {
    favBtn.textContent = isFav ? '\u2665' : '\u2661';
    favBtn.className = 'detail-fav' + (isFav ? ' is-fav' : '');
  }

  let photosHtml = '';
  if (r.photos && r.photos.length > 0) {
    photosHtml =
      '<div class="detail-photos">' +
      r.photos
        .map((p) => '<img class="detail-photo" src="' + escAttr(p) + '" alt="" />')
        .join('') +
      '</div>';
  }

  const content = document.getElementById('detail-content');
  if (!content) return;

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
    '</div>' +
    '</div>' +
    photosHtml +
    '<div class="detail-section">' +
    '<div class="detail-section-title">地址</div>' +
    '<div class="detail-address">' +
    escHtml(r.address || '暫無地址資料') +
    '</div>' +
    '</div>' +
    (r.place_id
      ? '<div class="detail-section" id="detail-hours-section">' +
        '<div class="detail-section-title">營業時間</div>' +
        '<div class="loading" style="padding:16px;"><div class="loading-spinner"></div></div>' +
        '</div>'
      : '') +
    '<div class="detail-section">' +
    '<div class="detail-section-title">位置</div>' +
    '<div class="detail-map" id="detail-map"></div>' +
    '</div>' +
    '<div class="detail-actions">' +
    "<button class=\"action-btn action-btn-secondary\" onclick=\"window.open('https://maps.google.com/?q=" +
    encodeURIComponent(r.name || '') +
    '&query=' +
    r.lat +
    ',' +
    r.lng +
    "', '_blank')\">Google 地圖</button>" +
    "<button class=\"action-btn action-btn-primary\" onclick=\"window.open('https://www.google.com/maps/dir/?api=1&destination=" +
    r.lat +
    ',' +
    r.lng +
    "', '_blank')\">導航</button>" +
    '</div>';

  const detailView = document.getElementById('detail-view');
  if (detailView) {
    detailView.classList.add('active');
  }

  if (r.place_id && _callbacks.onFetchPlaceDetails) {
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

/**
 * Open the random picker overlay.
 *
 * Shows a rolling animation that cycles through candidate restaurants,
 * then reveals a random selection.
 */
export function openRandomPick() {
  const overlay = document.getElementById('random-overlay');
  const footer = document.getElementById('random-footer');

  if (!overlay || !footer) return;

  const candidates =
    state.filtered.length > 0 ? state.filtered : state.placesData;

  if (candidates.length === 0) {
    if (_callbacks.onShowToast) {
      _callbacks.onShowToast('暫無餐廳可選');
    }
    return;
  }

  overlay.classList.add('active');
  footer.style.display = 'none';

  let rollCount = 0;
  const maxRolls = 20;
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
  }, 80);
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
}

/**
 * Close the random picker overlay.
 */
export function closeRandomPick() {
  const overlay = document.getElementById('random-overlay');
  if (overlay) overlay.classList.remove('active');
  state.randomPickResult = null;
  if (_rollInterval) {
    clearInterval(_rollInterval);
    _rollInterval = null;
  }
}

/**
 * Reroll the random picker (show a new random result).
 */
export function rerollRandom() {
  const candidates =
    state.filtered.length > 0 ? state.filtered : state.placesData;

  if (candidates.length === 0) return;

  const body = document.getElementById('random-body');
  const footer = document.getElementById('random-footer');
  const subtitle = document.getElementById('random-subtitle');
  const rollingNameEl = document.getElementById('random-rolling-name');

  if (body) body.style.display = '';
  if (footer) footer.style.display = 'none';
  if (subtitle) subtitle.textContent = '再選一次...';

  let rollCount = 0;
  const maxRolls = 15;

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
  }, 70);
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

/** Current favorites sort mode. */
export let favSortMode = 'recent';

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
 * @param {function(Object): void} onSelectLocation - Callback when a location is selected
 */
export function showLocationModal(onSelectLocation) {
  const customLocs = Store.getCustomLocations();

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
            '<div class="loc-item" data-custom-id="' +
            escAttr(cl.id) +
            '">' +
            '<div style="display:flex;align-items:center;flex:1;min-width:0;">' +
            '<div style="margin-right:8px;width:8px;height:8px;border-radius:50%;background:var(--brand);flex-shrink:0;"></div>' +
            '<div>' +
            '<div class="loc-item-name">' +
            escHtml(cl.label) +
            '</div>' +
            '</div>' +
            '</div>' +
            (isCurrent ? '<span style="color:var(--brand);">目前</span>' : '') +
            '<button class="loc-item-delete" data-del-id="' +
            escAttr(cl.id) +
            '">×</button>' +
            '</div>'
          );
        })
        .join('');

      customContainer.querySelectorAll('.loc-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          const target = /** @type {HTMLElement} */ (e.target);
          if (target.classList.contains('loc-item-delete')) {
            e.stopPropagation();
            const delId = target.dataset.delId;
            Store.removeCustomLocation(delId);
            showLocationModal(onSelectLocation);
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


