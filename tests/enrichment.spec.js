import { test, expect } from '@playwright/test';

test.describe('Restaurant enrichment', () => {
  test('should enrich a visible FEHD restaurant without blocking initial render', async ({ page }) => {
    await page.addInitScript(() => {
      window.__lunchgoGoogleStub = {
        nearbySearch: () => ({ status: 'ZERO_RESULTS', results: [] }),
        search: (request) => ({
          status: 'OK',
          delayMs: 150,
          results: [{
            place_id: 'stub_place',
            name: String(request && request.query ? request.query : 'LunchGo Stub Restaurant'),
            vicinity: String(request && request.query ? request.query : '香港中環測試地址'),
          }],
        }),
        getDetails: (request) => {
          if (!request || request.placeId !== 'stub_place') {
            return { status: 'ZERO_RESULTS', details: null };
          }
          return {
            status: 'OK',
            delayMs: 150,
            details: {
              place_id: 'stub_place',
              name: 'LunchGo Stub Restaurant',
              formatted_address: '香港中環測試地址',
              formatted_phone_number: '+852 8300 8007',
              website: 'https://example.com/heng-on',
              rating: 4.2,
              user_ratings_total: 128,
              price_level: 2,
              opening_hours: {
                isOpen: () => true,
                weekday_text: [
                  '星期一: 11:00-22:00',
                  '星期二: 11:00-22:00',
                ],
              },
              photos: [{
                photo_reference: 'stub_photo_ref',
                getUrl: () => 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="240" height="160"%3E%3Crect width="240" height="160" fill="%2307C160"/%3E%3Ctext x="120" y="88" text-anchor="middle" font-size="20" fill="white"%3Ephoto%3C/text%3E%3C/svg%3E',
              }],
              types: ['restaurant', 'chinese'],
              geometry: {
                location: {
                  lat: () => 22.4167715,
                  lng: () => 114.2277168,
                },
              },
            },
          };
        },
      };
    });

    await page.goto('/');
    await page.waitForLoadState('load');

    const listCards = page.locator('.rest-card');
    await expect(listCards.first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#loading-state')).toBeHidden({ timeout: 15000 });

    const fehdCards = page.locator('#rest-list .rest-card[data-id^="fehd_"]');
    await expect(fehdCards.first()).toBeVisible();
    const fehdCardCount = await fehdCards.count();
    expect(fehdCardCount).toBeGreaterThan(0);
    const card = fehdCards.nth(0);

    await card.click();
    await expect(page.locator('#detail-view')).toHaveClass(/active/);

    await page.waitForTimeout(1000);

    await expect(page.locator('#detail-content')).toContainText('4.2');
    await expect(page.locator('#detail-content')).toContainText('+852 8300 8007');
    await expect(page.locator('#detail-content')).toContainText('前往網站');
    await expect(page.locator('#detail-content img.detail-photo')).toHaveCount(1);
    await expect(card).toContainText('4.2');
  });

  test('should keep FEHD address canonical while enriching visible cards', async ({ page }) => {
    await page.addInitScript(() => {
      window.__lunchgoGoogleStub = {
        nearbySearch: () => ({ status: 'ZERO_RESULTS', results: [] }),
        search: (request) => ({
          status: 'OK',
          results: [{
            place_id: 'wan_chai_stub',
            name: '花斑茶社（灣仔店）',
            vicinity: 'Fo Tan, Sha Tin',
          }],
        }),
        getDetails: (request) => {
          if (!request || request.placeId !== 'wan_chai_stub') {
            return { status: 'ZERO_RESULTS', details: null };
          }
          return {
            status: 'OK',
            details: {
              place_id: 'wan_chai_stub',
              name: '花斑茶社（灣仔店）',
              formatted_address: 'Fo Tan, Sha Tin',
              formatted_phone_number: '+852 2333 1122',
              website: 'https://example.com/wanchai',
              rating: 4.0,
              user_ratings_total: 88,
              photos: [],
            },
          };
        },
      };
    });

    await page.goto('/');
    await page.waitForLoadState('load');

    await expect(page.locator('#rest-list .rest-card').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#loading-state')).toBeHidden({ timeout: 15000 });

    const firstCard = page.locator('#rest-list .rest-card').first();
    await firstCard.click();
    await page.waitForTimeout(750);

    const detailText = await page.locator('#detail-content').textContent();
    expect(detailText).toContain('地址');
    expect(detailText).not.toContain('Fo Tan');
  });
});
