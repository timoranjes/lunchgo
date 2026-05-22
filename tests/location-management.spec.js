import { test, expect } from '@playwright/test';

test.describe('Location Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for initial load to complete
    await Promise.race([
      page.waitForSelector('#rest-list:not(:empty)', { timeout: 10000 }),
      page.waitForSelector('#error-banner.show', { timeout: 10000 })
    ]);
  });

  test('should show location modal when clicking location button', async ({ page }) => {
    const locBtn = page.locator('#loc-btn');
    const locModal = page.locator('#loc-modal');
    const locList = page.locator('#loc-list');
    
    // Click location button
    await locBtn.click();
    
    // Verify location modal is shown
    await expect(locModal).toHaveClass(/active/);
    
    // Verify default locations are present (5 HK locations)
    const locItems = locList.locator('.loc-item');
    await expect(locItems).toHaveCount(5);
    
    // Verify expected locations are present
    const locTexts = await locItems.allTextContents();
    expect(locTexts.some(text => text.includes('中環'))).toBe(true);
    expect(locTexts.some(text => text.includes('銅鑼灣'))).toBe(true);
    expect(locTexts.some(text => text.includes('旺角'))).toBe(true);
    expect(locTexts.some(text => text.includes('尖沙咀'))).toBe(true);
    expect(locTexts.some(text => text.includes('鰂魚涌'))).toBe(true);
    
    // Verify current location is marked (should be 中環 initially)
    const centralItem = locList.locator('.loc-item', { hasText: '中環' });
    await expect(centralItem).toContainText('目前');
  });
  
  test('should change location when selecting from modal', async ({ page }) => {
    const locBtn = page.locator('#loc-btn');
    const locModal = page.locator('#loc-modal');
    const mongKokItem = page.locator('#loc-list .loc-item', { hasText: '旺角' });
    const loadingState = page.locator('#loading-state');
    const resultList = page.locator('#rest-list');
    
    // Get initial location button text
    const initialLocText = await locBtn.textContent();
    expect(initialLocText).toBe('中環');
    
    // Open location modal
    await locBtn.click();
    await expect(locModal).toHaveClass(/active/);
    
    // Select 旺角 (Mong Kok)
    await mongKokItem.click();
    
    // Verify modal is closed
    await expect(locModal).not.toHaveClass(/active/);
    
    // Verify location button text changed
    await expect(locBtn).toHaveText('旺角');
    
    // Verify loading state is shown during reload
    await expect(loadingState).toBeVisible();
    
    // Wait for reload to complete
    await Promise.race([
      page.waitForSelector('#rest-list:not(:empty)', { timeout: 10000 }),
      page.waitForSelector('#error-banner.show', { timeout: 10000 })
    ]);
    
    // Verify restaurants are loaded (or error shown)
    const hasRestaurants = await resultList.locator('.rest-card').count() > 0;
    const hasError = await page.locator('#error-banner.show').isVisible();
    expect(hasRestaurants || hasError).toBe(true);
  });
  
  test('should close location modal when clicking outside', async ({ page }) => {
    const locBtn = page.locator('#loc-btn');
    const locModal = page.locator('#loc-modal');
    
    // Open location modal
    await locBtn.click();
    await expect(locModal).toHaveClass(/active/);
    
    // Click outside the modal (on the overlay background)
    await locModal.click({ position: { x: 10, y: 10 } });
    
    // Verify modal is closed
    await expect(locModal).not.toHaveClass(/active/);
  });
  
  test('should show GPS button in location modal', async ({ page }) => {
    const locBtn = page.locator('#loc-btn');
    const gpsBtn = page.locator('#gps-btn');
    const locModal = page.locator('#loc-modal');
    
    // Open location modal
    await locBtn.click();
    await expect(locModal).toHaveClass(/active/);
    
    // Verify GPS button is present
    await expect(gpsBtn).toBeVisible();
    await expect(gpsBtn).toContainText('使用目前位置 (GPS)');
  });
  
  test('should show custom location section in modal', async ({ page }) => {
    const locBtn = page.locator('#loc-btn');
    const addCustomLocBtn = page.locator('#add-custom-loc-btn');
    const customLocSection = page.locator('.custom-section');
    const customLocList = page.locator('#custom-loc-list');
    
    // Open location modal
    await locBtn.click();
    
    // Verify custom location section is present
    await expect(customLocSection).toBeVisible();
    
    // Verify add custom location button is present
    await expect(addCustomLocBtn).toBeVisible();
    await expect(addCustomLocBtn).toContainText('+ 新增地點');
    
    // Verify initial custom location list message
    await expect(customLocList).toContainText('尚未新增自訂地點');
  });
});