import { test, expect } from '@playwright/test';

test.describe('Search Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Wait for the first results batch or the error banner to appear.
    await page.waitForSelector('#rest-list .rest-card, #error-banner.show', { timeout: 20000 });
  });

  test('should filter restaurants when typing in search input', async ({ page }) => {
    const searchInput = page.locator('#search-input');
    const resultList = page.locator('#rest-list');
    const resultCount = page.locator('#result-count');
    const searchClear = page.locator('#search-clear');
    
    // Verify initial state
    await expect(searchInput).toBeVisible();
    const initialCount = await resultList.locator('.rest-card').count();
    
    // Type a search query (use common Chinese character that should match)
    await searchInput.fill('茶');
    
    // Verify search clear button appears
    await expect(searchClear).toBeVisible();

    // Wait for the filtered list to settle.
    await expect.poll(async () => resultList.locator('.rest-card').count()).toBeLessThanOrEqual(initialCount);

    // Verify results are filtered
    const filteredCount = await resultList.locator('.rest-card').count();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
    
    // Verify result count is updated
    if (filteredCount > 0) {
      await expect(resultCount).toBeVisible();
      const countText = await resultCount.textContent();
      expect(countText).toMatch(/\d+ 間餐廳/);
    }
    
    // Clear search
    await searchClear.click();
    
    // Verify search input is cleared
    await expect(searchInput).toHaveValue('');
    
    // Verify search clear button is hidden
    await expect(searchClear).not.toBeVisible();

    // Wait for results to revert to the original list size.
    await expect.poll(async () => resultList.locator('.rest-card').count()).toBe(initialCount);
    const finalCount = await resultList.locator('.rest-card').count();
    expect(finalCount).toBe(initialCount);
  });
  
  test('should show empty state when no results found', async ({ page }) => {
    const searchInput = page.locator('#search-input');
    const emptyState = page.locator('#empty-state');
    const resultList = page.locator('#rest-list');
    
    // Type a query that should return no results
    await searchInput.fill('xyz123nonexistent');

    // Verify empty state is shown
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText('找不到餐廳');
    
    // Verify no restaurant cards are displayed
    const cardCount = await resultList.locator('.rest-card').count();
    expect(cardCount).toBe(0);
  });
});
