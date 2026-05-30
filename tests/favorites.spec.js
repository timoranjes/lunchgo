import { test, expect } from '@playwright/test';

test.describe('Favorites Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Wait for the first results batch or the error banner to appear.
    await page.waitForSelector('#rest-list .rest-card, #error-banner.show', { timeout: 20000 });
  });

  test('should toggle favorite status on restaurant cards', async ({ page }) => {
    const firstCard = page.locator('.rest-card').first();
    const favButton = firstCard.locator('.rest-fav');
    
    // Verify favorite button exists on card
    await expect(favButton).toBeVisible();
    
    // Get initial favorite state (should be empty heart)
    const initialText = await favButton.textContent();
    expect(initialText).toBe('♡'); // Empty heart
    
    // Click to add to favorites
    await favButton.click();
    
    // Verify it becomes filled heart
    await expect(favButton).toHaveText('♥');
    
    // Click again to remove from favorites
    await favButton.click();
    
    // Verify it becomes empty heart again
    await expect(favButton).toHaveText('♡');
  });
  
  test('should persist favorites across page reloads', async ({ page }) => {
    const firstCard = page.locator('.rest-card').first();
    const favButton = firstCard.locator('.rest-fav');
    const favPageButton = page.locator('#fav-btn');
    const favList = page.locator('#fav-list');
    const favEmpty = page.locator('#fav-empty');
    
    // Add first restaurant to favorites
    await favButton.click();
    await expect(favButton).toHaveText('♥');
    
    // Navigate to favorites page
    await favPageButton.click();
    
    // Verify favorites page is shown
    await expect(page.locator('#fav-page')).toBeVisible();
    
    // Verify at least one favorite is displayed
    await expect(favEmpty).not.toBeVisible();
    await expect(favList.locator('.rest-card')).toHaveCount(1);
    
    // Go back to main page
    await page.locator('#fav-back').click();
    await expect(page.locator('#fav-page')).not.toBeVisible();
    
    // Reload the page
    await page.reload();
    
    // Wait for reload to complete
    await page.waitForSelector('#rest-list .rest-card, #error-banner.show', { timeout: 20000 });
    
    // Verify the favorite status is preserved
    const reloadedFavButton = page.locator('.rest-card').first().locator('.rest-fav');
    await expect(reloadedFavButton).toHaveText('♥');
    
    // Navigate to favorites page again
    await favPageButton.click();
    
    // Verify favorite is still there after reload
    await expect(favEmpty).not.toBeVisible();
    await expect(favList.locator('.rest-card')).toHaveCount(1);
  });
  
  test('should sort favorites by different criteria', async ({ page }) => {
    // First, add at least one favorite to ensure we have something to sort
    const firstCard = page.locator('.rest-card').first();
    const favButton = firstCard.locator('.rest-fav');
    await favButton.click();
    
    // Navigate to favorites page
    await page.locator('#fav-btn').click();
    
    // Verify default sort is "recent"
    const recentBtn = page.locator('.fav-sort-btn', { hasText: '最近添加' });
    await expect(recentBtn).toHaveClass(/active/);
    
    // Switch to name sort
    const nameBtn = page.locator('.fav-sort-btn', { hasText: '名稱' });
    await nameBtn.click();
    await expect(nameBtn).toHaveClass(/active/);
    await expect(recentBtn).not.toHaveClass(/active/);
    
    // Switch to distance sort
    const distanceBtn = page.locator('.fav-sort-btn', { hasText: '距離' });
    await distanceBtn.click();
    await expect(distanceBtn).toHaveClass(/active/);
    await expect(nameBtn).not.toHaveClass(/active/);
    
    // Go back to main page
    await page.locator('#fav-back').click();
  });
});
