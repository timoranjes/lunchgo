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
import { loadPlacesDataLegacy, fetchPlaceDetailsLegacy, fetchPhotosForTopRestaurantsLegacy } from './api.js';
import {
  updateDisplay,
  renderMapMarkers,
  showDetail,
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

const GOOGLE_MAPS_API_KEY = 'YOUR_API_KEY_HERE';

const DEFAULT_LOCATIONS = [
  { id: 'central', label: '中環', lat: 22.2808, lng: 114.1588, isDefault: true },
  { id: 'causeway_bay', label: '銅鑼灣', lat: 22.2783, lng: 114.1825 },
  { id: 'mong_kok', label: '旺角', lat: 22.3193, lng: 114.1694 },
  { id: 'tsim_sha_tsui', label: '尖沙咀', lat: 22.2977, lng: 114.1728 },
  { id: 'quarry_bay', label: '鰂魚涌', lat: 22.2855, lng: 114.2158 },
];

setRenderCallbacks({
  onCardClick: (id) => showDetail(id),
  onShowToast: (msg) => showToast(msg),
  onFetchPlaceDetails: (placeId, callback) => fetchPlaceDetails(placeId, callback),
  onHideFavoritesPage: () => hideFavoritesPage(),
});

async function loadPlacesData(loc) {
  if (!state.placesService || state.placesLoaded) return;
  await loadPlacesDataLegacy(state, loc, () => {
    updateDisplay();
  }, (errorMsg) => {
    console.error('[LunchGo] Places nearbySearch failed:', errorMsg);
    showErrorBanner(errorMsg);
  });
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

function fetchPhotosForTopRestaurants(places) {
  fetchPhotosForTopRestaurantsLegacy(places, state, () => {
    updateDisplay();
  });
}

function fetchPlaceDetails(placeId, callback) {
  fetchPlaceDetailsLegacy(state, placeId, callback);
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
  restListEl.innerHTML = renderSkeletonCards(6);
  emptyEl.style.display = 'none';
  loadMoreEl.style.display = 'none';
  errorBanner.classList.remove('show');

  state.placesData = [];
  state.filtered = [];
  state.placesLoaded = false;
  teardownLazyLoading();

  await loadPlacesData(loc);
}

const mapTypes = {
  roadmap: google.maps.MapTypeId.ROADMAP,
  satellite: google.maps.MapTypeId.SATELLITE,
  terrain: google.maps.MapTypeId.TERRAIN,
  hybrid: google.maps.MapTypeId.HYBRID,
};

let currentMapType = 'roadmap';

function initMap() {
  if (state.map) return;
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

  state.placesService = new google.maps.places.PlacesService(state.map);
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
    document.getElementById('discovery-section').style.display =
      state.filtered.filter(r => r.rating && r.rating > 0).length > 0 ? '' : 'none';
  } else {
    document.getElementById('list-view').style.display = 'none';
    document.getElementById('map-view').classList.add('active');
    document.querySelector('.header').style.display = '';
    document.querySelector('.toolbar').style.display = '';
    document.querySelector('.cuisine-bar').style.display = '';
    document.getElementById('discovery-section').style.display = 'none';
    initMap();
    setTimeout(() => {
      if (state.map) {
        google.maps.event.trigger(state.map, 'resize');
        renderMapMarkers(state.filtered || state.placesData);
      }
    }, 200);
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

function init() {
  if (typeof google === 'undefined' || !google.maps) {
    const banner = document.getElementById('error-banner');
    banner.innerHTML = '地圖服務載入失敗，請檢查網路連線' +
      ' <button id="error-retry-btn" style="margin-left:8px;padding:2px 8px;border:1px solid currentColor;border-radius:4px;background:transparent;cursor:pointer;font-size:12px;">重試</button>';
    banner.classList.add('show');
    document.getElementById('error-retry-btn').addEventListener('click', () => {
      window.location.reload();
    });
    document.getElementById('loading-state').style.display = 'none';
    return;
  }

  let loc = Store.getLocation();
  if (!loc) {
    loc = DEFAULT_LOCATIONS.find(l => l.isDefault) || DEFAULT_LOCATIONS[0];
    Store.setLocation(loc);
  }
  state.currentLocation = loc;
  state.currentLocationLabel = loc.label;

  state.geocoder = new google.maps.Geocoder();
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
    document.getElementById('detail-view').classList.remove('active');
  });

  document.getElementById('detail-fav').addEventListener('click', () => {
    const content = document.getElementById('detail-content');
    const nameEl = content.querySelector('.detail-name');
    if (!nameEl) return;
    const name = nameEl.textContent;
    const r = state.placesData.find(x => x.name === name);
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

  document.getElementById('random-pick-btn').addEventListener('click', openRandomPick);
  document.getElementById('random-close').addEventListener('click', closeRandomPick);
  document.getElementById('random-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeRandomPick();
  });
  document.getElementById('random-reroll').addEventListener('click', rerollRandom);
  document.getElementById('random-view').addEventListener('click', () => {
    if (state.randomPickResult) {
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
