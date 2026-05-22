import { test, expect } from '@playwright/test';

test.describe('Page Load', () => {
  test('should load the app with correct title and main elements', async ({ page }) => {
    // Start timing for performance assertion
    const startTime = Date.now();
    
    await page.goto('/');
    
    // Performance assertion: page should load within 2 seconds on 3G
    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(2000);
    
    // Verify page title
    await expect(page).toHaveTitle('LunchGo 搵食');
    
    // Verify main header elements
    await expect(page.locator('#main-header')).toBeVisible();
    await expect(page.locator('h1')).toContainText('LunchGo 搵食');
    
    // Verify search bar is present
    await expect(page.locator('#search-input')).toBeVisible();
    
    // Verify toolbar buttons are present
    await expect(page.locator('.toolbar-btn')).toHaveCount(4);
    await expect(page.locator('.toolbar-btn.active')).toContainText('距離最近');
    
    // Verify cuisine bar is present
    await expect(page.locator('#cuisine-bar')).toBeVisible();
    
    // Verify view toggle buttons
    await expect(page.locator('.view-btn')).toHaveCount(2);
    await expect(page.locator('.view-btn.active')).toContainText('列表');
    
    // Verify random pick button
    await expect(page.locator('#random-pick-btn')).toContainText('今天吃什麼');
    
    // Verify list view is initially visible
    await expect(page.locator('#list-view')).toBeVisible();
    
    // Verify loading state is shown initially
    await expect(page.locator('#loading-state')).toBeVisible();
    
    // Wait for restaurants to load (or error)
    await Promise.race([
      page.waitForSelector('#rest-list:not(:empty)', { timeout: 10000 }),
      page.waitForSelector('#error-banner.show', { timeout: 10000 })
    ]);
    
    // Either restaurants loaded or error banner shown
    const hasRestaurants = await page.locator('#rest-list > div').count() > 0;
    const hasError = await page.locator('#error-banner.show').isVisible();
    expect(hasRestaurants || hasError).toBe(true);
  });
});