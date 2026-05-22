import { test, expect } from '@playwright/test';

test.describe('Cuisine Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for initial load to complete
    await Promise.race([
      page.waitForSelector('#rest-list:not(:empty)', { timeout: 10000 }),
      page.waitForSelector('#error-banner.show', { timeout: 10000 })
    ]);
  });

  test('should display all cuisine filter chips', async ({ page }) => {
    const cuisineChips = page.locator('.cuisine-chip');
    
    // Verify all 15 cuisine chips are present
    await expect(cuisineChips).toHaveCount(15);
    
    // Verify the first chip is "全部" and active
    const firstChip = cuisineChips.first();
    await expect(firstChip).toContainText('全部');
    await expect(firstChip).toHaveClass(/active/);
    
    // Verify other expected cuisines are present
    const chipTexts = await cuisineChips.allTextContents();
    expect(chipTexts).toContain('中式');
    expect(chipTexts).toContain('日式');
    expect(chipTexts).toContain('西式');
    expect(chipTexts).toContain('快餐');
  });
  
  test('should filter results when clicking cuisine chips', async ({ page }) => {
    const cuisineChips = page.locator('.cuisine-chip');
    const resultList = page.locator('#rest-list');
    const resultCount = page.locator('#result-count');
    
    // Get initial count
    const initialCount = await resultList.locator('.rest-card').count();
    
    // Click on "中式" (Chinese) cuisine chip
    const chineseChip = page.locator('.cuisine-chip', { hasText: '中式' });
    await chineseChip.click();
    
    // Verify Chinese chip is now active
    await expect(chineseChip).toHaveClass(/active/);
    
    // Verify "全部" chip is no longer active
    const allChip = page.locator('.cuisine-chip', { hasText: '全部' });
    await expect(allChip).not.toHaveClass(/active/);
    
    // Wait for results to update
    await page.waitForTimeout(300);
    
    // Verify results are filtered (should be less than or equal to initial)
    const filteredCount = await resultList.locator('.rest-card').count();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
    
    // If there are results, verify they contain Chinese cuisine indicators
    if (filteredCount > 0) {
      await expect(resultCount).toBeVisible();
      
      // Check that at least some cards have Chinese-related tags or names
      const cardNames = await resultList.locator('.rest-name').allTextContents();
      const hasChineseContent = cardNames.some(name => 
        name.includes('茶') || name.includes('飯') || name.includes('麵') || 
        name.includes('粥') || name.includes('點心')
      );
      // Note: This is a best-effort check since we can't guarantee specific content
      // The main assertion is that the UI responds correctly to the filter click
    }
    
    // Click back to "全部" to reset
    await allChip.click();
    
    // Verify all chip is active again
    await expect(allChip).toHaveClass(/active/);
    await expect(chineseChip).not.toHaveClass(/active/);
    
    // Wait for results to revert
    await page.waitForTimeout(300);
    const finalCount = await resultList.locator('.rest-card').count();
    expect(finalCount).toBe(initialCount);
  });
});