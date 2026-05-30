(function () {
  const host = location.hostname;
  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1';

  const apiSrc =
    'https://maps.googleapis.com/maps/api/js?key=AIzaSyBN_pMA5dYGC70sS4OnoYALDszrTUUpjkM&libraries=places&language=zh-TW&region=HK';

  if (!isLocal) {
    // Avoid document.write() on production hosts.
    // A parser-inserted script here can swallow the remaining HTML and
    // prevent the module entrypoint from running. Use a normal async
    // loader so the app can keep booting even if Google is slow or blocked.
    const script = document.createElement('script');
    script.src = apiSrc;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      window.dispatchEvent(new Event('lunchgo:google-maps-ready'));
    };
    script.onerror = () => {
      window.dispatchEvent(new Event('lunchgo:google-maps-failed'));
    };
    (document.head || document.documentElement).appendChild(script);
    return;
  }

  function createListeners() {
    const listeners = new Map();
    return {
      add(event, handler) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(handler);
        return { remove: () => listeners.get(event)?.delete(handler) };
      },
      emit(event, payload) {
        for (const handler of listeners.get(event) || []) {
          try {
            handler(payload);
          } catch {
            // Ignore stub listener errors
          }
        }
      },
    };
  }

  function getStubRegistry() {
    window.__lunchgoGoogleStub = window.__lunchgoGoogleStub || {
      nearbySearch() {
        return { status: 'ZERO_RESULTS', results: [] };
      },
      textSearch() {
        return { status: 'ZERO_RESULTS', results: [] };
      },
      getDetails() {
        return { status: 'ZERO_RESULTS', details: null };
      },
    };
    return window.__lunchgoGoogleStub;
  }

  function deliverStubResponse(callback, response, kind) {
    const payload = kind === 'details'
      ? (response?.details ?? null)
      : (response?.results ?? []);
    const status = response?.status || 'OK';
    const delayMs = Number.isFinite(response?.delayMs) ? response.delayMs : 0;

    if (delayMs > 0) {
      setTimeout(() => callback(payload, status), delayMs);
      return;
    }

    callback(payload, status);
  }

  function resolveRegistryResponse(methodName, request, fallbackKind) {
    const registry = getStubRegistry();
    const handler = registry[methodName];
    if (typeof handler === 'function') {
      return handler(request);
    }

    const fallback = registry[fallbackKind];
    if (typeof fallback === 'function') {
      return fallback(request);
    }

    return null;
  }

  class StubMap {
    constructor(el, options = {}) {
      this.el = el;
      this.options = options;
      this.center = options.center || { lat: 0, lng: 0 };
      this.zoom = options.zoom || 14;
      this.mapTypeId = options.mapTypeId || 'roadmap';
      this._listeners = createListeners();
      this._bounds = {
        contains: () => true,
      };
      if (el) {
        el.dataset.googleMapStub = '1';
      }
    }

    setMapTypeId(mapTypeId) {
      this.mapTypeId = mapTypeId;
    }

    setCenter(center) {
      this.center = center;
    }

    setZoom(zoom) {
      this.zoom = zoom;
    }

    getBounds() {
      return this._bounds;
    }

    addListener(event, handler) {
      return this._listeners.add(event, handler);
    }

    removeListener(event, handler) {
      this._listeners.emit(`remove:${event}`, handler);
    }
  }

  class StubMarker {
    constructor(options = {}) {
      this.options = options;
      this.map = options.map || null;
      this.position = options.position || null;
      this._listeners = createListeners();
    }

    setMap(map) {
      this.map = map;
    }

    addListener(event, handler) {
      return this._listeners.add(event, handler);
    }
  }

  class StubGeocoder {
    geocode(request, callback) {
      const location = request && request.location ? request.location : { lat: 22.3, lng: 114.17 };
      const formattedAddress = '香港';
      callback(
        [{
          formatted_address: formattedAddress,
          geometry: {
            location: {
              lat: () => location.lat,
              lng: () => location.lng,
              toUrlValue: () => `${location.lat},${location.lng}`,
            },
          },
        }],
        'OK'
      );
    }
  }

  class StubPlacesService {
    constructor() {}

    nearbySearch(request, callback) {
      const response = resolveRegistryResponse('nearbySearch', request, 'search');
      if (response) {
        deliverStubResponse(callback, response, 'results');
        return;
      }
      callback([], 'ZERO_RESULTS');
    }

    textSearch(request, callback) {
      const response = resolveRegistryResponse('textSearch', request, 'search');
      if (response) {
        deliverStubResponse(callback, response, 'results');
        return;
      }
      callback([], 'ZERO_RESULTS');
    }

    getDetails(request, callback) {
      const response = resolveRegistryResponse('getDetails', request, 'details');
      if (response) {
        deliverStubResponse(callback, response, 'details');
        return;
      }
      callback(null, 'ZERO_RESULTS');
    }
  }

  class StubAutocomplete {
    constructor(input) {
      this.input = input;
      this._listeners = createListeners();
    }

    addListener(event, handler) {
      return this._listeners.add(event, handler);
    }

    getPlace() {
      const value = this.input && this.input.value ? this.input.value : '';
      return {
        place_id: `stub_${Date.now()}`,
        name: value || '目前位置',
        formatted_address: value || '香港',
        geometry: {
          location: {
            lat: () => 22.3,
            lng: () => 114.17,
            toString: () => '22.3,114.17',
          },
        },
      };
    }
  }

  window.google = {
    maps: {
      MapTypeId: {
        ROADMAP: 'roadmap',
        SATELLITE: 'satellite',
        TERRAIN: 'terrain',
        HYBRID: 'hybrid',
      },
      SymbolPath: {
        CIRCLE: 'CIRCLE',
      },
      event: {
        trigger(target, eventName) {
          if (target && typeof target._listeners?.emit === 'function') {
            target._listeners.emit(eventName, {});
          }
        },
      },
      Map: StubMap,
      Marker: StubMarker,
      Geocoder: StubGeocoder,
      places: {
        PlacesService: StubPlacesService,
        Autocomplete: StubAutocomplete,
      },
    },
  };
})();
