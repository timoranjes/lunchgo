# LunchGo 搵食

H5 mobile web app for finding lunch spots in Hong Kong. Uses Google Maps + Places API for real-time restaurant discovery, with a Python data pipeline that merges FEHD government licences and OpenStreetMap data.

**Live demo:** [timoranjes.github.io/lunchgo](https://timoranjes.github.io/lunchgo)

## Architecture

```
lunchgo/
├── index.html              # HTML shell + Google Maps script tag (179 lines)
├── src/
│   ├── app.js              # Entry point: initialization, event wiring, Google Maps setup
│   ├── state.js            # Reactive state with Proxy-based change notifications
│   ├── store.js            # localStorage wrapper (lg_ prefix, quota-safe)
│   ├── api.js              # Google Places API wrappers with retry + error classification
│   ├── render.js           # All DOM rendering: lists, cards, maps, skeletons, lazy loading
│   ├── utils.js            # Pure functions: haversine, formatting, cuisine matching
│   ├── styles.css          # WeChat-style mobile-first CSS (CSS vars, ~460 lines)
│   └── types.js            # JSDoc type definitions
├── scripts/
│   ├── enrich_data.py      # Current pipeline: FEHD XML + Overpass API → district JSON
│   └── update_restaurants.py  # Legacy: district-by-district Overpass fetch (deprecated)
├── data/                   # District-chunked JSON (18 files + index)
├── tests/
│   ├── *.spec.js           # Playwright E2E tests (8 specs)
│   └── test_*.py           # pytest unit tests (41 tests, 90% coverage)
├── .github/workflows/
│   └── update-restaurants.yml  # Daily cron + PR test gate
├── package.json            # npm scripts for Playwright
├── requirements.txt        # Python runtime deps (requests)
└── requirements-test.txt   # Python test deps (pytest, coverage)
```

### Module Responsibilities

| Module | Role | Key Exports |
|--------|------|-------------|
| `app.js` | Bootstrap, event wiring, Google Maps init | `init()`, `DEFAULT_LOCATIONS` |
| `state.js` | Reactive state via Proxy | `state`, `subscribe()`, `reset()` |
| `store.js` | localStorage CRUD with `lg_` prefix | `Store` (default export) |
| `api.js` | Places API with retry + error classification | `loadPlacesData()`, `fetchPlaceDetails()`, `withRetry()` |
| `render.js` | All DOM updates, skeleton screens, lazy loading | `updateDisplay()`, `showDetail()`, `renderSkeletonCards()` |
| `utils.js` | Pure utility functions | `haversine()`, `matchCuisine()`, `escHtml()` |

### Data Flow

```
User opens app
  → app.js:init() loads location from Store
  → Google Maps + PlacesService initialized
  → api.js:loadPlacesData() fetches nearby restaurants (with retry)
  → state.placesData updated
  → render.js:updateDisplay() filters, sorts, renders
  → render.js:renderList() batches DOM via DocumentFragment
  → IntersectionObserver enables infinite scroll for >50 results
```

## Development

### Prerequisites

- Node.js 18+ (for Playwright)
- Python 3.11+ (for data pipeline + pytest)
- Google Maps API key (with Places API enabled)

### Setup

```bash
# Install JS dependencies
npm install

# Install Playwright browsers
npx playwright install --with-deps chromium

# Install Python dependencies
pip install -r requirements.txt -r requirements-test.txt
```

### Google Maps API Key

API key is already configured in `index.html` and `src/app.js`. If you need to rotate it, update both files.

### Run Locally

ES modules require an HTTP server (not `file://`):

```bash
# Python
python -m http.server 8080

# Node
npx serve .

# Then open http://localhost:8080
```

### Testing

```bash
# Playwright E2E tests
npm test

# Playwright UI mode
npm run test:ui

# pytest unit tests
python -m pytest tests/ -v

# With coverage
python -m pytest tests/ -v --cov=scripts --cov-report=html
```

### Data Pipeline

```bash
# Run enrichment (FEHD + OSM merge)
python scripts/enrich_data.py

# Verbose output
python scripts/enrich_data.py -v
```

Outputs district-chunked JSON to `data/` and `data/district_index.json`.

## Deployment

- **Static hosting only** — no build step, no bundler
- **Must serve over HTTP** — ES modules (`type="module"`) don't work with `file://`
- **CORS** — Google Maps API handles its own CORS; no server config needed
- **Recommended:** GitHub Pages, Vercel, Netlify, or any static host

### GitHub Pages

Push to `main` branch, enable GitHub Pages in repo settings. The workflow automatically updates data daily.

## CI/CD

The GitHub Actions workflow (`.github/workflows/update-restaurants.yml`):

- **Daily cron** (2 AM UTC / 10 AM HKT): Runs `enrich_data.py`, commits data changes
- **PR gate**: Runs pytest + Playwright E2E tests on pull requests
- **Caching**: Python pip and npm dependencies cached between runs
- **Artifact upload**: Playwright reports uploaded on test failure

## Conventions

- **No build step** — edit files directly, deploy static
- **Single-file HTML** — `index.html` is the shell; JS is modular via ES modules
- **CSS variables** — theming via `:root` vars (brand: `#07C160`)
- **localStorage keys** — always prefixed `lg_`
- **Python scripts** — stdlib + `requests` only; no virtualenv required
- **UI language** — Traditional Chinese (zh-TW/zh-HK)

## License

MIT
