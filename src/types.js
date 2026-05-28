/**
 * LunchGo Type Definitions
 *
 * JSDoc typedefs for all data shapes used across the app.
 * TypeScript reads these comments for type checking via `tsc --noEmit`.
 * No runtime code here. This file exists purely for documentation
 * and static analysis.
 *
 * @module types
 */

// ---------------------------------------------------------------------------
// Google Places API types
// ---------------------------------------------------------------------------

/**
 * Geometry object returned by Google Places API.
 *
 * @typedef {Object} PlacesGeometry
 * @property {Object} location - LatLng object with .lat() and .lng() methods
 * @property {function(): number} location.lat - Returns latitude
 * @property {function(): number} location.lng - Returns longitude
 */

/**
 * Photo object from Google Places API.
 *
 * @typedef {Object} PlacesPhoto
 * @property {string} photo_reference - Reference string for fetching the image
 * @property {function(Object): string} getUrl - Returns photo URL given { maxWidth, maxHeight }
 * @property {number} width - Original image width
 * @property {number} height - Original image height
 */

/**
 * Opening hours from Google Places Details.
 *
 * @typedef {Object} PlacesOpeningHours
 * @property {boolean} open_now - Whether the place is currently open
 * @property {Array<{open: Object, close: Object}>} periods - Weekly opening periods
 * @property {string[]} weekday_text - Human-readable hours per day
 */

/**
 * Raw result from Google Places nearbySearch.
 *
 * @typedef {Object} PlacesResult
 * @property {string} place_id - Google Places unique ID
 * @property {string} name - Place name
 * @property {PlacesGeometry} geometry - Location geometry
 * @property {string} [vicinity] - Approximate address
 * @property {number} [rating] - 0-5 rating
 * @property {number} [user_ratings_total] - Number of reviews
 * @property {number} [price_level] - 0-4 price level
 * @property {string[]} [types] - Google Places type tags
 * @property {PlacesPhoto[]} [photos] - Photo objects
 */

/**
 * Response from Google Places getDetails.
 *
 * @typedef {Object} PlacesDetails
 * @property {PlacesPhoto[]} [photos] - Photo objects
 * @property {string} [formatted_address] - Full address string
 * @property {PlacesOpeningHours} [opening_hours] - Opening hours info
 * @property {string} [formatted_phone_number] - Phone number
 * @property {string} [website] - Website URL
 * @property {number} [price_level] - 0-4 price level
 */

// ---------------------------------------------------------------------------
// Core domain types
// ---------------------------------------------------------------------------

/**
 * Restaurant object used throughout the app.
 *
 * Built from Google Places API results (loadPlacesData) and
 * enriched by the Python data pipeline (district_*.json).
 * Fields vary by source: Places-sourced records have all fields,
 * FEHD/OSM-sourced records may lack rating, photos, etc.
 *
 * @typedef {Object} Restaurant
 * @property {string} id - Unique ID ('place_<place_id>' or 'fehd_<id>' or 'osm_<id>')
 * @property {string} name - Primary name (Traditional Chinese or English)
 * @property {string} [name_en] - English name, may equal name
 * @property {number|string} lat - Latitude (number from Places, string from JSON)
 * @property {number|string} lng - Longitude (number from Places, string from JSON)
 * @property {string} [address] - Full or partial address
 * @property {number} [rating] - 0-5 rating, 0 or undefined if unrated
 * @property {number} [user_ratings_total] - Review count
 * @property {number} [price_level] - 0-4 price level
 * @property {string[]} [types] - Google Places type tags
 * @property {string} [cuisine] - Comma-separated cuisine categories
 * @property {string[]} [photos] - Photo URLs (max 5)
 * @property {string[]} [photo_refs] - Google photo_reference strings
 * @property {string} [place_id] - Google Places place_id
 * @property {string} [source] - Data source: 'places' | 'fehd' | 'osm'
 * @property {string} [amenity] - OSM amenity tag (e.g., 'restaurant', 'cafe', 'fast_food')
 * @property {string} [district] - English district name
 * @property {string} [district_tc] - Traditional Chinese district name
 * @property {string} [licence_type] - FEHD licence type
 * @property {string} [expiry] - FEHD licence expiry date (YYYY-MM-DD)
 * @property {string[]} [endorsements] - FEHD licence endorsements
 * @property {Object} [opening_hours] - Google Places opening_hours object
 * @property {string} [phone] - Phone number from Places Details
 * @property {string} [website] - Website URL from Places Details
 * @property {number} [distance] - Computed distance in meters from current location
 */

/**
 * Default location shipped with the app.
 *
 * @typedef {Object} DefaultLocation
 * @property {string} id - Slug identifier (e.g., 'central', 'causeway_bay')
 * @property {string} label - Display label in Traditional Chinese
 * @property {number} lat - Latitude
 * @property {number} lng - Longitude
 * @property {true} [isDefault] - Always true for default locations
 * @property {false} [isCustom] - Always false or undefined
 */

/**
 * User-created custom location saved to localStorage.
 *
 * @typedef {Object} CustomLocation
 * @property {string} id - Unique identifier (generated via crypto.randomUUID or Date.now)
 * @property {number} lat - Latitude
 * @property {number} lng - Longitude
 * @property {string} label - User-provided display label
 * @property {false} [isDefault] - Always false or undefined
 * @property {true} [isCustom] - Always true for custom locations
 */

/**
 * Union type for any location object.
 *
 * @typedef {DefaultLocation|CustomLocation} Location
 */

/**
 * Cuisine filter option.
 *
 * @typedef {Object} CuisineOption
 * @property {string} id - Cuisine identifier (e.g., 'chinese', 'noodle', 'all')
 * @property {string} label - Display label in Traditional Chinese
 */

// ---------------------------------------------------------------------------
// App state types
// ---------------------------------------------------------------------------

/**
 * Reactive application state.
 *
 * Wrapped in a Proxy that fires notifications on mutations.
 * See src/state.js for the subscribe/reset API.
 *
 * @typedef {Object} LunchGoState
 * @property {Restaurant[]} placesData - All loaded restaurant data
 * @property {Restaurant[]} filtered - Filtered subset after search/cuisine/sort
 * @property {Location|null} currentLocation - Selected location
 * @property {string} currentLocationLabel - Human-readable location label
 * @property {'distance'|'rating'|'name'|'district'} currentSort - Active sort key
 * @property {string} searchQuery - Current text search input
 * @property {'list'|'map'} currentView - Active view mode
 * @property {string} activeCuisine - Selected cuisine filter ID, 'all' for none
 * @property {string} activePrice - Selected price filter ID, 'all' for none
 * @property {Object|null} map - Google Maps instance
 * @property {Object[]} markers - Google Maps Marker instances
 * @property {Object|null} placesService - Google PlacesService instance
 * @property {boolean} placesLoaded - Whether Places data has been fetched
 * @property {Object|null} geocoder - Google Maps Geocoder instance
 * @property {Object|null} autocomplete - Google Maps Autocomplete instance
 * @property {Restaurant|null} randomPickResult - Result of random picker
 * @property {boolean} discoveryVisible - Whether discovery section is shown
 * @property {number} loadMoreIndex - Pagination: next batch start index
 * @property {number} loadMoreStep - Pagination: batch size (default 50)
 * @property {string[]} loadingErrors - Error messages from data loading
 */

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

/**
 * localStorage wrapper methods.
 * All keys are prefixed with 'lg_'.
 *
 * @typedef {Object} Store
 * @property {function(string, *): *} get - Get value by key with optional default
 * @property {function(string, *): void} set - Set value by key
 * @property {function(): (Location|null)} getLocation - Get current selected location
 * @property {function(Location|null): void} setLocation - Set current location
 * @property {function(): string[]} getFavorites - Get favorite restaurant IDs
 * @property {function(string): boolean} toggleFav - Toggle favorite, returns true if added
 * @property {function(string): boolean} isFav - Check if ID is favorited
 * @property {function(): CustomLocation[]} getCustomLocations - Get user-defined locations
 * @property {function(CustomLocation): CustomLocation[]} addCustomLocation - Add location
 * @property {function(string): CustomLocation[]} removeCustomLocation - Remove by ID
 */

// ---------------------------------------------------------------------------
// Data pipeline types
// ---------------------------------------------------------------------------

/**
 * Aggregate statistics included in the district index manifest.
 *
 * @typedef {Object} DistrictIndexStats
 * @property {number} [with_cuisine] - Count of rows with cuisine data
 * @property {number} [with_phone] - Count of rows with phone data
 * @property {number} [with_hours] - Count of rows with opening hours data
 * @property {Object.<string, number>} [location_status] - Breakdown by location status
 */

/**
 * District index manifest structure.
 *
 * @typedef {Object} DistrictIndex
 * @property {number} v - Schema version (currently 2)
 * @property {number} total - Total restaurant count across all districts
 * @property {Object.<string, DistrictEntry>} districts - Map of district name to entry
 * @property {DistrictIndexStats} [stats] - Optional aggregate stats
 */

/**
 * Single district entry in the index.
 *
 * @typedef {Object} DistrictEntry
 * @property {string} file - Relative path to district JSON file
 * @property {string} url - URL path for lazy loading
 * @property {number} count - Number of restaurants in this district
 */

/**
 * Compact array row from district_*.json files.
 *
 * Fields are positional, not named. The fields array in the JSON
 * header defines the mapping.
 *
 * Position 0:  id (string)
 * Position 1:  name (string)
 * Position 2:  name_en (string)
 * Position 3:  lat (number)
 * Position 4:  lng (number)
 * Position 5:  address (string)
 * Position 6:  district (string)
 * Position 7:  district_tc (string)
 * Position 8:  licence_type (string)
 * Position 9:  expiry (string, YYYY-MM-DD)
 * Position 10: cuisine (string)
 * Position 11: phone (string)
 * Position 12: website (string)
 * Position 13: opening_hours (string)
 * Position 14: amenity (string)
 * Position 15: source (string)
 * Position 16: location_status (string)
 *
 * @typedef {Array<string|number|null>} DistrictRow
 */

/**
 * Parsed district data file.
 *
 * @typedef {Object} DistrictData
 * @property {number} v - Schema version
 * @property {string} district - District name
 * @property {number} count - Restaurant count
 * @property {string[]} fields - Field names for row positions
 * @property {DistrictRow[]} rows - Compact array rows
 */

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

/**
 * Sort configuration for restaurant lists.
 *
 * @typedef {Object} SortConfig
 * @property {string} key - Sort key: 'distance' | 'rating' | 'name'
 * @property {string} label - Display label
 * @property {function(Restaurant, Restaurant): number} fn - Comparator function
 */

/**
 * Google Maps API configuration.
 *
 * @typedef {Object} MapsConfig
 * @property {string} apiKey - Google Maps API key
 * @property {string[]} libraries - Required libraries: ['places', 'marker']
 */

// This file exports nothing at runtime.
// It exists solely for JSDoc type definitions consumed by TypeScript.
export {};
