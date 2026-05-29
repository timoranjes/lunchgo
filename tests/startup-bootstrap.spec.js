import { test, expect } from '@playwright/test';

test.describe('Startup bootstrap', () => {
  test('should not swallow the following module script when Google is unavailable', async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());

    await page.setContent(`
      <!DOCTYPE html>
      <html lang="zh-HK">
        <head>
          <meta charset="UTF-8" />
          <script src="http://localhost:8080/src/google-bootstrap.js"></script>
        </head>
        <body>
          <script type="module">
            window.__lunchgoBootstrapModuleRan = true;
            const marker = document.createElement('div');
            marker.id = 'after-bootstrap';
            marker.textContent = 'ok';
            document.body.appendChild(marker);
          </script>
        </body>
      </html>
    `);

    await expect(page.locator('#after-bootstrap')).toBeVisible();
    await expect.poll(async () => page.evaluate(() => window.__lunchgoBootstrapModuleRan === true)).toBe(true);
  });

  test('should still render restaurants when Google requests are blocked', async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());

    await page.goto('/');

    await Promise.race([
      page.waitForSelector('#rest-list .rest-card', { timeout: 15000 }),
      page.waitForSelector('#error-banner.show', { timeout: 15000 }),
    ]);

    await expect(page.locator('#rest-list .rest-card')).not.toHaveCount(0);
    await expect(page.locator('#loading-state')).toBeHidden();
    await expect(page.locator('#result-count')).toContainText('間餐廳');

    const ratingSort = page.locator('.toolbar-btn', { hasText: '評分最高' });
    await ratingSort.click();
    await expect(ratingSort).toHaveClass(/active/);

    await page.locator('#search-input').fill('茶');
    await expect(page.locator('#search-clear')).toBeVisible();
    await page.locator('#search-clear').click();
    await expect(page.locator('#search-input')).toHaveValue('');

    await page.locator('#fav-btn').click();
    await expect(page.locator('#fav-page')).toHaveClass(/active/);
    await page.locator('#fav-back').click();

    await page.locator('#loc-btn').click();
    await expect(page.locator('#loc-modal')).toHaveClass(/active/);
    await page.locator('#loc-modal').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('#loc-modal')).not.toHaveClass(/active/);
  });
});
