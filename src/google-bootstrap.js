(function () {
  const host = location.hostname;
  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1';

  const apiSrc =
    'https://maps.googleapis.com/maps/api/js?key=AIzaSyBN_pMA5dYGC70sS4OnoYALDszrTUUpjkM&libraries=places&language=zh-TW&region=HK';

  if (!isLocal) {
    document.write('<script src="' + apiSrc + '"><\\/script>');
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
      callback([], 'ZERO_RESULTS');
    }

    getDetails(request, callback) {
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
