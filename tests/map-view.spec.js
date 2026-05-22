import { test, expect } from '@playwright/test';

test.describe('Map View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for initial load to complete
    await Promise.race([
      page.waitForSelector('#rest-list:not(:empty)', { timeout: 10000 }),
      page.waitForSelector('#error-banner.show', { timeout: 10000 })
    ]);
  });

  test('should switch to map view when clicking map button', async ({ page }) => {
    const listViewBtn = page.locator('.view-btn', { hasText: '列表' });
    const mapViewBtn = page.locator('.view-btn', { hasText: '地圖' });
    const listView = page.locator('#list-view');
    const mapView = page.locator('#map-view');
    const mapElement = page.locator('#map');
    
    // Verify initial state is list view
    await expect(listViewBtn).toHaveClass(/active/);
    await expect(mapViewBtn).not.toHaveClass(/active/);
    await expect(listView).toBeVisible();
    await expect(mapView).not.toHaveClass(/active/);
    
    // Click map view button
    await mapViewBtn.click();
    
    // Verify view switches to map
    await expect(mapViewBtn).toHaveClass(/active/);
    await expect(listViewBtn).not.toHaveClass(/active/);
    await expect(listView).not.toBeVisible();
    await expect(mapView).toHaveClass(/active/);
    
    // Verify map element is present
    await expect(mapElement).toBeVisible();
    
    // Verify map tile toggle buttons are present
    const tileButtons = page.locator('#map-tile-toggle button');
    await expect(tileButtons).toHaveCount(4);
    await expect(tileButtons.first()).toHaveClass(/active/);
    await expect(tileButtons.first()).toContainText('地圖');
  });
  
  test('should switch between different map types', async ({ page }) => {
    // Switch to map view first
    await page.locator('.view-btn', { hasText: '地圖' }).click();
    
    // Verify default map type is roadmap (地圖)
    let activeTile = page.locator('#map-tile-toggle button.active');
    await expect(activeTile).toContainText('地圖');
    
    // Switch to satellite
    await page.locator('#map-tile-toggle button', { hasText: '衛星' }).click();
    activeTile = page.locator('#map-tile-toggle button.active');
    await expect(activeTile).toContainText('衛星');
    
    // Switch to terrain
    await page.locator('#map-tile-toggle button', { hasText: '地形' }).click();
    activeTile = page.locator('#map-tile-toggle button.active');
    await expect(activeTile).toContainText('地形');
    
    // Switch to hybrid
    await page.locator('#map-tile-toggle button', { hasText: '混合' }).click();
    activeTile = page.locator('#map-tile-toggle button.active');
    await expect(activeTile).toContainText('混合');
    
    // Switch back to roadmap
    await page.locator('#map-tile-toggle button', { hasText: '地圖' }).click();
    activeTile = page.locator('#map-tile-toggle button.active');
    await expect(activeTile).toContainText('地圖');
  });
  
  test('should return to list view when clicking list button', async ({ page }) => {
    // Switch to map view first
    await page.locator('.view-btn', { hasText: '地圖' }).click();
    
    // Verify map view is active
    await expect(page.locator('#map-view')).toHaveClass(/active/);
    
    // Click list view button
    await page.locator('.view-btn', { hasText: '列表' }).click();
    
    // Verify view switches back to list
    await expect(page.locator('#list-view')).toBeVisible();
    await expect(page.locator('#map-view')).not.toHaveClass(/active/);
    await expect(page.locator('.view-btn', { hasText: '列表' })).toHaveClass(/active/);
  });
});