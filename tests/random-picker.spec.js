import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Random Picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Wait for the first results batch or the error banner to appear.
    await page.waitForSelector('#rest-list .rest-card, #error-banner.show', { timeout: 20000 });
  });

  test('should show random picker modal when clicking "今天吃什麼" button', async ({ page }) => {
    const randomBtn = page.locator('#random-pick-btn');
    const randomOverlay = page.locator('#random-overlay');
    const randomFooter = page.locator('#random-footer');
    
    // Click the random pick button
    await randomBtn.click();
    
    // Verify random picker modal is shown
    await expect(randomOverlay).toBeVisible();

    // Wait for the result state to appear; the setup can auto-start on its own.
    await expect(randomFooter).toBeVisible({ timeout: 10000 });
    
    // Verify result elements are present
    await expect(page.locator('#random-result-name')).toBeVisible();
    await expect(page.locator('#random-result-detail')).toBeVisible();
    await expect(page.locator('#random-result-rating')).toBeVisible();
  });
  
  test('should close random picker when clicking close button', async ({ page }) => {
    const randomBtn = page.locator('#random-pick-btn');
    const randomOverlay = page.locator('#random-overlay');
    const randomCloseBtn = page.locator('#random-close');
    
    // Open random picker
    await randomBtn.click();
    await expect(randomOverlay).toBeVisible();
    
    // Click close button
    await randomCloseBtn.click();
    
    // Verify modal is closed
    await expect(randomOverlay).not.toBeVisible();
  });
  
  test('should close random picker when clicking outside', async ({ page }) => {
    const randomBtn = page.locator('#random-pick-btn');
    const randomOverlay = page.locator('#random-overlay');
    
    // Open random picker
    await randomBtn.click();
    await expect(randomOverlay).toBeVisible();
    
    // Click outside the modal (on the overlay background)
    await randomOverlay.click({ position: { x: 10, y: 10 } });
    
    // Verify modal is closed
    await expect(randomOverlay).not.toBeVisible();
  });
  
  test('should reroll when clicking "再選一次" button', async ({ page }) => {
    const randomBtn = page.locator('#random-pick-btn');
    const randomRerollBtn = page.locator('#random-reroll');
    const randomFooter = page.locator('#random-footer');
    
    // Open random picker and wait for first result
    await randomBtn.click();
    await expect(randomFooter).toBeVisible({ timeout: 10000 });
    
    // Get the first result name
    const firstResultName = await page.locator('#random-result-name').textContent();
    
    // Click reroll button
    await randomRerollBtn.click();
    
    // Verify it goes back to rolling state
    await expect(randomFooter).not.toBeVisible();
    
    // Wait for second result
    await expect(randomFooter).toBeVisible({ timeout: 10000 });
    
    // Get the second result name
    const secondResultName = await page.locator('#random-result-name').textContent();
    
    // Verify results are different (or at least the UI updated)
    // Note: In a real app with many restaurants, they should be different
    // But with limited data, they might be the same - so we just verify the UI flow
    expect(secondResultName).toBeTruthy();
  });
  
  test('should view details when clicking "查看詳情" button', async ({ page }) => {
    const randomBtn = page.locator('#random-pick-btn');
    const randomViewBtn = page.locator('#random-view');
    const detailView = page.locator('#detail-view');
    
    // Open random picker and wait for result
    await randomBtn.click();
    await page.waitForTimeout(3000);
    
    // Click view details button
    await randomViewBtn.click();
    
    // Verify detail view is shown
    await expect(detailView).toHaveClass(/active/);
    
    // Close detail view
    await page.locator('#detail-back').click();
    await expect(detailView).not.toHaveClass(/active/);
  });
});
