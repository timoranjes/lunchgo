# LunchGo Comprehensive Refactoring Plan

## TL;DR

> **Quick Summary**: Modernize LunchGo from single-file vanilla JS SPA to modular ES6+ architecture with proper error handling, performance optimizations, and full test coverage while preserving all existing functionality and user data.
> 
> **Deliverables**: 
> - Modularized frontend codebase (8+ files)
> - Playwright E2E test suite (5+ tests)
> - Pytest unit test suite for Python pipeline (10+ tests)  
> - Updated CI/CD workflow using correct data pipeline
> - Performance-optimized Google Places integration
> - Proper error handling for API failures
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Project setup → Core modules → Integration → Testing → Verification

---

## Context

### Original Request
User wants comprehensive refactoring of LunchGo project including:
- Breaking single-file architectural constraint  
- Fixing performance issues (web hanging on load)
- Setting up full test infrastructure
- Including Python data pipeline scripts
- Modernizing to safe ES6+ features only

### Interview Summary
**Key Discussions**:
- Confirmed breaking single-file constraint is acceptable
- Will keep Google Places API (not switch to local JSON)
- Safe ES6+ features only: modules, async/await, optional chaining
- Delete legacy `update_restaurants.py` script
- Add minimal Node.js infrastructure for Playwright tests

**Research Findings**:
- Zero test infrastructure currently exists
- High coupling: 93 DOM element IDs, 84 state references
- Performance bottlenecks likely in Google Maps API loading and DOM rendering
- Legacy Python script still used in CI despite being deprecated
- Compact array format in Python is field-order dependent

### Metis Review
**Identified Gaps** (addressed):
- Clarified Google Maps API key handling (assume configured, add error handling)
- Confirmed Google Places API retention vs local JSON
- Defined safe ES6+ scope (modules + async/await + optional chaining)
- Decided to delete legacy Python script
- Approved minimal Node infrastructure for testing

---

## Work Objectives

### Core Objective
Transform LunchGo from a monolithic single-file application into a modular, testable, performant codebase while maintaining 100% behavioral compatibility and preserving all user data.

### Concrete Deliverables
- `src/` directory with modular JavaScript files
- `package.json` with Playwright test dependencies  
- `tests/` directory with Playwright E2E tests
- Modernized `scripts/enrich_data.py` with type hints and proper error handling
- `scripts/test_enrich_data.py` with pytest unit tests
- Updated `.github/workflows/update-restaurants.yml` using correct script
- All existing functionality preserved (search, filter, favorites, map view, random pick, etc.)

### Definition of Done
- [ ] All Playwright E2E tests pass (`npx playwright test`)
- [ ] All pytest unit tests pass (`python -m pytest scripts/`)
- [ ] Page loads within 2 seconds on 3G throttling
- [ ] All localStorage keys (`lg_*`) maintain compatibility
- [ ] GitHub Actions workflow runs successfully with new script
- [ ] No visual regression in WeChat-style UI

### Must Have
- Preserve all existing user-facing functionality
- Maintain localStorage key compatibility (`lg_loc`, `lg_favs`, `lg_custom_locs`)
- Keep Google Places API integration behavior identical
- Add proper error handling for Google Maps API failures
- Implement performance optimizations for large result sets
- Include comprehensive test coverage
- Update CI/CD to use correct data pipeline script

### Must NOT Have (Guardrails)
- Do NOT switch from Google Places API to local JSON data loading
- Do NOT add React/Vue/Svelte or any frontend frameworks
- Do NOT change visual design (WeChat-style UI with #07C160 brand)
- Do NOT break mobile-first viewport settings (`maximum-scale=1.0, user-scalable=no`)
- Do NOT introduce build tooling beyond minimal Node setup for tests
- Do NOT modify compact array format field order in Python output

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.
> Acceptance criteria requiring "user manually tests/confirms" are FORBIDDEN.

### Test Decision
- **Infrastructure exists**: NO (will be created as part of this work)
- **Automated tests**: Tests-after (Playwright E2E + pytest unit tests)
- **Framework**: Playwright (frontend), pytest (Python)
- **If TDD**: Not applicable - using tests-after approach

### QA Policy
Every task MUST include agent-executed QA scenarios (see TODO template below).
Evidence saved to `.omo/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright (playwright skill) - Navigate, interact, assert DOM, screenshot
- **TUI/CLI**: Use interactive_bash (tmux) - Run command, send keystrokes, validate output  
- **API/Backend**: Use Bash (curl) - Send requests, assert status + response fields
- **Library/Module**: Use Bash (node/python REPL) - Import, call functions, compare output

---

## Execution Strategy

### Parallel Execution Waves

> Maximize throughput by grouping independent tasks into parallel waves.
> Each wave completes before the next begins.
> Target: 5-8 tasks per wave. Fewer than 3 per wave (except final) = under-splitting.

```
Wave 1 (Start Immediately - foundation + config):
├── Task 1: Project scaffolding + package.json [quick]
├── Task 2: CSS extraction + HTML cleanup [quick]  
├── Task 3: State management module [quick]
├── Task 4: Store (localStorage) module [quick]
├── Task 5: Utility functions module [quick]
├── Task 6: Type definitions + JSDoc [quick]
└── Task 7: Python test infrastructure [quick]

Wave 2 (After Wave 1 - core modules, MAX PARALLEL):
├── Task 8: Google Places API service module [deep]
├── Task 9: Rendering engine module [visual-engineering]
├── Task 10: Map integration module [deep]
├── Task 11: Detail view module [visual-engineering]
├── Task 12: Random picker module [quick]
├── Task 13: Location management module [quick]
├── Task 14: Event system module [quick]
└── Task 15: Python data pipeline modernization [deep]

Wave 3 (After Wave 2 - integration + testing):
├── Task 16: Main app entry point + module integration [deep]
├── Task 17: Playwright E2E test suite [unspecified-high]
├── Task 18: Pytest unit test suite [unspecified-high]
├── Task 19: Performance optimization implementation [deep]
├── Task 20: Error handling implementation [quick]
├── Task 21: CI/CD workflow update [quick]
└── Task 22: Documentation updates [writing]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 → Task 8 → Task 16 → Task 17 → F1-F4 → user okay
Parallel Speedup: ~70% faster than sequential
Max Concurrent: 8 (Waves 1 & 2)
```

### Dependency Matrix (abbreviated - show ALL tasks in your generated plan)

- **1-7**: - - 8-15, 1
- **8**: 1, 3, 4, 5 - 16, 17, 2
- **9**: 1, 3, 5, 6 - 16, 17, 2  
- **10**: 1, 3, 8 - 16, 17, 2
- **11**: 1, 3, 8 - 16, 17, 2
- **12**: 1, 3, 4 - 16, 17, 2
- **13**: 1, 3, 4 - 16, 17, 2
- **14**: 1 - 16, 17, 2
- **15**: 7 - 21, 3
- **16**: 1-14 - 17-22, 3
- **17**: 16 - 4
- **18**: 15 - 4
- **19**: 16 - 4
- **20**: 16 - 4
- **21**: 15 - 4
- **22**: 16 - 4

### Agent Dispatch Summary

- **1**: **7** - T1-T7 → `quick`
- **2**: **8** - T8 → `deep`, T9 → `visual-engineering`, T10 → `deep`, T11 → `visual-engineering`, T12-T14 → `quick`, T15 → `deep`
- **3**: **7** - T16 → `deep`, T17 → `unspecified-high`, T18 → `unspecified-high`, T19 → `deep`, T20-T22 → `quick`
- **4**: **4** - F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: Recommended Agent Profile + Parallelization info + QA Scenarios.
> **A task WITHOUT QA Scenarios is INCOMPLETE. No exceptions.**
> **FORMAT**: Task labels MUST use bare numbers: `1.`, `2.`, `3.` — NOT `T1.`, `Task 1.`, `Phase 1:`.
> The /start-work progress counter requires exact format. Deviation = progress shows 0/0.
> Final Verification Wave labels MUST use `F1.`, `F2.`, etc. — NOT `T-F1.`, `F-1.`, `Final 1.`.

- [x] 1. Project scaffolding + package.json

  **What to do**:
  - Create `src/` directory structure
  - Create `package.json` with Playwright dependencies
  - Set up basic Playwright configuration
  - Create `.gitignore` entries for node_modules and test artifacts
  - Initialize npm project with minimal dependencies

  **Must NOT do**:
  - Do NOT add unnecessary dependencies beyond Playwright testing
  - Do NOT create build tooling or bundler configuration
  - Do NOT modify existing HTML structure yet

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `quick`
    - Reason: Simple file creation and npm setup tasks
  - **Skills**: [`git-master`]
    - `git-master`: For proper gitignore entries and commit management

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2-7)
  - **Blocks**: Tasks 8-15, 17
  - **Blocked By**: None (can start immediately)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - None - this is new infrastructure

  **External References** (libraries and frameworks):
  - Playwright official docs: https://playwright.dev/docs/intro

  **WHY Each Reference Matters**:
  - Playwright docs provide the correct way to set up E2E testing for vanilla JS SPAs

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: Package.json created with Playwright dependencies
    Tool: Bash
    Preconditions: Clean project state
    Steps:
      1. cat package.json
      2. Verify contains "devDependencies" with "@playwright/test"
      3. Verify contains "scripts" with "test" pointing to playwright
    Expected Result: package.json exists with correct Playwright setup
    Failure Indicators: Missing dependencies, incorrect script commands
    Evidence: .omo/evidence/task-1-package-json.txt

  Scenario: Playwright config file created
    Tool: Bash  
    Preconditions: package.json exists
    Steps:
      1. npx playwright install
      2. Check if playwright.config.js exists
      3. Verify config includes proper browser settings for mobile testing
    Expected Result: Playwright installed and configured for mobile viewport testing
    Evidence: .omo/evidence/task-1-playwright-config.txt
  ```

  **Acceptance Criteria**:
  - [ ] package.json created with @playwright/test dev dependency
  - [ ] playwright.config.js configured for mobile viewport testing  
  - [ ] .gitignore updated with node_modules and test artifacts
  - [ ] npm install runs successfully without errors

  **Evidence to Capture**:
  - [ ] package.json content
  - [ ] Playwright configuration
  - [ ] Git ignore entries

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): add project scaffolding and test infrastructure`
  - Files: `package.json`, `playwright.config.js`, `.gitignore`
  - Pre-commit: `npm install`

- [x] 2. CSS extraction + HTML cleanup

  **What to do**:
  - Extract all CSS from `<style>` tag in index.html to separate `src/styles.css`
  - Clean up HTML structure in index.html (remove inline styles, organize sections)
  - Preserve all CSS variables and WeChat-style UI (`#07C160` brand)
  - Maintain mobile-first viewport settings and safe area insets
  - Update HTML to reference external CSS file

  **Must NOT do**:
  - Do NOT change any visual design or styling
  - Do NOT modify CSS variable values or structure
  - Do NOT remove mobile-first viewport meta tags

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `visual-engineering`
    - Reason: CSS extraction and visual preservation requires frontend expertise
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: For maintaining visual consistency during refactoring

  **Parallelization**:
  - **Can Run In Parallel**: YES  
  - **Parallel Group**: Wave 1 (with Tasks 1, 3-7)
  - **Blocks**: Tasks 9, 11, 16
  - **Blocked By**: None (can start immediately)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `index.html:7-469` - Current CSS styles and variables
  - `index.html:28-34` - Mobile-first viewport and safe area settings

  **WHY Each Reference Matters**:
  - Lines 7-469 contain all current styling that must be preserved exactly
  - Lines 28-34 contain critical mobile viewport settings that cannot be changed

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: CSS extracted to external file with identical styling
    Tool: Playwright
    Preconditions: Original index.html loaded
    Steps:
      1. Capture screenshot of original page
      2. Load refactored page with external CSS
      3. Capture screenshot of refactored page  
      4. Compare screenshots pixel-by-pixel
    Expected Result: Visual appearance identical between original and refactored
    Failure Indicators: Any visual differences in layout, colors, or spacing
    Evidence: .omo/evidence/task-2-css-comparison.png

  Scenario: Mobile viewport settings preserved
    Tool: Playwright
    Preconditions: Refactored page loaded
    Steps:
      1. Get viewport meta tag content
      2. Verify contains "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
      3. Verify body has "padding-bottom: env(safe-area-inset-bottom, 0)"
    Expected Result: Mobile viewport and safe area settings identical to original
    Evidence: .omo/evidence/task-2-viewport-settings.txt
  ```

  **Acceptance Criteria**:
  - [ ] src/styles.css contains all original CSS from index.html
  - [ ] index.html references external CSS file correctly
  - [ ] All CSS variables preserved with identical values
  - [ ] Mobile viewport meta tags unchanged
  - [ ] Visual appearance identical to original

  **Evidence to Capture**:
  - [ ] Before/after screenshots
  - [ ] CSS file content
  - [ ] HTML meta tag verification

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): extract CSS to external file`
  - Files: `src/styles.css`, `index.html`
  - Pre-commit: Visual regression check

- [x] 3. State management module

  **What to do**:
  - Extract `state` object from index.html to `src/state.js`
  - Create proper state management functions (getters/setters)
  - Implement state change notifications/event system
  - Preserve all existing state properties and structure
  - Add JSDoc documentation for state properties

  **Must NOT do**:
  - Do NOT change state property names or structure
  - Do NOT break existing state mutation patterns initially
  - Do NOT introduce complex state management libraries

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `deep`
    - Reason: State management is core architecture requiring careful design
  - **Skills**: []
    - No specific skills needed - pure JavaScript architecture

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-2, 4-7)  
  - **Blocks**: Tasks 8-16
  - **Blocked By**: None (can start immediately)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `index.html:672-697` - Current state object structure and properties
  - `index.html:936-970` - How state is currently used for filtering and sorting

  **WHY Each Reference Matters**:
  - Lines 672-697 define the exact state structure that must be preserved
  - Lines 936-970 show how state properties are consumed throughout the app

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: State module exports identical structure
    Tool: Bash
    Preconditions: src/state.js created
    Steps:
      1. node -e "import { state } from './src/state.js'; console.log(JSON.stringify(state))"
      2. Compare output with original state structure from index.html
      3. Verify all 15+ properties exist with same default values
    Expected Result: State module exports identical structure to original
    Failure Indicators: Missing properties, different default values, structural changes
    Evidence: .omo/evidence/task-3-state-structure.txt

  Scenario: State change notifications work
    Tool: Bash
    Preconditions: State module with event system
    Steps:
      1. node -e "import { state, subscribe } from './src/state.js'; let called = false; subscribe(() => called = true); state.currentLocation = {lat: 1, lng: 1}; console.log(called)"
      2. Verify output is "true"
    Expected Result: State changes trigger subscription callbacks
    Evidence: .omo/evidence/task-3-state-notifications.txt
  ```

  **Evidence to Capture**:
  - [ ] State structure comparison
  - [ ] Event system functionality
  - [ ] Module export verification

  **Acceptance Criteria**:
  - [ ] src/state.js exports identical state structure to original
  - [ ] All 15+ state properties preserved with same default values
  - [ ] State change notifications work correctly
  - [ ] JSDoc documentation added for all properties

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): extract state management to module`
  - Files: `src/state.js`
  - Pre-commit: Structure validation test

- [x] 4. Store (localStorage) module

  **What to do**:
  - Extract `Store` object from index.html to `src/store.js`
  - Improve error handling (don't silently swallow localStorage quota errors)
  - Add proper return value handling (return copies instead of mutable references)
  - Preserve all existing localStorage key prefixes (`lg_`)
  - Add JSDoc documentation for all methods

  **Must NOT do**:
  - Do NOT change localStorage key names or serialization format
  - Do NOT break backward compatibility with existing user data
  - Do NOT remove silent error handling completely (maintain graceful degradation)

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `quick`
    - Reason: Straightforward module extraction with minor improvements
  - **Skills**: []
    - No specific skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-3, 5-7)
  - **Blocks**: Tasks 8, 11-13, 16
  - **Blocked By**: None (can start immediately)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `index.html:700-726` - Current Store implementation with silent error handling
  - `index.html:703, 704, 705, 714, 718, 722` - All Store method call sites

  **WHY Each Reference Matters**:
  - Lines 700-726 show the exact implementation that must maintain compatibility
  - Call site lines show how return values are used (arrays vs objects)

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: Store maintains localStorage key compatibility
    Tool: interactive_bash
    Preconditions: Browser localStorage empty
    Steps:
      1. Open browser dev tools
      2. Import store module and call Store.setLocation({id: 'test', lat: 1, lng: 1})
      3. Check localStorage.getItem('lg_loc') 
      4. Verify it matches original serialization format
    Expected Result: localStorage keys use same 'lg_' prefix and JSON format
    Failure Indicators: Different key names, different serialization format
    Evidence: .omo/evidence/task-4-store-compatibility.txt

  Scenario: Store returns array copies instead of mutable references
    Tool: Bash
    Preconditions: Store module created
    Steps:
      1. node -e "import { Store } from './src/store.js'; localStorage.setItem('lg_favs', JSON.stringify(['a', 'b'])); const favs1 = Store.getFavorites(); const favs2 = Store.getFavorites(); favs1.push('c'); console.log(favs2.includes('c'))"
      2. Verify output is "false"
    Expected Result: Multiple calls to getFavorites() return independent arrays
    Evidence: .omo/evidence/task-4-store-immutable.txt
  ```

  **Evidence to Capture**:
  - [ ] localStorage key format verification
  - [ ] Immutable return values test
  - [ ] Error handling improvement validation

  **Acceptance Criteria**:
  - [ ] src/store.js maintains identical localStorage key format (lg_ prefix)
  - [ ] Store methods return copies instead of mutable references
  - [ ] Improved error handling for localStorage quota errors
  - [ ] All existing Store method signatures preserved

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): extract store module with improved error handling`
  - Files: `src/store.js`
  - Pre-commit: Compatibility test

- [x] 5. Utility functions module

  **What to do**:
  - Extract utility functions from index.html to `src/utils.js`
  - Functions to extract: `haversine()`, `formatDist()`, `renderStars()`, `priceLevel()`, `escHtml()`, `escAttr()`, `matchCuisine()`
  - Add proper JSDoc documentation and type annotations
  - Improve `matchCuisine()` with better Chinese character handling
  - Make functions pure where possible (no side effects)

  **Must NOT do**:
  - Do NOT change function signatures or return values
  - Do NOT break existing cuisine matching logic
  - Do NOT modify distance calculation algorithm

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `quick`
    - Reason: Simple function extraction and documentation
  - **Skills**: []
    - No specific skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-4, 6-7)
  - **Blocks**: Tasks 8-16
  - **Blocked By**: None (can start immediately)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `index.html:728-761` - Utility functions haversine through escAttr
  - `index.html:762-806` - matchCuisine function with Chinese character logic
  - `index.html:959, 1164, 1176, 1417` - haversine call sites
  - `index.html:951` - matchCuisine call site

  **WHY Each Reference Matters**:
  - Function implementations must be extracted exactly as-is initially
  - Call sites show expected parameter types and return value usage

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: Utility functions produce identical results
    Tool: Bash
    Preconditions: src/utils.js created
    Steps:
      1. node -e "import { haversine, matchCuisine } from './src/utils.js'; console.log(haversine(22.2808, 114.1588, 22.2783, 114.1825)); console.log(matchCuisine({name: '譚仔米線', types: []}, 'mixian'))"
      2. Compare output with original function results
    Expected Result: Functions return identical values to original implementation
    Failure Indicators: Different distance calculations, cuisine matching failures
    Evidence: .omo/evidence/task-5-utils-identical.txt

  Scenario: matchCuisine handles Chinese characters correctly
    Tool: Bash
    Preconditions: Utils module with improved matchCuisine
    Steps:
      1. node -e "import { matchCuisine } from './src/utils.js'; const tests = [{name: '譚仔三哥', cuisine: 'mixian', expect: true}, {name: '大家樂', cuisine: 'fast_food', expect: true}, {name: '星巴克', cuisine: 'cafe', expect: true}]; tests.forEach(t => console.log(matchCuisine({name: t.name, types: []}, t.cuisine) === t.expect))"
      2. Verify all outputs are "true"
    Expected Result: Chinese character cuisine matching works for all test cases
    Evidence: .omo/evidence/task-5-cuisine-chinese.txt
  ```

  **Evidence to Capture**:
  - [ ] Function output comparison
  - [ ] Chinese character handling validation
  - [ ] Module import/export verification

  **Acceptance Criteria**:
  - [ ] src/utils.js contains all original utility functions
  - [ ] All function signatures and return values identical to original
  - [ ] matchCuisine() handles Chinese characters correctly
  - [ ] Functions are pure with no side effects where possible
  - [ ] JSDoc documentation added for all functions

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): extract utility functions to module`
  - Files: `src/utils.js`
  - Pre-commit: Function equivalence test

- [x] 6. Type definitions + JSDoc

  **What to do**:
  - Create `src/types.js` with JSDoc typedefs for key objects
  - Define types for: Restaurant, Location, State, Store methods
  - Add JSDoc comments to all exported functions and modules
  - Create tsconfig.json for type checking (optional, no build required)
  - Document Google Places API response structure

  **Must NOT do**:
  - Do NOT convert to TypeScript files (.ts)
  - Do NOT require TypeScript compilation for runtime
  - Do NOT add type checking to build process

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `writing`
    - Reason: Documentation and type definition writing
  - **Skills**: []
    - No specific skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-5, 7)
  - **Blocks**: Tasks 8-16 (for better IDE support)
  - **Blocked By**: None (can start immediately)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `index.html:822-839` - Restaurant object structure from Google Places
  - `index.html:664-670` - Location object structure
  - `index.html:672-697` - State object structure

  **WHY Each Reference Matters**:
  - These lines define the exact object structures that need type documentation
  - Type definitions must match actual runtime object shapes

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: JSDoc types match actual object structures
    Tool: Bash
    Preconditions: src/types.js and tsconfig.json created
    Steps:
      1. node -e "import { state } from './src/state.js'; import { /** @type {import('./types.js').Restaurant} */ r } from './src/state.js'; console.log('Types defined')"
      2. Verify no TypeScript compilation errors
    Expected Result: JSDoc types are valid and match actual structures
    Failure Indicators: TypeScript compilation errors, mismatched properties
    Evidence: .omo/evidence/task-6-jsdoc-types.txt

  Scenario: All modules have proper JSDoc documentation
    Tool: Bash
    Preconditions: All src/ modules created
    Steps:
      1. grep -r "/\*\*" src/ | wc -l
      2. Verify count >= number of exported functions + types
    Expected Result: Every exported function and type has JSDoc documentation
    Evidence: .omo/evidence/task-6-jsdoc-coverage.txt
  ```

  **Evidence to Capture**:
  - [ ] Type definition validation
  - [ ] JSDoc coverage verification
  - [ ] IDE autocomplete functionality

  **Acceptance Criteria**:
  - [ ] src/types.js contains JSDoc typedefs for all key objects
  - [ ] All exported functions have proper JSDoc documentation
  - [ ] tsconfig.json enables type checking without build requirements
  - [ ] Type definitions match actual runtime object structures

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): add type definitions and JSDoc documentation`
  - Files: `src/types.js`, `tsconfig.json`, all src/*.js files
  - Pre-commit: JSDoc validation

- [x] 7. Python test infrastructure

  **What to do**:
  - Create `requirements-test.txt` with pytest and test dependencies
  - Set up pytest configuration (`pytest.ini` or `pyproject.toml`)
  - Create `scripts/test_enrich_data.py` placeholder file
  - Add test runner script and CI test command
  - Configure Python path for module imports

  **Must NOT do**:
  - Do NOT modify existing `enrich_data.py` logic yet
  - Do NOT add heavy dependencies like pandas
  - Do NOT change Python version requirements

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `quick`
    - Reason: Simple test infrastructure setup
  - **Skills**: []
    - No specific skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-6)
  - **Blocks**: Task 15, 18
  - **Blocked By**: None (can start immediately)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `scripts/enrich_data.py` - Current Python script structure
  - `.github/workflows/update-restaurants.yml` - Current CI workflow

  **WHY Each Reference Matters**:
  - Need to understand current script structure to write appropriate tests
  - CI workflow shows current Python version (3.11) and dependencies

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: Pytest infrastructure runs successfully
    Tool: interactive_bash
    Preconditions: requirements-test.txt and test files created
    Steps:
      1. pip install -r requirements-test.txt
      2. python -m pytest scripts/test_enrich_data.py -v
      3. Verify pytest runs without import errors
    Expected Result: Pytest executes successfully with zero tests (placeholder)
    Failure Indicators: Import errors, pytest configuration issues
    Evidence: .omo/evidence/task-7-pytest-setup.txt

  Scenario: Requirements files don't conflict with CI
    Tool: Bash
    Preconditions: requirements-test.txt created
    Steps:
      1. Check if requirements-test.txt conflicts with CI dependencies
      2. Verify pytest can be installed alongside requests
    Expected Result: Test dependencies compatible with existing CI setup
    Evidence: .omo/evidence/task-7-requirements-compatibility.txt
  ```

  **Evidence to Capture**:
  - [ ] Pytest execution output
  - [ ] Dependency compatibility verification
  - [ ] Test file structure

  **Acceptance Criteria**:
  - [ ] requirements-test.txt contains pytest and test dependencies
  - [ ] pytest.ini or pyproject.toml properly configured
  - [ ] scripts/test_enrich_data.py placeholder created
  - [ ] python -m pytest runs successfully with zero tests
  - [ ] Test dependencies compatible with existing CI setup

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): add Python test infrastructure`
  - Files: `requirements-test.txt`, `pytest.ini`, `scripts/test_enrich_data.py`
  - Pre-commit: Pytest dry run

- [x] 8. Google Places API service module

  **What to do**:
  - Extract Google Maps/Places integration from index.html to `src/api.js`
  - Create proper service class with methods: `loadPlacesData()`, `fetchPlaceDetails()`, `fetchPhotosForTopRestaurants()`
  - Add proper error handling for API failures (invalid key, network issues, rate limiting)
  - Implement loading states and progress indicators
  - Add retry logic with exponential backoff for failed requests

  **Must NOT do**:
  - Do NOT change Google Places API call parameters or response handling
  - Do NOT break existing restaurant object schema creation
  - Do NOT remove existing functionality (nearbySearch → getDetails flow)

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `deep`
    - Reason: Complex API integration requiring careful error handling design
  - **Skills**: []
    - No specific skills needed - pure JavaScript API integration

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 9-15)
  - **Blocks**: Tasks 10, 11, 16, 17, 19, 20
  - **Blocked By**: Tasks 1, 3, 4, 5 (needs project setup, state, store, utils)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `index.html:809-899` - Current Google Places API integration
  - `index.html:637` - Google Maps API script tag
  - `index.html:822-839` - Restaurant object schema creation
  - `index.html:860-899` - Photo fetching logic

  **WHY Each Reference Matters**:
  - Lines 809-899 contain the exact API integration logic that must be preserved
  - Restaurant schema creation must remain identical for compatibility
  - Photo fetching logic shows the fan-out pattern that needs optimization

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: API service handles invalid Google Maps API key gracefully
    Tool: Playwright
    Preconditions: Invalid API key configured
    Steps:
      1. Load page with invalid API key
      2. Verify error banner appears with helpful message
      3. Verify app doesn't hang or crash
      4. Verify user can still use basic functionality (search, favorites)
    Expected Result: Graceful error handling with user-friendly message
    Failure Indicators: Page hangs, unhandled exceptions, no error feedback
    Evidence: .omo/evidence/task-8-api-error-handling.png

  Scenario: API service produces identical restaurant objects
    Tool: Bash
    Preconditions: API service module created
    Steps:
      1. Mock Google Places API response
      2. Call loadPlacesData() with mock data
      3. Compare output restaurant objects with original implementation
    Expected Result: Restaurant objects have identical structure and values
    Evidence: .omo/evidence/task-8-restaurant-schema.txt
  ```

  **Evidence to Capture**:
  - [ ] Error handling screenshots
  - [ ] Restaurant object schema comparison
  - [ ] Loading state functionality
  - [ ] Retry logic verification

  **Acceptance Criteria**:
  - [ ] src/api.js produces identical restaurant objects to original
  - [ ] Google Maps API failures handled gracefully with user-friendly messages
  - [ ] Loading states and progress indicators implemented
  - [ ] Retry logic with exponential backoff for failed requests
  - [ ] All existing API functionality preserved

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): extract Google Places API service with error handling`
  - Files: `src/api.js`
  - Pre-commit: Schema equivalence test

- [ ] 9. Rendering engine module

  **What to do**:
  - Extract rendering functions from index.html to `src/render.js`
  - Functions to extract: `renderList()`, `renderDiscovery()`, `updateDisplay()`
  - Create template functions for HTML generation
  - Implement virtual DOM-like diffing for performance optimization
  - Add lazy loading for large result sets (>50 restaurants)

  **Must NOT do**:
  - Do NOT change HTML output structure or CSS classes
  - Do NOT break existing DOM element ID references
  - Do NOT modify restaurant card layout or styling

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `visual-engineering`
    - Reason: Rendering and DOM manipulation requires frontend expertise
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: For maintaining visual consistency and performance optimization

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 8, 10-15)
  - **Blocks**: Tasks 16, 17, 19
  - **Blocked By**: Tasks 1, 3, 5, 6 (needs project setup, state, utils, types)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `index.html:933-991` - updateDisplay function
  - `index.html:993-1052` - renderDiscovery function  
  - `index.html:1055-1124` - renderList function
  - `index.html:1126-1222` - renderFavorites function

  **WHY Each Reference Matters**:
  - These functions contain the exact HTML generation logic that must be preserved
  - DOM element IDs and CSS classes must remain identical for compatibility

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: Rendering engine produces identical HTML output
    Tool: Playwright
    Preconditions: Original and refactored pages loaded
    Steps:
      1. Load original page with sample data
      2. Capture innerHTML of rest-list element
      3. Load refactored page with same sample data
      4. Capture innerHTML of rest-list element
      5. Compare HTML strings
    Expected Result: HTML output identical between original and refactored
    Failure Indicators: Different HTML structure, missing classes, broken layout
    Evidence: .omo/evidence/task-9-rendering-identical.txt

  Scenario: Lazy loading works for large result sets
    Tool: Playwright
    Preconditions: 100+ restaurants in dataset
    Steps:
      1. Load page with 100+ restaurants
      2. Verify only first 50 are rendered initially
      3. Scroll to bottom and click "Load More"
      4. Verify next 50 are rendered without page hang
    Expected Result: Smooth lazy loading without performance degradation
    Evidence: .omo/evidence/task-9-lazy-loading.mp4
  ```

  **Evidence to Capture**:
  - [ ] HTML output comparison
  - [ ] Lazy loading performance metrics
  - [ ] DOM element ID preservation
  - [ ] CSS class consistency

  **Acceptance Criteria**:
  - [ ] src/render.js produces identical HTML output to original
  - [ ] All DOM element IDs and CSS classes preserved
  - [ ] Lazy loading implemented for large result sets (>50 restaurants)
  - [ ] Virtual DOM-like diffing for performance optimization
  - [ ] All rendering functionality works identically

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): extract rendering engine with lazy loading`
  - Files: `src/render.js`
  - Pre-commit: HTML equivalence test

- [ ] 10. Map integration module

  **What to do**:
  - Extract Google Maps integration from index.html to `src/map.js`
  - Create map service class with methods: `initMap()`, `renderMapMarkers()`, `showDetailOnMap()`
  - Handle map loading states and error conditions
  - Optimize marker rendering for performance with large datasets
  - Implement proper cleanup to prevent memory leaks

  **Must NOT do**:
  - Do NOT change map initialization parameters or marker styling
  - Do NOT break existing map view functionality
  - Do NOT modify restaurant detail popup behavior

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `deep`
    - Reason: Complex Google Maps integration requiring memory management
  - **Skills**: []
    - No specific skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 8-9, 11-15)
  - **Blocks**: Tasks 16, 17
  - **Blocked By**: Tasks 1, 3, 8 (needs project setup, state, API service)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `index.html:1376-1406` - renderMapMarkers function
  - `index.html:1408-1523` - showDetail function (map integration parts)
  - `index.html:1525-1610` - Map initialization and event handling

  **WHY Each Reference Matters**:
  - Map marker rendering logic must be preserved exactly
  - Map initialization parameters affect user experience and compatibility

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: Map integration handles Google Maps loading failure
    Tool: Playwright
    Preconditions: Google Maps script fails to load
    Steps:
      1. Block Google Maps script loading
      2. Load page and switch to map view
      3. Verify graceful fallback to list view
      4. Verify error message displayed
    Expected Result: Map view gracefully degrades with helpful error message
    Failure Indicators: Page crashes, unhandled exceptions, broken UI
    Evidence: .omo/evidence/task-10-map-error.png

  Scenario: Map markers render correctly with restaurant data
    Tool: Playwright
    Preconditions: Valid restaurant data with coordinates
    Steps:
      1. Load page with sample restaurant data
      2. Switch to map view
      3. Verify markers appear at correct locations
      4. Click marker and verify detail popup shows correct info
    Expected Result: Map markers render accurately with proper detail popups
    Evidence: .omo/evidence/task-10-map-markers.png
  ```

  **Evidence to Capture**:
  - [ ] Map error handling screenshots
  - [ ] Marker accuracy verification
  - [ ] Memory leak prevention validation
  - [ ] Performance metrics with large datasets

  **Acceptance Criteria**:
  - [ ] src/map.js handles Google Maps loading failures gracefully
  - [ ] Map markers render at correct locations with proper detail popups
  - [ ] Memory leaks prevented with proper cleanup
  - [ ] Performance optimized for large datasets
  - [ ] All map functionality works identically to original

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): extract map integration with error handling`
  - Files: `src/map.js`
  - Pre-commit: Map functionality test

- [ ] 11. Detail view module

  **What to do**:
  - Extract detail view logic from index.html to `src/detail.js`
  - Create detail service with methods: `showDetail()`, `closeDetail()`, `toggleFavoriteInDetail()`
  - Handle loading states while fetching additional place details
  - Implement proper cleanup and memory management
  - Add smooth animations for detail view transitions

  **Must NOT do**:
  - Do NOT change detail view layout or information displayed
  - Do NOT break existing favorite toggle functionality
  - Do NOT modify restaurant detail information structure

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `visual-engineering`
    - Reason: Detail view involves UI/UX and DOM manipulation
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: For maintaining visual consistency and smooth animations

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 8-10, 12-15)
  - **Blocks**: Tasks 16, 17
  - **Blocked By**: Tasks 1, 3, 8 (needs project setup, state, API service)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `index.html:1408-1523` - showDetail function
  - `index.html:1525-1610` - Detail view event handlers
  - `index.html:1914-1925` - Favorite toggle in detail view

  **WHY Each Reference Matters**:
  - Detail view contains critical user-facing information that must be preserved
  - Favorite toggle functionality is core user feature

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: Detail view displays identical restaurant information
    Tool: Playwright
    Preconditions: Sample restaurant data available
    Steps:
      1. Load original page and open detail view for restaurant
      2. Capture screenshot of detail view content
      3. Load refactored page and open detail view for same restaurant
      4. Capture screenshot of detail view content
      5. Compare screenshots pixel-by-pixel
    Expected Result: Detail view content identical between original and refactored
    Failure Indicators: Missing information, different layout, broken styling
    Evidence: .omo/evidence/task-11-detail-identical.png

  Scenario: Detail view favorite toggle works correctly
    Tool: Playwright
    Preconditions: Restaurant not favorited initially
    Steps:
      1. Open detail view for restaurant
      2. Click favorite button
      3. Verify favorite button changes to filled state
      4. Close detail view and check favorites list
      5. Verify restaurant appears in favorites
    Expected Result: Favorite toggle works identically to original implementation
    Evidence: .omo/evidence/task-11-favorite-toggle.mp4
  ```

  **Evidence to Capture**:
  - [ ] Detail view content comparison
  - [ ] Favorite toggle functionality
  - [ ] Loading state handling
  - [ ] Animation smoothness metrics

  **Acceptance Criteria**:
  - [ ] src/detail.js displays identical restaurant information to original
  - [ ] Favorite toggle works correctly and persists to localStorage
  - [ ] Loading states handled while fetching additional place details
  - [ ] Smooth animations for detail view transitions
  - [ ] All detail view functionality preserved

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): extract detail view module`
  - Files: `src/detail.js`
  - Pre-commit: Detail view equivalence test

- [ ] 12. Random picker module

  **What to do**:
  - Extract random picker logic from index.html to `src/random.js`
  - Create random service with methods: `openRandomPick()`, `closeRandomPick()`, `rerollRandom()`
  - Implement smooth rolling animation with proper timing
  - Handle edge cases (empty results, no restaurants available)
  - Add proper cleanup to prevent memory leaks

  **Must NOT do**:
  - Do NOT change random picker UI or animation behavior
  - Do NOT break existing random selection algorithm
  - Do NOT modify result display format

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `quick`
    - Reason: Straightforward module extraction with minor improvements
  - **Skills**: []
    - No specific skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 8-11, 13-15)
  - **Blocks**: Tasks 16, 17
  - **Blocked By**: Tasks 1, 3, 4 (needs project setup, state, store)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `index.html:1224-1288` - openRandomPick function
  - `index.html:1290-1374` - Random picker event handlers and animations

  **WHY Each Reference Matters**:
  - Random picker has specific animation timing and UI that users expect
  - Selection algorithm must remain consistent for user trust

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: Random picker animation timing matches original
    Tool: Playwright
    Preconditions: Sample restaurant data available
    Steps:
      1. Load original page and trigger random picker
      2. Record animation duration and timing
      3. Load refactored page and trigger random picker
      4. Record animation duration and timing
      5. Compare timing metrics
    Expected Result: Animation timing identical between original and refactored
    Failure Indicators: Different animation speed, jerky transitions, timing issues
    Evidence: .omo/evidence/task-12-random-timing.txt

  Scenario: Random picker handles empty results gracefully
    Tool: Playwright
    Preconditions: No restaurants available (empty filter)
    Steps:
      1. Apply filter that returns no results
      2. Click "Today eat what" button
      3. Verify helpful message displayed instead of hanging
    Expected Result: Graceful handling of empty results with user-friendly message
    Evidence: .omo/evidence/task-12-random-empty.png
  ```

  **Evidence to Capture**:
  - [ ] Animation timing metrics
  - [ ] Empty results handling
  - [ ] Selection algorithm verification
  - [ ] Memory leak prevention

  **Acceptance Criteria**:
  - [ ] src/random.js animation timing matches original exactly
  - [ ] Empty results handled gracefully with user-friendly messages
  - [ ] Random selection algorithm preserved identically
  - [ ] Memory leaks prevented with proper cleanup
  - [ ] All random picker functionality works identically

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): extract random picker module`
  - Files: `src/random.js`
  - Pre-commit: Animation timing test

- [ ] 13. Location management module

  **What to do**:
  - Extract location management logic from index.html to `src/location.js`
  - Create location service with methods: `selectLocation()`, `getCurrentLocation()`, `saveCustomLocation()`
  - Handle browser geolocation permissions and errors
  - Implement proper location validation and sanitization
  - Add smooth location switching animations

  **Must NOT do**:
  - Do NOT change location selection UI or workflow
  - Do NOT break existing localStorage location storage format
  - Do NOT modify default location list or structure

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `quick`
    - Reason: Straightforward module extraction with geolocation handling
  - **Skills**: []
    - No specific skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 8-12, 14-15)
  - **Blocks**: Tasks 16, 17
  - **Blocked By**: Tasks 1, 3, 4 (needs project setup, state, store)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `index.html:1593-1678` - Location selection and management logic
  - `index.html:1680-1713` - Location modal and event handlers
  - `index.html:664-670` - Default locations array

  **WHY Each Reference Matters**:
  - Location management affects core app functionality (restaurant loading)
  - localStorage format must be preserved for user data compatibility

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: Location management preserves localStorage format
    Tool: Playwright
    Preconditions: Custom location saved in original app
    Steps:
      1. Save custom location in original app
      2. Check localStorage.getItem('lg_loc') format
      3. Load refactored app with same localStorage
      4. Verify location loads correctly
    Expected Result: Location data format identical between versions
    Failure Indicators: Location data corruption, parsing errors, missing locations
    Evidence: .omo/evidence/task-13-location-format.txt

  Scenario: Geolocation permission handling works correctly
    Tool: Playwright
    Preconditions: Browser geolocation permissions denied
    Steps:
      1. Deny geolocation permissions
      2. Click GPS location button
      3. Verify fallback to default location with helpful message
    Expected Result: Graceful handling of permission denial with user guidance
    Evidence: .omo/evidence/task-13-geolocation-permission.png
  ```

  **Evidence to Capture**:
  - [ ] localStorage format compatibility
  - [ ] Geolocation permission handling
  - [ ] Location validation functionality
  - [ ] Smooth transition animations

  **Acceptance Criteria**:
  - [ ] src/location.js preserves identical localStorage location format
  - [ ] Browser geolocation permissions handled gracefully
  - [ ] Location validation and sanitization implemented
  - [ ] Smooth location switching animations
  - [ ] All location functionality works identically to original

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): extract location management module`
  - Files: `src/location.js`
  - Pre-commit: Location format compatibility test

- [ ] 14. Event system module

  **What to do**:
  - Extract event handling logic from index.html to `src/events.js`
  - Create centralized event system with methods: `on()`, `off()`, `emit()`
  - Migrate all DOM event listeners to use event system
  - Implement proper event cleanup to prevent memory leaks
  - Add event namespacing for better organization

  **Must NOT do**:
  - Do NOT change existing event listener behavior or triggers
  - Do NOT break any existing user interactions
  - Do NOT modify event handler logic or sequences

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `quick`
    - Reason: Event system implementation is straightforward
  - **Skills**: []
    - No specific skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 8-13, 15)
  - **Blocks**: Task 16
  - **Blocked By**: Task 1 (needs project setup)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `index.html:1680-1952` - All DOM event listeners and handlers
  - 30+ click event listeners throughout the codebase

  **WHY Each Reference Matters**:
  - Event listeners drive all user interactions and must work identically
  - Event sequences and timing affect user experience

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: All user interactions work identically
    Tool: Playwright
    Preconditions: Sample restaurant data available
    Steps:
      1. Perform comprehensive interaction test: search, filter, favorite, map view, detail view, random pick, location change
      2. Verify all interactions produce same results as original
      3. Verify no memory leaks from event listeners
    Expected Result: All user interactions function identically to original implementation
    Failure Indicators: Broken interactions, missing event handlers, memory leaks
    Evidence: .omo/evidence/task-14-events-comprehensive.txt

  Scenario: Event cleanup prevents memory leaks
    Tool: Bash
    Preconditions: Event system module created
    Steps:
      1. Create multiple event listeners
      2. Remove listeners using off() method
      3. Verify no memory leaks using heap snapshot analysis
    Expected Result: Proper event cleanup with no memory accumulation
    Evidence: .omo/evidence/task-14-memory-leaks.txt
  ```

  **Evidence to Capture**:
  - [ ] Comprehensive interaction test results
  - [ ] Memory leak prevention verification
  - [ ] Event handler migration completeness
  - [ ] Performance impact assessment

  **Acceptance Criteria**:
  - [ ] src/events.js handles all 30+ original event listeners
  - [ ] All user interactions work identically to original implementation
  - [ ] Memory leaks prevented with proper event cleanup
  - [ ] Event namespacing implemented for better organization
  - [ ] No performance regression from event system

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): extract event system module`
  - Files: `src/events.js`
  - Pre-commit: Interaction equivalence test

- [ ] 15. Python data pipeline modernization

  **What to do**:
  - Modernize `scripts/enrich_data.py` with type hints and proper error handling
  - Replace urllib with requests library for better error handling
  - Add proper logging instead of print statements
  - Implement retry logic with exponential backoff for API calls
  - Add input validation and sanitization
  - Improve code documentation with docstrings

  **Must NOT do**:
  - Do NOT change compact array output format (FIELDS order dependency)
  - Do NOT break existing district JSON file structure
  - Do NOT modify FEHD XML parsing logic or Overpass query structure

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `deep`
    - Reason: Complex data pipeline requiring careful modification
  - **Skills**: []
    - No specific skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 8-14)
  - **Blocks**: Tasks 18, 21
  - **Blocked By**: Task 7 (needs test infrastructure)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `scripts/enrich_data.py:76-81` - FIELDS array defining compact format
  - `scripts/enrich_data.py:448-450` - Compact array row generation
  - `scripts/enrich_data.py:86-149` - FEHD XML parsing logic
  - `scripts/enrich_data.py:154-189` - Overpass API query logic

  **WHY Each Reference Matters**:
  - FIELDS array order determines output JSON structure - cannot change
  - FEHD and Overpass logic must remain compatible with data sources

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: Modernized pipeline produces identical output format
    Tool: interactive_bash
    Preconditions: Sample FEHD XML and Overpass data available
    Steps:
      1. Run original enrich_data.py with sample data
      2. Save output district JSON files
      3. Run modernized enrich_data.py with same sample data
      4. Compare output JSON files byte-by-byte
    Expected Result: Output files identical between original and modernized versions
    Failure Indicators: Different field order, missing data, format changes
    Evidence: .omo/evidence/task-15-pipeline-identical.txt

  Scenario: Modernized pipeline handles API failures gracefully
    Tool: interactive_bash
    Preconditions: FEHD server unavailable
    Steps:
      1. Block FEHD XML URL access
      2. Run modernized enrich_data.py
      3. Verify proper error message and exit code
      4. Verify no partial/corrupted output files
    Expected Result: Graceful error handling with clear error messages
    Evidence: .omo/evidence/task-15-pipeline-errors.txt
  ```

  **Evidence to Capture**:
  - [ ] Output format compatibility verification
  - [ ] Error handling functionality
  - [ ] Performance improvement metrics
  - [ ] Code quality assessment

  **Acceptance Criteria**:
  - [ ] Modernized enrich_data.py produces identical output format to original
  - [ ] Type hints and proper error handling implemented
  - [ ] urllib replaced with requests library
  - [ ] Retry logic with exponential backoff for API calls
  - [ ] Compact array format (FIELDS order) preserved exactly

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): modernize Python data pipeline with type hints`
  - Files: `scripts/enrich_data.py`
  - Pre-commit: Output format equivalence test

- [ ] 16. Main app entry point + module integration

  **What to do**:
  - Create `src/app.js` as main entry point
  - Import and initialize all modules (state, store, api, render, map, detail, random, location, events)
  - Wire up module dependencies and communication
  - Implement proper error boundaries and graceful degradation
  - Update index.html to load ES modules instead of inline script
  - Add proper loading states and progress indicators

  **Must NOT do**:
  - Do NOT change overall app initialization sequence
  - Do NOT break existing user-facing functionality
  - Do NOT introduce build step or bundler

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `deep`
    - Reason: Complex module integration requiring careful dependency management
  - **Skills**: []
    - No specific skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 17-22)
  - **Blocks**: Tasks 17-22
  - **Blocked By**: Tasks 1-14 (all core modules)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `index.html:639-1952` - Original app initialization and execution flow
  - All extracted module interfaces from Tasks 1-14

  **WHY Each Reference Matters**:
  - Original initialization sequence must be preserved for compatibility
  - Module interfaces must integrate seamlessly

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: App loads and functions identically to original
    Tool: Playwright
    Preconditions: Sample restaurant data available
    Steps:
      1. Load original app and perform comprehensive functionality test
      2. Load refactored app and perform identical test
      3. Compare results and user experience
    Expected Result: Identical functionality and user experience between versions
    Failure Indicators: Broken features, performance regressions, visual differences
    Evidence: .omo/evidence/task-16-app-identical.txt

  Scenario: App handles module loading failures gracefully
    Tool: Playwright
    Preconditions: One module fails to load
    Steps:
      1. Simulate module loading failure (e.g., API module)
      2. Load refactored app
      3. Verify graceful degradation with helpful error messages
      4. Verify core functionality still works where possible
    Expected Result: Graceful degradation with clear error messages
    Evidence: .omo/evidence/task-16-module-failures.png
  ```

  **Evidence to Capture**:
  - [ ] Comprehensive functionality comparison
  - [ ] Error handling scenarios
  - [ ] Performance metrics comparison
  - [ ] Module integration verification

  **Acceptance Criteria**:
  - [ ] src/app.js integrates all modules correctly
  - [ ] App loads and functions identically to original
  - [ ] Proper error boundaries and graceful degradation implemented
  - [ ] index.html updated to load ES modules
  - [ ] Loading states and progress indicators added

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): create main app entry point and integrate modules`
  - Files: `src/app.js`, `index.html`
  - Pre-commit: Integration test

- [ ] 17. Playwright E2E test suite

  **What to do**:
  - Create comprehensive Playwright E2E tests covering all user flows
  - Test scenarios: page load, search, cuisine filtering, favorites, map view, detail view, random picker, location management
  - Implement proper test setup and teardown
  - Add mobile viewport testing for responsive design
  - Include performance timing assertions (page load < 2s on 3G)

  **Must NOT do**:
  - Do NOT skip critical user flows
  - Do NOT use hardcoded test data that breaks easily
  - Do NOT ignore performance assertions

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `unspecified-high`
    - Reason: Comprehensive test suite creation requires thorough coverage
  - **Skills**: [`playwright`]
    - `playwright`: For proper Playwright test implementation and best practices

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 16, 18-22)
  - **Blocks**: Final Verification Wave
  - **Blocked By**: Task 16 (needs integrated app)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - All user interaction flows documented in Tasks 8-14
  - Project requirements for performance (< 2s load time)

  **WHY Each Reference Matters**:
  - Tests must cover all critical user flows identified in requirements
  - Performance assertions must match stated requirements

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: Playwright tests cover all critical user flows
    Tool: Bash
    Preconditions: Playwright test suite created
    Steps:
      1. npx playwright test --list
      2. Verify test count >= 8 covering: load, search, filter, favorites, map, detail, random, location
      3. npx playwright test
      4. Verify all tests pass
    Expected Result: Comprehensive test coverage with all tests passing
    Failure Indicators: Missing critical flows, failing tests, insufficient coverage
    Evidence: .omo/evidence/task-17-playwright-coverage.txt

  Scenario: Performance tests validate 2-second load requirement
    Tool: Playwright
    Preconditions: Test environment with 3G throttling
    Steps:
      1. Run performance test with 3G network throttling
      2. Measure page load time from navigation to interactive state
      3. Verify load time < 2000ms
    Expected Result: Page loads within 2 seconds on 3G throttling
    Evidence: .omo/evidence/task-17-performance-3g.txt
  ```

  **Evidence to Capture**:
  - [ ] Test coverage report
  - [ ] Performance timing metrics
  - [ ] Mobile viewport test results
  - [ ] Cross-browser compatibility verification

  **Acceptance Criteria**:
  - [ ] Playwright tests cover all 8+ critical user flows
  - [ ] Page loads within 2 seconds on 3G throttling
  - [ ] Mobile viewport testing implemented
  - [ ] All tests pass successfully
  - [ ] Comprehensive test coverage achieved

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): add comprehensive Playwright E2E test suite`
  - Files: `tests/*.spec.js`
  - Pre-commit: All tests passing

- [ ] 18. Pytest unit test suite

  **What to do**:
  - Create comprehensive pytest unit tests for `enrich_data.py`
  - Test scenarios: FEHD XML parsing, Overpass API response parsing, merge logic, output format validation
  - Implement proper test fixtures and mocking
  - Add test coverage reporting
  - Include edge case testing (empty inputs, malformed data, API failures)

  **Must NOT do**:
  - Do NOT skip critical data pipeline logic
  - Do NOT use real API calls in tests (must mock)
  - Do NOT ignore edge cases and error conditions

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `unspecified-high`
    - Reason: Comprehensive test suite creation for complex data pipeline
  - **Skills**: []
    - No specific skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 16-17, 19-22)
  - **Blocks**: Final Verification Wave
  - **Blocked By**: Tasks 15, 7 (needs modernized pipeline and test infrastructure)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `scripts/enrich_data.py` - Modernized data pipeline logic
  - Python testing best practices for data processing

  **WHY Each Reference Matters**:
  - Tests must cover all critical data pipeline functions
  - Mocking strategy must properly isolate units under test

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: Pytest covers all critical data pipeline functions
    Tool: Bash
    Preconditions: Pytest test suite created
    Steps:
      1. python -m pytest scripts/ --cov=scripts --cov-report=term-missing
      2. Verify coverage >= 80% for critical functions
      3. Verify all tests pass
    Expected Result: High test coverage with all tests passing
    Failure Indicators: Low coverage, failing tests, missing critical scenarios
    Evidence: .omo/evidence/task-18-pytest-coverage.txt

  Scenario: Tests properly handle edge cases and errors
    Tool: Bash
    Preconditions: Test suite with edge case scenarios
    Steps:
      1. Run tests with malformed FEHD XML input
      2. Run tests with empty Overpass responses
      3. Run tests with API timeout scenarios
      4. Verify appropriate error handling and no crashes
    Expected Result: Proper error handling for all edge cases
    Evidence: .omo/evidence/task-18-edge-cases.txt
  ```

  **Evidence to Capture**:
  - [ ] Test coverage report
  - [ ] Edge case handling verification
  - [ ] Mock isolation validation
  - [ ] Performance test results

  **Acceptance Criteria**:
  - [ ] Pytest covers all critical data pipeline functions
  - [ ] Test coverage >= 80% for critical functions
  - [ ] All edge cases and error conditions handled
  - [ ] Proper mocking and test isolation implemented
  - [ ] All tests pass successfully

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): add comprehensive pytest unit test suite`
  - Files: `scripts/test_enrich_data.py`
  - Pre-commit: All tests passing with coverage report

- [ ] 19. Performance optimization implementation

  **What to do**:
  - Implement performance optimizations identified during refactoring
  - Optimize Google Places API calls (debounce, cache, limit parallel requests)
  - Implement virtual scrolling for large restaurant lists
  - Optimize DOM updates with batched operations
  - Add proper loading states and skeleton screens
  - Implement code splitting for non-critical features

  **Must NOT do**:
  - Do NOT break existing functionality while optimizing
  - Do NOT over-optimize at the cost of maintainability
  - Do NOT ignore mobile performance constraints

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `deep`
    - Reason: Performance optimization requires deep understanding of bottlenecks
  - **Skills**: []
    - No specific skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 16-18, 20-22)
  - **Blocks**: Final Verification Wave
  - **Blocked By**: Task 16 (needs integrated app)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - Performance bottlenecks identified in Metis analysis
  - Current Google Places API fan-out pattern (20 parallel requests)

  **WHY Each Reference Matters**:
  - Optimizations must target actual bottlenecks, not perceived ones
  - Google Places API usage patterns need careful optimization

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: Page loads within 2 seconds on 3G throttling
    Tool: Playwright
    Preconditions: Production-like data (17K+ restaurants)
    Steps:
      1. Throttle network to 3G speeds
      2. Navigate to page
      3. Wait for page to become interactive
      4. Measure total load time
    Expected Result: Page loads and becomes interactive within 2000ms
    Failure Indicators: Load time > 2000ms, page hangs, unresponsive UI
    Evidence: .omo/evidence/task-19-performance-3g.txt

  Scenario: Large restaurant lists render smoothly
    Tool: Playwright
    Preconditions: 1000+ restaurants in dataset
    Steps:
      1. Load page with 1000+ restaurants
      2. Scroll through entire list rapidly
      3. Measure frame rate and responsiveness
    Expected Result: Smooth scrolling with consistent 60fps frame rate
    Evidence: .omo/evidence/task-19-large-lists.mp4
  ```

  **Evidence to Capture**:
  - [ ] Performance timing metrics before/after
  - [ ] Frame rate measurements
  - [ ] Memory usage optimization
  - [ ] API call reduction metrics

  **Acceptance Criteria**:
  - [ ] Page loads within 2 seconds on 3G throttling
  - [ ] Large restaurant lists render smoothly (60fps)
  - [ ] Google Places API calls optimized (debounce, cache, limit parallel requests)
  - [ ] DOM updates optimized with batched operations
  - [ ] Loading states and skeleton screens implemented

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): implement performance optimizations`
  - Files: Relevant src/ files
  - Pre-commit: Performance regression test

- [ ] 20. Error handling implementation

  **What to do**:
  - Implement comprehensive error handling throughout the application
  - Handle Google Maps API failures gracefully
  - Handle localStorage quota exceeded errors
  - Handle network request failures with retry logic
  - Add user-friendly error messages and recovery options
  - Implement proper logging for debugging

  **Must NOT do**:
  - Do NOT silently swallow errors (except localStorage quota)
  - Do NOT show technical error messages to users
  - Do NOT break user workflow on recoverable errors

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `quick`
    - Reason: Error handling implementation across modules
  - **Skills**: []
    - No specific skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 16-19, 21-22)
  - **Blocks**: Final Verification Wave
  - **Blocked By**: Task 16 (needs integrated app)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - Current silent error handling in Store module
  - Google Maps API error scenarios identified in Metis analysis

  **WHY Each Reference Matters**:
  - Error handling must be consistent and user-friendly
  - Some errors (localStorage quota) should remain silent for UX

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: Google Maps API key errors show user-friendly messages
    Tool: Playwright
    Preconditions: Invalid Google Maps API key
    Steps:
      1. Load page with invalid API key
      2. Verify user-friendly error message appears
      3. Verify user can continue using basic functionality
    Expected Result: Helpful error message without breaking core functionality
    Failure Indicators: Technical error messages, complete app failure, no error feedback
    Evidence: .omo/evidence/task-20-api-errors.png

  Scenario: Network failures handled with retry logic
    Tool: Playwright
    Preconditions: Network requests fail initially
    Steps:
      1. Simulate network failure on first request
      2. Verify automatic retry after delay
      3. Verify success on subsequent attempt
    Expected Result: Automatic retry with eventual success
    Evidence: .omo/evidence/task-20-network-retry.txt
  ```

  **Evidence to Capture**:
  - [ ] Error message screenshots
  - [ ] Retry logic verification
  - [ ] User workflow preservation
  - [ ] Logging functionality validation

  **Acceptance Criteria**:
  - [ ] Google Maps API failures show user-friendly error messages
  - [ ] Network failures handled with automatic retry logic
  - [ ] localStorage quota errors handled gracefully (silent for UX)
  - [ ] User workflow preserved on recoverable errors
  - [ ] Proper logging implemented for debugging

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): implement comprehensive error handling`
  - Files: Relevant src/ files
  - Pre-commit: Error scenario tests

- [ ] 21. CI/CD workflow update

  **What to do**:
  - Update `.github/workflows/update-restaurants.yml` to use `enrich_data.py`
  - Add Playwright and pytest test steps to CI workflow
  - Update changed-files detection to monitor `district_*.json` instead of `hk_restaurants.json`
  - Add proper caching for npm and Python dependencies
  - Implement proper error handling and notifications

  **Must NOT do**:
  - Do NOT break existing CI workflow functionality
  - Do NOT remove daily cron schedule
  - Do NOT change commit behavior or git operations

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `quick`
    - Reason: CI/CD workflow configuration update
  - **Skills**: [`git-master`]
    - `git-master`: For proper git workflow integration

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 16-20, 22)
  - **Blocks**: Final Verification Wave
  - **Blocked By**: Tasks 15, 17, 18 (needs updated pipeline and tests)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `.github/workflows/update-restaurants.yml` - Current CI workflow
  - GitHub Actions documentation for Playwright and pytest

  **WHY Each Reference Matters**:
  - CI workflow must maintain existing functionality while adding new capabilities
  - File monitoring must track correct output files

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: CI workflow runs successfully with new pipeline
    Tool: Bash
    Preconditions: Updated CI workflow file
    Steps:
      1. act -W .github/workflows/update-restaurants.yml
      2. Verify workflow completes without errors
      3. Verify enrich_data.py is executed instead of update_restaurants.py
      4. Verify district_*.json files are monitored for changes
    Expected Result: CI workflow executes successfully with updated pipeline
    Failure Indicators: Workflow failures, wrong script execution, incorrect file monitoring
    Evidence: .omo/evidence/task-21-ci-success.txt

  Scenario: CI workflow includes Playwright and pytest tests
    Tool: Bash
    Preconditions: Updated CI workflow with test steps
    Steps:
      1. act -W .github/workflows/update-restaurants.yml
      2. Verify Playwright tests execute during workflow
      3. Verify pytest tests execute during workflow
      4. Verify workflow fails if tests fail
    Expected Result: Comprehensive test execution in CI workflow
    Evidence: .omo/evidence/task-21-ci-tests.txt
  ```

  **Evidence to Capture**:
  - [ ] CI workflow execution logs
  - [ ] Test execution verification
  - [ ] File monitoring accuracy
  - [ ] Error handling functionality

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): update CI/CD workflow with new pipeline and tests`
  - Files: `.github/workflows/update-restaurants.yml`
  - Pre-commit: Local CI workflow test

- [ ] 22. Documentation updates

  **What to do**:
  - Update project README with new architecture overview
  - Document module structure and APIs
  - Add development setup instructions (npm install, test commands)
  - Document deployment requirements (HTTP server for ES modules)
  - Update contribution guidelines

  **Must NOT do**:
  - Do NOT include outdated information
  - Do NOT skip critical setup steps
  - Do NOT make documentation too verbose

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `writing`
    - Reason: Technical documentation writing
  - **Skills**: []
    - No specific skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 16-21)
  - **Blocks**: Final Verification Wave
  - **Blocked By**: Task 16 (needs final architecture)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - Current project structure and requirements
  - Module interfaces from Tasks 1-16

  **WHY Each Reference Matters**:
  - Documentation must accurately reflect the new architecture
  - Setup instructions must be complete and accurate

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY - task is INCOMPLETE without these):**

  ```
  Scenario: Documentation enables successful local setup
    Tool: interactive_bash
    Preconditions: Clean project clone
    Steps:
      1. Follow README setup instructions exactly
      2. Verify npm install succeeds
      3. Verify tests run successfully
      4. Verify app loads correctly
    Expected Result: Complete and accurate setup documentation
    Failure Indicators: Missing steps, outdated commands, broken instructions
    Evidence: .omo/evidence/task-22-setup-success.txt

  Scenario: Architecture documentation matches actual implementation
    Tool: Bash
    Preconditions: Documentation and code available
    Steps:
      1. Compare README architecture description with actual src/ structure
      2. Verify all modules documented match actual implementation
      3. Verify API documentation matches actual function signatures
    Expected Result: Documentation accurately reflects implementation
    Evidence: .omo/evidence/task-22-docs-accuracy.txt
  ```

  **Evidence to Capture**:
  - [ ] Setup success verification
  - [ ] Documentation accuracy assessment
  - [ ] API documentation completeness
  - [ ] Contribution guideline clarity

  **Acceptance Criteria**:
  - [ ] README updated with new architecture overview
  - [ ] Module structure and APIs documented
  - [ ] Development setup instructions complete and accurate
  - [ ] Deployment requirements documented (HTTP server for ES modules)
  - [ ] Contribution guidelines updated

  **Commit**: YES | NO (groups with N)
  - Message: `feat(refactor): update documentation for new architecture`
  - Files: `README.md`
  - Pre-commit: Documentation review

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .omo/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + `npx playwright test` + `python -m pytest`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill if UI)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: empty state, invalid input, rapid actions. Save to `.omo/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `feat(refactor): project scaffolding and core modules`
- **Wave 2**: `feat(refactor): api services and rendering modules`  
- **Wave 3**: `feat(refactor): integration, testing, and optimization`
- **Wave FINAL**: `feat(refactor): verification and documentation`

---

## Success Criteria

### Verification Commands
```bash
# Frontend tests
npx playwright test

# Python tests  
python -m pytest scripts/

# Performance check
# Page should load within 2 seconds on 3G throttling

# CI workflow validation
git diff --quiet .github/workflows/update-restaurants.yml
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent  
- [ ] All tests pass
- [ ] Performance optimized (no hanging)
- [ ] User data compatibility maintained
- [ ] CI/CD workflow updated correctly