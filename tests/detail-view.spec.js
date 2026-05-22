import { test, expect } from '@playwright/test';

test.describe('Detail View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for initial load to complete
    await Promise.race([
      page.waitForSelector('#rest-list:not(:empty)', { timeout: 10000 }),
      page.waitForSelector('#error-banner.show', { timeout: 10000 })
    ]);
  });

  test('should show detail view when clicking restaurant card', async ({ page }) => {
    const firstCard = page.locator('.rest-card').first();
    const detailView = page.locator('#detail-view');
    const detailBackBtn = page.locator('#detail-back');
    const detailContent = page.locator('#detail-content');
    
    // Get the restaurant name from the card
    const cardName = await firstCard.locator('.rest-name').textContent();
    
    // Click the restaurant card
    await firstCard.click();
    
    // Verify detail view is shown
    await expect(detailView).toHaveClass(/active/);
    
    // Verify detail content contains the restaurant name
    await expect(detailContent.locator('.detail-name')).toContainText(cardName);
    
    // Verify back button is present
    await expect(detailBackBtn).toBeVisible();
    
    // Click back button to close detail view
    await detailBackBtn.click();
    
    // Verify detail view is closed
    await expect(detailView).not.toHaveClass(/active/);
  });
  
  test('should toggle favorite in detail view', async ({ page }) => {
    const firstCard = page.locator('.rest-card').first();
    const detailView = page.locator('#detail-view');
    const detailFavBtn = page.locator('#detail-fav');
    
    // Click the restaurant card to open detail view
    await firstCard.click();
    
    // Verify detail view is shown
    await expect(detailView).toHaveClass(/active/);
    
    // Verify initial favorite state (empty heart)
    await expect(detailFavBtn).toHaveText('♡');
    await expect(detailFavBtn).not.toHaveClass(/is-fav/);
    
    // Click to add to favorites
    await detailFavBtn.click();
    
    // Verify it becomes filled heart with is-fav class
    await expect(detailFavBtn).toHaveText('♥');
    await expect(detailFavBtn).toHaveClass(/is-fav/);
    
    // Click again to remove from favorites
    await detailFavBtn.click();
    
    // Verify it becomes empty heart again
    await expect(detailFavBtn).toHaveText('♡');
    await expect(detailFavBtn).not.toHaveClass(/is-fav/);
    
    // Close detail view
    await page.locator('#detail-back').click();
  });
  
  test('should close detail view when clicking outside', async ({ page }) => {
    const firstCard = page.locator('.rest-card').first();
    const detailView = page.locator('#detail-view');
    
    // Click the restaurant card to open detail view
    await firstCard.click();
    
    // Verify detail view is shown
    await expect(detailView).toHaveClass(/active/);
    
    // Click outside the detail content (on the overlay)
    await detailView.click({ position: { x: 10, y: 10 } });
    
    // Verify detail view is closed
    await expect(detailView).not.toHaveClass(/active/);
  });
});