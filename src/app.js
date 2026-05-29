/**
 * LunchGo App Entry Point
 *
 * Main application initialization module. Imports all sub-modules,
 * wires up dependencies, and bootstraps the app.
 *
 * @module app
 */

import Store from './store.js';
import { state } from './state.js';
import {
  loadPlacesData as loadPlacesDataApi,
  fetchPlaceDetailsLegacy,
  fetchRestaurantEnrichmentLegacy,
} from './api.js';
import {
  updateDisplay,
  renderMapMarkers,
  showDetail,
  patchRestaurantCard,
  openRandomPick,
  closeRandomPick,
  rerollRandom,
  renderFavorites,
  showFavoritesPage,
  hideFavoritesPage,
  showLocationModal,
  hideLocationModal,
  setRenderCallbacks,
  setFavSortMode,
  CUISINES,
  renderSkeletonCards,
  teardownLazyLoading,
} from './render.js';
import { loadNearbyDistricts, mergeRestaurants } from './local-data.js';

const GOOGLE_MAPS_API_KEY = 'AIzaSyBN_pMA5dYGC70sS4OnoYALDszrTUUpjkM';

const DEFAULT_LOCATIONS = [
  { id: 'central', label: '中環', lat: 22.2808, lng: 114.1588, isDefault: true },
  { id: 'causeway_bay', label: '銅鑼灣', lat: 22.2783, lng: 114.1825 },
  { id: 'mong_kok', label: '旺角', lat: 22.3193, lng: 114.1694 },
  { id: 'tsim_sha_tsui', label: '尖沙咀', lat: 22.2977, lng: 114.1728 },
  { id: 'quarry_bay', label: '鰂魚涌', lat: 22.2855, lng: 114.2158 },
];

const ENRICHMENT_QUEUE_CONCURRENCY = 1;
const ENRICHMENT_QUEUE_DELAY_MS = 120;

const enrichmentQueueState = {
  pending: new Set(),
  active: 0,
  lastRun: 0,
  currentDetailId: '',
};

function markRestaurantEnrichment(restaurant, status, extra = {}) {
  if (!restaurant) return;
  restaurant.enrichment_status = status;
  restaurant.enrichment_error = extra.error || '';
  if (extra.photos) restaurant.photos = extra.photos;
  if (extra.photo_refs) restaurant.photo_refs = extra.photo_refs;
  if (extra.address) restaurant.address = extra.address;
  if (extra.phone) restaurant.phone = extra.phone;
  if (extra.website) restaurant.website = extra.website;
  if (extra.opening_hours) restaurant.opening_hours = extra.opening_hours;
  if (extra.rating !== undefined) restaurant.rating = extra.rating;
  if (extra.user_ratings_total !== undefined) restaurant.user_ratings_total = extra.user_ratings_total;
  if (extra.price_level !== undefined) restaurant.price_level = extra.price_level;
  patchRestaurantCard(restaurant);
}

function applyRestaurantEnrichmentUpdate(restaurant, payload) {
  if (!restaurant) return;
  if (payload && payload.details) {
    restaurant.enrichment_status = 'ready';
  } else if (payload && payload.status === 'failed') {
    restaurant.enrichment_status = 'failed';
  }
}

function scheduleQueuePump() {
  if (enrichmentQueueState.active >= ENRICHMENT_QUEUE_CONCURRENCY) return;
  const now = Date.now();
  const wait = Math.max(0, ENRICHMENT_QUEUE_DELAY_MS - (now - enrichmentQueueState.lastRun));
  setTimeout(pumpEnrichmentQueue, wait);
}

function queueVisibleRestaurantEnrichment(restaurants) {
  if (!Array.isArray(restaurants) || restaurants.length === 0) return;
  for (const restaurant of restaurants) {
    if (!restaurant || !restaurant.id) continue;
    if (restaurant.enrichment_status === 'ready' || restaurant.enrichment_status === 'loading' || restaurant.enrichment_status === 'failed') continue;
    enrichmentQueueState.pending.add(restaurant.id);
    if (!restaurant.enrichment_status) {
      restaurant.enrichment_status = 'pending';
    }
  }
  scheduleQueuePump();
}

async function pumpEnrichmentQueue() {
  if (enrichmentQueueState.active >= ENRICHMENT_QUEUE_CONCURRENCY) return;
  if (!state.placesService) return;

  const nextId = enrichmentQueueState.currentDetailId || enrichmentQueueState.pending.values().next().value;
  if (!nextId) return;
  enrichmentQueueState.pending.delete(nextId);

  const restaurant = state.placesData.find((r) => r.id === nextId);
  if (!restaurant) {
    scheduleQueuePump();
    return;
  }

  enrichmentQueueState.active += 1;
  enrichmentQueueState.lastRun = Date.now();
  markRestaurantEnrichment(restaurant, 'loading');

  try {
    const result = await new Promise((resolve) => {
      fetchRestaurantEnrichmentLegacy(state, restaurant, (_updated, payload) => resolve(payload), {
        forceRefresh: false,
      });
    });

    applyRestaurantEnrichmentUpdate(restaurant, result);

    if (result && result.details) {
      markRestaurantEnrichment(restaurant, 'ready', {
        photos: restaurant.photos,
        photo_refs: restaurant.photo_refs,
        address: restaurant.address,
        phone: restaurant.phone,
        website: restaurant.website,
        opening_hours: restaurant.opening_hours,
        rating: restaurant.rating,
        user_ratings_total: restaurant.user_ratings_total,
        price_level: restaurant.price_level,
      });
    } else {
      markRestaurantEnrichment(restaurant, 'failed', {
        error: result?.error?.message || '暫時無法補充資料',
      });
    }

    if (enrichmentQueueState.currentDetailId === restaurant.id) {
      showDetail(restaurant.id);
    }
  } finally {
    enrichmentQueueState.active -= 1;
    if (enrichmentQueueState.pending.size > 0) {
      scheduleQueuePump();
    }
  }
}

function refreshVisibleEnrichmentQueue() {
  if (!state.filtered || state.filtered.length === 0) return;
  const container = document.getElementById('rest-list');
  if (!container) return;
  const visibleIds = new Set(
    Array.from(container.querySelectorAll('.rest-card')).map((card) => card.dataset.id).filter(Boolean)
  );
  for (const restaurant of state.filtered) {
    if (!visibleIds.has(restaurant.id)) continue;
    if (restaurant.enrichment_status === 'ready' || restaurant.enrichment_status === 'loading' || restaurant.enrichment_status === 'failed') continue;
    enrichmentQueueState.pending.add(restaurant.id);
  }
  scheduleQueuePump();
}

function hasGoogleMaps() {
  return typeof window !== 'undefined' && typeof window.google !== 'undefined' && !!window.google.maps;
}

function ensureMapsServices() {
  if (!hasGoogleMaps()) return false;

  if (!state.geocoder) {
    state.geocoder = new google.maps.Geocoder();
  }

  if (!state.placesService) {
    // A detached node is enough for PlacesService initialization.
    state.placesService = new google.maps.places.PlacesService(document.createElement('div'));
  }

  return true;
}

function setupGoogleEnhancements() {
  if (!ensureMapsServices()) return false;

  const locSearchInput = document.getElementById('loc-search-input');
  if (locSearchInput && !state.autocomplete) {
    const autocomplete = new google.maps.places.Autocomplete(locSearchInput, {
      types: ['geocode'],
      componentRestrictions: { country: 'hk' },
    });
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (!place.geometry || !place.geometry.location) return;
      const loc = {
        id: place.place_id || 'search_' + Date.now(),
        label: place.name || place.formatted_address || place.geometry.location.toString(),
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
      };
      selectLocation(loc);
    });
    state.autocomplete = autocomplete;
  }

  return true;
}

setRenderCallbacks({
  onCardClick: (id) => {
    setDetailEnrichmentTarget(id);
    showDetail(id);
  },
  onShowToast: (msg) => showToast(msg),
  onFetchPlaceDetails: (placeId, callback) => fetchPlaceDetails(placeId, callback),
  onFetchRestaurantEnrichment: (restaurant, callback) => fetchRestaurantEnrichment(state, restaurant, callback),
  onVisibleRestaurantsRendered: (restaurants) => queueVisibleRestaurantEnrichment(restaurants),
  onHideFavoritesPage: () => hideFavoritesPage(),
});

/**
 * Load nearby restaurants from Google Places API.
 * Returns loaded restaurants; empty array on failure.
 * @param {{ lat: number, lng: number }} loc
 * @returns {Promise<import('./types.js').Restaurant[]>}
 */
async function loadPlacesData(loc) {
  if (!state.placesService || state.placesLoaded) return [];

  const timeoutMs = 10000;
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        restaurants: [],
        error: { status: 'TIMEOUT', message: 'Places API 請求逾時', kind: 'network' },
      });
    }, timeoutMs);
  });

  const { restaurants, error } = await Promise.race([
    loadPlacesDataApi(state.placesService, loc),
    timeoutPromise,
  ]);

  if (error) {
    console.error('[LunchGo] Places nearbySearch failed:', error.message);
    return [];
  }

  state.placesLoaded = true;
  return restaurants;
}

/**
 * Show a user-friendly error banner with retry button.
 * @param {string} errorMsg - Raw error message
 */
function showErrorBanner(errorMsg) {
  const banner = document.getElementById('error-banner');
  const loadingEl = document.getElementById('loading-state');
  const restListEl = document.getElementById('rest-list');

  if (loadingEl) loadingEl.style.display = 'none';

  let userMsg = '載入餐廳資料時發生錯誤';
  if (errorMsg.includes('API Key') || errorMsg.includes('被拒絕')) {
    userMsg = '地圖服務設定有誤，請聯絡管理員';
  } else if (errorMsg.includes('配額')) {
    userMsg = '目前使用量已達上限，請稍後再試';
  } else if (errorMsg.includes('伺服器')) {
    userMsg = '伺服器暫時無法連線，請稍後再試';
  } else if (errorMsg.includes('找不到')) {
    userMsg = '附近找不到餐廳，試試其他地點';
  }

  banner.innerHTML = userMsg +
    ' <button id="error-retry-btn" style="margin-left:8px;padding:2px 8px;border:1px solid currentColor;border-radius:4px;background:transparent;cursor:pointer;font-size:12px;">重試</button>';
  banner.classList.add('show');

  document.getElementById('error-retry-btn').addEventListener('click', () => {
    banner.classList.remove('show');
    state.placesLoaded = false;
    loadRestaurants();
  });

  if (restListEl) restListEl.innerHTML = '';

  setTimeout(() => banner.classList.remove('show'), 8000);
}

function fetchPlaceDetails(placeId, callback) {
  fetchPlaceDetailsLegacy(state, placeId, callback);
}

function fetchRestaurantEnrichment(stateArg, restaurant, callback) {
  fetchRestaurantEnrichmentLegacy(stateArg, restaurant, (updated, result) => {
    callback(updated, result);
    clearDetailEnrichmentTarget(restaurant?.id || '');
  });
}

function setDetailEnrichmentTarget(id) {
  enrichmentQueueState.currentDetailId = id || '';
}

function clearDetailEnrichmentTarget(id) {
  if (!id || enrichmentQueueState.currentDetailId === id) {
    enrichmentQueueState.currentDetailId = '';
  }
}

async function loadRestaurants() {
  const loc = state.currentLocation;
  if (!loc) return;

  const loadingEl = document.getElementById('loading-state');
  const restListEl = document.getElementById('rest-list');
  const emptyEl = document.getElementById('empty-state');
  const loadMoreEl = document.getElementById('load-more');
  const errorBanner = document.getElementById('error-banner');

  loadingEl.style.display = 'block';
  restListEl.innerHTML = '';
  emptyEl.style.display = 'none';
  loadMoreEl.style.display = 'none';
  errorBanner.classList.remove('show');
  if (loadingHideTimer) {
    clearTimeout(loadingHideTimer);
    loadingHideTimer = null;
  }
  const loadingStartedAt = Date.now();

  state.placesData = [];
  state.filtered = [];
  state.placesLoaded = false;
  teardownLazyLoading();

  try {
    const localData = await loadNearbyDistricts({ lat: loc.lat, lng: loc.lng });
    state.placesData = localData;
    updateDisplay();
    refreshVisibleEnrichmentQueue();
  } catch (err) {
    console.warn('[LunchGo] Local data load failed, continuing with Places only:', err.message);
  }

  const placesData = await loadPlacesData(loc);
  if (placesData.length > 0) {
    state.placesData = mergeRestaurants(state.placesData, placesData);
  }
  updateDisplay();
  refreshVisibleEnrichmentQueue();
  const minLoadingMs = 1800;
  const elapsed = Date.now() - loadingStartedAt;
  const remaining = Math.max(0, minLoadingMs - elapsed);
  loadingHideTimer = setTimeout(() => {
    loadingEl.style.display = 'none';
    loadingHideTimer = null;
  }, remaining);
}

const mapTypes = {
  roadmap: 'roadmap',
  satellite: 'satellite',
  terrain: 'terrain',
  hybrid: 'hybrid',
};

let currentMapType = 'roadmap';
let loadingHideTimer = null;

function initMap() {
  if (state.map) return;
  if (!ensureMapsServices()) return;
  const loc = state.currentLocation;
  if (!loc) return;

  state.map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: loc.lat, lng: loc.lng },
    zoom: 14,
    zoomControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    mapTypeControl: false,
    styles: [
      { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    ],
  });

  new google.maps.Marker({
    position: { lat: loc.lat, lng: loc.lng },
    map: state.map,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: '#07C160',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 3,
    },
    zIndex: 1000,
  });

  renderMapMarkers(state.filtered || state.placesData);
}

function switchMapType(name) {
  if (!state.map || !mapTypes[name]) return;
  state.map.setMapTypeId(mapTypes[name]);
  currentMapType = name;

  document.querySelectorAll('#map-tile-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tile === name);
  });
}

function selectLocation(loc) {
  Store.setLocation(loc);
  state.currentLocation = loc;
  state.currentLocationLabel = loc.label;
  hideLocationModal();

  document.getElementById('loc-btn').textContent = loc.label;

  state.placesData = [];
  state.filtered = [];
  state.placesLoaded = false;

  if (state.map) {
    state.map.setCenter({ lat: loc.lat, lng: loc.lng });
    state.map.setZoom(14);
  }

  loadRestaurants();
  showToast('已切換至 ' + loc.label);
}

function useGPS() {
  if (!navigator.geolocation) {
    showToast('瀏覽器不支援定位');
    return;
  }
  showToast('正在獲取位置...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      if (state.geocoder) {
        state.geocoder.geocode({ location: { lat, lng } }, (results, status) => {
          let label = '目前位置';
          if (status === 'OK' && results && results[0]) {
            const addr = results[0].formatted_address;
            const parts = addr.split(',');
            label = parts[0].trim();
            if (parts.length > 1) {
              for (const p of parts.slice(1)) {
                const trimmed = p.trim();
                if (trimmed.includes('香港') || trimmed.includes('九龍') || trimmed.includes('新界')) {
                  label += ', ' + trimmed;
                  break;
                }
              }
            }
          }
          selectLocation({ id: 'gps_' + Date.now(), label, lat, lng });
          hideLocationModal();
        });
      } else {
        selectLocation({ id: 'gps_' + Date.now(), label: '目前位置', lat, lng });
        hideLocationModal();
      }
    },
    () => {
      showToast('定位失敗，請手動選擇地點');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

function setView(view) {
  if (view === 'map' && !ensureMapsServices()) {
    showToast('地圖服務暫時不可用');
    return;
  }

  state.currentView = view;
  document.querySelectorAll('.view-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });

  if (view === 'list') {
    document.getElementById('list-view').style.display = 'block';
    document.getElementById('map-view').classList.remove('active');
    document.querySelector('.header').style.display = '';
    document.querySelector('.toolbar').style.display = '';
    document.querySelector('.cuisine-bar').style.display = '';
    document.querySelector('.price-bar').style.display = '';
    document.getElementById('discovery-section').style.display =
      state.filtered.filter(r => r.rating && r.rating > 0).length > 0 ? '' : 'none';
  } else {
    document.getElementById('list-view').style.display = 'none';
    document.getElementById('map-view').classList.add('active');
    document.querySelector('.header').style.display = '';
    document.querySelector('.toolbar').style.display = '';
    document.querySelector('.cuisine-bar').style.display = '';
    document.querySelector('.price-bar').style.display = '';
    document.getElementById('discovery-section').style.display = 'none';
    initMap();
    setTimeout(() => {
      if (state.map) {
        google.maps.event.trigger(state.map, 'resize');
        state.map.setCenter({ lat: state.currentLocation.lat, lng: state.currentLocation.lng });
        renderMapMarkers(state.filtered || state.placesData);
      }
    }, 500);
  }
}

function renderCuisineBar() {
  const bar = document.getElementById('cuisine-bar');
  bar.innerHTML = CUISINES.map(c =>
    '<button class="cuisine-chip' + (state.activeCuisine === c.id ? ' active' : '') + '" data-cuisine="' + c.id + '">' + c.label + '</button>'
  ).join('');

  bar.querySelectorAll('.cuisine-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.activeCuisine = chip.dataset.cuisine;
      bar.querySelectorAll('.cuisine-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      updateDisplay();
    });
  });
}

const PRICE_LEVELS = [
  { id: 'all', label: '全部' },
  { id: '1', label: '$' },
  { id: '2', label: '$$' },
  { id: '3', label: '$$$' },
  { id: '4', label: '$$$$' },
];

function renderPriceBar() {
  const bar = document.getElementById('price-bar');
  bar.innerHTML = PRICE_LEVELS.map(p =>
    '<button class="price-chip' + (state.activePrice === p.id ? ' active' : '') + '" data-price="' + p.id + '">' + p.label + '</button>'
  ).join('');

  bar.querySelectorAll('.price-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.activePrice = chip.dataset.price;
      bar.querySelectorAll('.price-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      updateDisplay();
    });
  });
}

function init() {
  const mapsAvailable = hasGoogleMaps();
  if (!mapsAvailable) {
    console.warn('[LunchGo] Google Maps unavailable at startup; continuing with local data only.');
  }

  let loc = Store.getLocation();
  if (!loc) {
    loc = DEFAULT_LOCATIONS.find(l => l.isDefault) || DEFAULT_LOCATIONS[0];
    Store.setLocation(loc);
  }
  state.currentLocation = loc;
  state.currentLocationLabel = loc.label;

  if (mapsAvailable) {
    ensureMapsServices();
    setupGoogleEnhancements();
  } else {
    window.addEventListener('lunchgo:google-maps-ready', () => {
      setupGoogleEnhancements();
    }, { once: true });
  }

  document.getElementById('loc-btn').textContent = loc.label;

  let searchTimer;
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');

  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchQuery = e.target.value.trim();
      searchClear.classList.toggle('visible', state.searchQuery.length > 0);
      updateDisplay();
    }, 200);
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    searchClear.classList.remove('visible');
    updateDisplay();
  });

  document.querySelectorAll('.toolbar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentSort = btn.dataset.sort;
      updateDisplay();
    });
  });

  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  document.querySelectorAll('#map-tile-toggle button').forEach(btn => {
    btn.addEventListener('click', () => switchMapType(btn.dataset.tile));
  });

  document.getElementById('load-more-btn').addEventListener('click', () => {
    updateDisplay(false);
  });

  document.getElementById('loc-btn').addEventListener('click', () => {
    showLocationModal(DEFAULT_LOCATIONS, selectLocation);
  });
  document.getElementById('loc-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideLocationModal();
  });
  document.getElementById('gps-btn').addEventListener('click', useGPS);

  document.getElementById('map-pick-loc-btn').addEventListener('click', () => {
    if (!ensureMapsServices()) {
      showToast('地圖服務暫時不可用');
      return;
    }
    hideLocationModal();
    setView('map');
    showToast('點擊地圖選擇位置');

    const pickListener = (e) => {
      const loc = {
        id: 'map_' + Date.now(),
        label: e.latLng.toUrlValue(6),
        lat: e.latLng.lat(),
        lng: e.latLng.lng(),
      };
      if (state.geocoder) {
        state.geocoder.geocode({ location: { lat: loc.lat, lng: loc.lng } }, (results, status) => {
          if (status === 'OK' && results && results[0]) {
            loc.label = results[0].formatted_address.split(',')[0].trim();
          }
          selectLocation(loc);
        });
      } else {
        selectLocation(loc);
      }
      state.map.removeListener('click', pickListener);
    };
    state.map.addListener('click', pickListener);
  });

  document.getElementById('add-custom-loc-btn').addEventListener('click', () => {
    hideLocationModal();
    document.getElementById('add-loc-modal').classList.add('active');
    document.getElementById('custom-loc-name').value = '';
  });

  document.getElementById('cancel-custom-loc').addEventListener('click', () => {
    document.getElementById('add-loc-modal').classList.remove('active');
  });

  document.getElementById('add-loc-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      document.getElementById('add-loc-modal').classList.remove('active');
    }
  });

  document.getElementById('custom-loc-gps').addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast('瀏覽器不支援定位');
      return;
    }
    showToast('正在獲取位置...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const name = document.getElementById('custom-loc-name').value.trim();
        if (!name) {
          showToast('請輸入地點名稱');
          return;
        }
        let label = name;
        const saveAndClose = (finalLabel) => {
          const loc = {
            id: 'custom_' + Date.now(),
            label: finalLabel,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            isCustom: true
          };
          Store.addCustomLocation(loc);
          document.getElementById('add-loc-modal').classList.remove('active');
          showToast('已新增 ' + finalLabel);
        };

        if (state.geocoder) {
          state.geocoder.geocode({ location: { lat: pos.coords.latitude, lng: pos.coords.longitude } }, (results, status) => {
            if (status === 'OK' && results && results[0]) {
              label = name + ' (' + results[0].formatted_address.split(',')[0].trim() + ')';
            }
            saveAndClose(label);
          });
        } else {
          saveAndClose(label);
        }
      },
      () => {
        showToast('定位失敗');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  document.getElementById('custom-loc-map').addEventListener('click', () => {
    if (!ensureMapsServices()) {
      showToast('地圖服務暫時不可用');
      return;
    }
    document.getElementById('add-loc-modal').classList.remove('active');
    setView('map');

    const pickListener = (e) => {
      const name = document.getElementById('custom-loc-name').value.trim() || '自訂地點';
      const loc = {
        id: 'custom_' + Date.now(),
        label: name,
        lat: e.latLng.lat(),
        lng: e.latLng.lng(),
        isCustom: true
      };
      Store.addCustomLocation(loc);
      state.map.removeListener('click', pickListener);
      setView('list');
      showToast('已新增 ' + name);
    };
    state.map.addListener('click', pickListener);
    showToast('點擊地圖選擇位置');
  });

  document.getElementById('fav-btn').addEventListener('click', showFavoritesPage);
  document.getElementById('fav-back').addEventListener('click', hideFavoritesPage);

  document.querySelectorAll('.fav-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fav-sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setFavSortMode(btn.dataset.favSort);
      renderFavorites();
    });
  });

  document.getElementById('detail-back').addEventListener('click', () => {
    clearDetailEnrichmentTarget(document.getElementById('detail-view')?.dataset.restaurantId || '');
    document.getElementById('detail-view').classList.remove('active');
  });

  document.getElementById('detail-view').addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.closest('#detail-content')) return;
    if (target.closest('.detail-header button')) return;
    clearDetailEnrichmentTarget(document.getElementById('detail-view')?.dataset.restaurantId || '');
    document.getElementById('detail-view').classList.remove('active');
  });

  document.getElementById('detail-fav').addEventListener('click', () => {
    const detailView = document.getElementById('detail-view');
    const detailId = detailView ? detailView.dataset.restaurantId : '';
    const r = detailId ? state.placesData.find(x => x.id === detailId) : null;
    if (!r) return;
    const added = Store.toggleFav(r.id);
    const favBtn = document.getElementById('detail-fav');
    favBtn.textContent = added ? '\u2665' : '\u2661';
    favBtn.className = 'detail-fav' + (added ? ' is-fav' : '');
    showToast(added ? '已收藏' : '已取消收藏');
  });

  document.getElementById('map-panel-close').addEventListener('click', () => {
    document.getElementById('map-panel').classList.remove('active');
  });

  renderCuisineBar();
  renderPriceBar();

  document.getElementById('random-pick-btn').addEventListener('click', openRandomPick);
  document.getElementById('random-close').addEventListener('click', closeRandomPick);
  document.getElementById('random-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeRandomPick();
  });
  document.getElementById('random-reroll').addEventListener('click', rerollRandom);
  document.getElementById('random-view').addEventListener('click', () => {
    if (state.randomPickResult) {
      setDetailEnrichmentTarget(state.randomPickResult.id);
      showDetail(state.randomPickResult.id);
    }
  });

  loadRestaurants();
}

init();

window.addEventListener('error', (e) => {
  if (e.message && e.message.includes('localStorage')) {
    console.warn('[LunchGo] localStorage error (non-fatal):', e.message);
    return;
  }
  console.error('[LunchGo] Uncaught error:', e.message);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[LunchGo] Unhandled promise rejection:', e.reason);
});

export { init, GOOGLE_MAPS_API_KEY, DEFAULT_LOCATIONS };
