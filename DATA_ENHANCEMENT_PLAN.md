# LunchGo — 香港餐廳數據增強計劃

> **狀態**: 草案 | **日期**: 2026-05-20 | **目標**: 在零 API 配額下，提升餐廳數據的準確性、豐富度和實時性

---

## 現狀

| 項目 | 值 |
|------|------|
| 數據來源 | Overpass API (OpenStreetMap) |
| 餐廳數量 | ~1,861 家 |
| 已有字段 | id, name, name_en, lat, lng, cuisine, phone, website, address, opening_hours, source, amenity |
| 缺失字段 | 評分、價格等級、真實照片、詳細營業時間、實時排隊狀況、今日優惠 |

---

## 方案一：增強 Overpass 查詢（優先級：⭐⭐⭐⭐⭐ 最高）

### 原理
當前查詢只獲取 `node` 類型，遺漏了大量 `way`（建築輪廓）和 `relation`（複雜區域）類型的餐廳。同時，當前查詢可能沒有提取所有可用的 OSM tags。

### 1.1 獲取所有類型（node + way + relation）

**當前查詢（僅 node）**:
```
[out:json];
node(around:2000,22.2810,114.1580)[amenity=restaurant];
out body;
```

**增強查詢（nwr = node + way + relation）**:
```overpass
[out:json][timeout:120];
// 香港全境 bbox
area["ISO3166-1"="HK"][admin_level=2]->.hk;
(
  nwr["amenity"="restaurant"](area.hk);
  nwr["amenity"="cafe"](area.hk);
  nwr["amenity"="fast_food"](area.hk);
  nwr["amenity"="food_court"](area.hk);
  nwr["amenity"="ice_cream"](area.hk);
  nwr["amenity"="bar"](area.hk);
  nwr["amenity"="pub"](area.hk);
  nwr["amenity"="biergarten"](area.hk);
);
out center tags;
```

**關鍵改動**:
- `nwr` 替代 `node`：獲取所有類型
- `out center tags`：對 way/relation 輸出中心坐標 + 所有 tags
- 增加 cafe/fast_food/food_court/bar/pub 等類型
- 使用 `area` 查詢替代 around：可一次獲取全港數據

### 1.2 獲取完整 tags 的查詢

```overpass
[out:json][timeout:120];
area["ISO3166-1"="HK"][admin_level=2]->.hk;
(
  nwr["amenity"="restaurant"](area.hk);
  nwr["amenity"="cafe"](area.hk);
  nwr["amenity"="fast_food"](area.hk);
);
// 輸出所有可用 tags
out center qt;
```

**可用 OSM tags 一覽（餐廳相關）**:

| Tag Key | 示例值 | 說明 | 填充率估計 |
|---------|--------|------|-----------|
| `name` | 譚仔三哥 | 餐廳名稱 | ~95% |
| `name:en` | TamJai SamGor | 英文名稱 | ~60% |
| `name:zh` / `name:zh-Hant` | 譚仔三哥 | 中文名 | ~40% |
| `cuisine` | chinese;italian | 菜系（可多值，分號分隔） | ~30% |
| `diet:vegetarian` | yes | 素食選項 | ~5% |
| `diet:halal` | yes | 清真 | ~2% |
| `opening_hours` | Mo-Fr 11:00-22:00 | 營業時間 | ~15-20% |
| `phone` / `contact:phone` | +852 2549 1862 | 電話 | ~25% |
| `website` / `contact:website` | https://... | 網站 | ~20% |
| `addr:full` / `addr:street` | 威靈頓街 | 地址 | ~40% |
| `level` / `floor` | 0 / 1 | 樓層 | ~10% |
| `wheelchair` | yes/limited/no | 無障礙設施 | ~5% |
| `internet_access` | wlan/wired | WiFi | ~8% |
| `smoking` | no/outside/yes | 吸煙政策 | ~5% |
| `outdoor_seating` | yes | 戶外座位 | ~5% |
| `delivery` | yes/no | 外賣 | ~10% |
| `takeaway` | yes/no | 外帶 | ~10% |
| `air_conditioning` | yes | 冷氣 | ~5% |
| `ref:wikipedia` | zh:譚仔三哥 | Wikipedia 條目 | ~2% |
| `wikidata` | Q7812345 | Wikidata ID | ~3% |
| `operator` | 美心集團 | 運營商 | ~10% |
| `brand` / `brand:wikidata` | McDonald's / Q38076 | 品牌 | ~15% |
| `check_date` | 2024-01-15 | 最後驗證日期 | ~5% |
| `start_date` | 2020-03-01 | 開業日期 | ~3% |
| `end_date` | 2024-06-30 | 結業日期 | ~1% |

### 1.3 推薦的最終 Overpass 查詢

```overpass
[out:json][timeout:180];
// 全港範圍
area["ISO3166-1"="HK"][admin_level=2]->.hk;

// 收集所有餐飲類型
(
  nwr["amenity"="restaurant"](area.hk);
  nwr["amenity"="cafe"](area.hk);
  nwr["amenity"="fast_food"](area.hk);
  nwr["amenity"="food_court"](area.hk);
  nwr["amenity"="bar"](area.hk);
  nwr["amenity"="pub"](area.hk);
  nwr["amenity"="biergarten"](area.hk);
);

// 去重（同一地點可能有多個 tag）
out center qt;
```

**執行方式**:
```bash
# 直接 curl 調用
curl -G "https://overpass-api.de/api/interpreter" \
  --data-urlencode 'data=[out:json][timeout:180];area["ISO3166-1"="HK"][admin_level=2]->.hk;(nwr["amenity"="restaurant"](area.hk);nwr["amenity"="cafe"](area.hk);nwr["amenity"="fast_food"](area.hk);nwr["amenity"="food_court"](area.hk);nwr["amenity"="bar"](area.hk);nwr["amenity"="pub"](area.hk);nwr["amenity"="biergarten"](area.hk););out center qt;' \
  -o restaurants_enhanced.json
```

### 限制分析

| 項目 | 詳情 |
|------|------|
| **費用** | 完全免費 |
| **配額限制** | 官方實例 (overpass-api.de) 約 10,000 請求/天，單次查詢 timeout 通常 180s |
| **查詢大小** | 單次查詢返回結果建議 < 50MB，全港餐廳約 10-20MB JSON |
| **備用實例** | `lz4.overpass-api.de`, `z.overpass-api.de` |
| **風險** | 公共實例可能限流；建議使用自建 Overpass 實例或輪流使用多個 endpoint |
| **數據新鮮度** | OSM 數據更新頻率不一，香港區域相對活躍 |

---

## 方案二：免費第三方 API（優先級：⭐⭐⭐）

### 2.1 Google Places API

**新定價制度（2025年3月起）**:

| SKU | 免費額度/月 | 單價（Essentials） |
|-----|-----------|-------------------|
| Place Details (Essentials) | **10,000 次** | $0.017/次 |
| Nearby Search (Essentials) | **10,000 次** | $0.032/次 |
| Text Search (Essentials) | **10,000 次** | $0.032/次 |
| Basic Data (name, address, location) | 免費包含 | — |
| Atmosphere Data (rating, reviews, photos) | 額外收費 | — |

**結論**: 新制度下需要綁定信用卡，且免費額度僅限 "Basic Data"。評分、照片等 "Atmosphere Data" 需額外付費。**不適合零配額場景**。

**但如果能申請**:
```bash
# Nearby Search (New) — 獲取附近餐廳
curl "https://places.googleapis.com/v1/places:searchNearby" \
  -H "Content-Type: application/json" \
  -H "X-Goog-Api-Key: YOUR_API_KEY" \
  -d '{
    "includedTypes": ["restaurant", "cafe"],
    "maxResultCount": 20,
    "locationRestriction": {
      "circle": {
        "center": {"latitude": 22.2810, "longitude": 114.1580},
        "radius": 2000.0
      }
    },
    "rankPreference": "POPULARITY"
  }'

# Place Details (New) — 獲取詳情（評分、照片等）
curl "https://places.googleapis.com/v1/places/ChIJN1t_tDeuEmsRUsoyG83frY4" \
  -H "X-Goog-Api-Key: YOUR_API_KEY" \
  -H "X-Goog-FieldMask: displayName,rating,userRatingCount,photos,openingHours,websiteUri,internationalPhoneNumber,priceLevel"
```

### 2.2 Yelp Fusion API

**現狀**: Yelp Fusion API 已取消免費層，改為付費計劃：
- Starter Plan: $7.99/1,000 次調用
- Plus Plan: $9.99/1,000 次調用
- Trial: **300 次/天**（僅限 Starter Plan 試用期）

**結論**: 300 次/天的額度太少，且僅限試用期。**不推薦**。

### 2.3 Foursquare Places API

**免費層**: 10,000 次/月 Pro endpoint（含基本場所信息）

| 端點 | 免費 | 說明 |
|------|------|------|
| Search Pro | ✅ 免費 | 場所搜索 |
| Place Details Pro | ✅ 免費 | 基本信息 |
| Photos | ❌ Premium | 照片需付費 |
| Ratings/Tips | ❌ Premium | 評分需付費 |
| Hours | ❌ Premium (部分) | 營業時間部分免費 |

**2026年6月起新政策**: 免費 Pro calls 降至 **500 次/月**

**結論**: 目前免費額度可用，但 Premium 字段（照片、評分）需付費。可用於場所搜索和基本信息補充，**不適合獲取評分和照片**。

```bash
# Foursquare Places API v3 — 搜索附近餐廳
curl "https://api.foursquare.com/v3/places/search?ll=22.2810,114.1580&categories=13000&radius=2000&limit=50" \
  -H "Accept: application/json" \
  -H "Authorization: YOUR_API_KEY"

# Place Details — 基本信息（免費 Pro 層）
curl "https://api.foursquare.com/v3/places/PLACE_ID" \
  -H "Accept: application/json" \
  -H "Authorization: YOUR_API_KEY"
```

### 2.4 TripAdvisor Content API

**免費層**: 
- 開發階段: **1,000 次/天**（需申請 provisional key）
- 上線後: 25,000 次/天（mapper key）
- 需要申請、審核、綁定信用卡
- 僅限展示用途（必須顯示 TripAdvisor 品牌）

**可獲取數據**: 名稱、地址、評分、最多 5 條評論、最多 5 張照片

```bash
# Location Search
curl "https://api-content.tripadvisor.com/1.0/location/search?searchQuery=restaurant&latLong=22.2810,114.1580&radius=5&key=YOUR_KEY"

# Location Details（含評分和照片）
curl "https://api-content.tripadvisor.com/1.0/location/LOCATION_ID/details?key=YOUR_KEY&language=en&currency=HKD"
```

**結論**: 免費額度充足，但申請流程繁瑣，且數據主要針對旅遊景點而非日常餐廳。**可作為補充選項**。

### 2.5 免費 API 對比總結

| API | 免費額度 | 評分 | 照片 | 營業時間 | 推薦度 |
|-----|---------|------|------|---------|--------|
| Google Places | 10K/月 (Basic only) | ❌ 付費 | ❌ 付費 | ✅ | ⭐⭐ |
| Yelp Fusion | 300/天 (trial only) | ✅ | ✅ | ✅ | ⭐ |
| Foursquare | 10K/月 Pro (500/月 soon) | ❌ 付費 | ❌ 付費 | 部分 | ⭐⭐ |
| TripAdvisor | 1K-25K/天 | ✅ | ✅ (5張) | ✅ | ⭐⭐⭐ |
| **Overpass (增強)** | **無限** | ❌ | ❌ | 部分 | ⭐⭐⭐⭐⭐ |

---

## 方案三：爬取公開頁面（優先級：⭐⭐⭐⭐）

### 3.1 OpenRice 爬取方案

OpenRice 是香港最大的餐廳點評平台，擁有最全面的香港餐廳數據。

**可獲取數據**:
- 餐廳評分（口味、環境、服務）
- 人均消費（$ / $$ / $$$ / $$$$）
- 真實用戶照片
- 營業時間
- 菜式類型
- 地址、電話
- 用戶評論

**參考開源項目**: [cal65/Open-Rice](https://github.com/cal65/Open-Rice) — 已有的 OpenRice 爬取腳本

**爬取策略**:
```python
import requests
from bs4 import BeautifulSoup
import time
import json

# OpenRice 搜索頁面結構
# https://www.openrice.com/zh/hongkong/restaurant-list.htm?
#   &district_id=1019&cuisine_id=...&page=1

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Accept-Language': 'zh-HK,zh-TW,zh-CN,zh;q=0.9,en;q=0.8',
}

def scrape_openrice_listings(district_id, page=1):
    """爬取 OpenRice 餐廳列表頁"""
    url = f"https://www.openrice.com/zh/hongkong/restaurant-list.htm?district_id={district_id}&page={page}"
    resp = requests.get(url, headers=HEADERS)
    soup = BeautifulSoup(resp.text, 'html.parser')
    
    restaurants = []
    for item in soup.select('.sr2-listing-item'):
        r = {
            'name': item.select_one('.name a')?.text.strip(),
            'cuisine': item.select_one('.cuisine-type')?.text.strip(),
            'price': item.select_one('.price-range')?.text.strip(),
            'rating': item.select_one('.smile-icon')?.get('title'),
            'address': item.select_one('.address')?.text.strip(),
            'district': item.select_one('.district')?.text.strip(),
        }
        restaurants.append(r)
    
    return restaurants

def scrape_openrice_detail(restaurant_url):
    """爬取餐廳詳情頁"""
    resp = requests.get(restaurant_url, headers=HEADERS)
    soup = BeautifulSoup(resp.text, 'html.parser')
    
    return {
        'name': soup.select_one('.restaurant-name')?.text.strip(),
        'overall_rating': soup.select_one('.overall-score')?.text.strip(),
        'taste_rating': soup.select_one('.taste-score')?.text.strip(),
        'environment_rating': soup.select_one('.environment-score')?.text.strip(),
        'service_rating': soup.select_one('.service-score')?.text.strip(),
        'avg_price': soup.select_one('.avg-price')?.text.strip(),
        'opening_hours': soup.select_one('.opening-hours')?.text.strip(),
        'phone': soup.select_one('.phone')?.text.strip(),
        'address': soup.select_one('.address')?.text.strip(),
        'photos': [img['src'] for img in soup.select('.photo-gallery img')[:10]],
        'reviews': scrape_reviews(soup),
    }
```

**香港主要區 ID 映射**:
| 地區 | district_id |
|------|------------|
| 中環 | 1019 |
| 灣仔 | 1020 |
| 銅鑼灣 | 1021 |
| 尖沙咀 | 1022 |
| 旺角 | 1023 |
| 觀塘 | 1024 |
| 全港 | 使用搜索 API |

**風險分析**:

| 風險 | 說明 | 緩解措施 |
|------|------|---------|
| 法律風險 | 可能違反 OpenRice ToS | 僅做研究用途，不商業化；控制爬取頻率 |
| 反爬機制 | Cloudflare、rate limiting | 隨機 User-Agent、控制頻率（1 請求/3-5 秒） |
| 結構變更 | HTML 結構可能改變 | 定期驗證爬取腳本 |
| IP 封鎖 | 短時間內大量請求 | 使用代理、限制頻率 |
| 數據量 | 全港 ~30,000+ 餐廳 | 分批爬取，僅爬取核心商圈 |

### 3.2 Google Maps 爬取方案

**開源工具**: [gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper) — Go 語言實現，免費

**可獲取數據**:
- 餐廳名稱、地址、電話
- 評分、評論數量
- 營業時間
- 網站
- 照片 URL

```bash
# 使用開源 Google Maps Scraper
git clone https://github.com/gosom/google-maps-scraper.git
cd google-maps-scraper

# 配置文件 (searches.csv)
# query,lat,lng,zoom
# 餐廳 中環,22.2810,114.1580,15
# 餐廳 灣仔,22.2780,114.1740,15

# 運行
go run main.go -searches searches.csv -output results.json
```

**風險**: 同上，可能違反 Google ToS。但開源工具已做反爬處理。

### 3.3 推薦的爬取策略

```
Phase 1: 核心商圈 (1-2 天)
  ├─ 中環、灣仔、銅鑼灣、尖沙咀
  ├─ 每個商圈 ~500-1000 家餐廳
  └─ 預計獲取 ~3,000 家餐廳詳情

Phase 2: 擴充區域 (3-5 天)
  ├─ 旺角、觀塘、沙田、荃灣等
  └─ 預計獲取 ~5,000+ 家餐廳詳情

Phase 3: 持續更新 (每周)
  ├─ 僅爬取新開業/已結業餐廳
  └─ 更新評分和營業時間
```

---

## 方案四：Wikidata 增強（優先級：⭐⭐⭐⭐）

### 原理
部分 OSM 餐廳條目帶有 `wikidata` tag，可通過 Wikidata SPARQL 查詢獲取：
- Wikipedia 條目
- 官方網站
- Logo/圖片（來自 Wikimedia Commons）
- 開業日期
- 更多結構化數據

**完全免費，無需 API key，無配額限制。**

### SPARQL 查詢示例

```sparql
# 獲取香港餐廳的 Wikidata 信息
SELECT ?item ?itemLabel ?restaurantName ?cuisine ?image ?website ?inception ?rating
WHERE {
  ?item wdt:P31/wdt:P279* wd:Q11707;  # 餐廳或子類
        wdt:P17 wd:Q8646;               # 位於香港
  OPTIONAL { ?item wdt:P856 ?website. }
  OPTIONAL { ?item wdt:P20135 ?rating. }  # 評分（部分條目有）
  OPTIONAL { ?item wdt:P18 ?image. }     # 圖片
  OPTIONAL { ?item wdt:P571 ?inception. } # 開業日期
  OPTIONAL { ?item wdt:P20135 ?rating. }  # 評分
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "zh,en".
    ?item rdfs:label ?restaurantName.
  }
}
LIMIT 500
```

**API 端點**:
```bash
curl -G "https://query.wikidata.org/sparql" \
  --data-urlencode "query=SELECT ?item ?itemLabel ?website ?image WHERE { ?item wdt:P31 wd:Q11707; wdt:P17 wd:Q8646. OPTIONAL { ?item wdt:P856 ?website. } OPTIONAL { ?item wdt:P18 ?image. } SERVICE wikibase:label { bd:serviceParam wikibase:language 'zh,en'. } } LIMIT 100" \
  -H "Accept: application/sparql-results+json"
```

### OSM → Wikidata 關聯
```javascript
// 從 OSM 數據中提取有 wikidata tag 的餐廳
const osmRestaurants = require('./restaurants_hk.json');
const wikidataIds = osmRestaurants
  .filter(r => r.tags && r.tags.wikidata)
  .map(r => r.tags.wikidata);

// 批量查詢 Wikidata
const wikidataQuery = `
SELECT ?item ?itemLabel ?website ?image ?description
WHERE {
  VALUES ?item { ${wikidataIds.map(id => `wd:${id}`).join(' ')} }
  OPTIONAL { ?item wdt:P856 ?website. }
  OPTIONAL { ?item wdt:P18 ?image. }
  OPTIONAL { ?item schema:description ?description. FILTER(LANG(?description) = "zh" || LANG(?description) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "zh,en". }
}
`;
```

### 限制

| 項目 | 詳情 |
|------|------|
| 費用 | 完全免費 |
| 覆蓋率 | 僅 ~3-5% 的香港餐廳有 Wikidata 條目 |
| 適用場景 | 主要對知名連鎖店、米其林餐廳有效 |
| 數據新鮮度 | 維基社區維護，更新較慢 |

---

## 方案五：實時排隊/等候時間（優先級：⭐⭐）

### 5.1 可行性分析

**結論：目前無免費、可靠的公開 API 可獲取實時排隊時間。**

| 數據來源 | 實時排隊 | 免費 | 說明 |
|---------|---------|------|------|
| Google Maps Popular Times | ✅ 有 | ❌ 官方 API 不支持 | Google Maps 界面顯示，但 Places API 不返回此數據 |
| 非官方爬取 | ✅ 可獲取 | ✅ | 使用 LivePopularTimes 等庫，但違反 ToS |
| OSM | ❌ 無 | — | OSM 不存儲實時數據 |
| 用戶回報 | ✅ 可實現 | ✅ | 自建用戶回報系統 |

### 5.2 替代方案

#### 方案 A: 非官方 Google Popular Times 爬取

**開源庫**: [LivePopularTimes](https://github.com/GrocerCheck/LivePopularTimes)

```python
from livepopulartimes import get_populartimes_by_address

# 獲取餐廳的熱門時段和等候時間
result = get_populartimes_by_address("香港中環威靈頓街 100 號")
# 返回: current_popularity, wait_time, popular_times (hourly), time_spent
```

**限制**:
- 需要餐廳的精確地址
- 爬取 Google Maps 頁面，違反 ToS
- 可能被封 IP
- 僅支持部分知名餐廳

#### 方案 B: 自建用戶回報系統（推薦）

在 LunchGo H5 中添加簡單的用戶回報功能：

```javascript
// 用戶回報當前排隊狀況
function reportWaitTime(restaurantId, waitTime) {
  // waitTime: 0=無需等候, 1=1-15分鐘, 2=15-30分鐘, 3=30-60分鐘, 4=>60分鐘
  fetch('/api/report-wait', {
    method: 'POST',
    body: JSON.stringify({
      restaurant_id: restaurantId,
      wait_level: waitTime,
      timestamp: Date.now(),
      user_id: getUserId() // 匿名 ID
    })
  });
}

// 獲取近期回報的平均等候時間
function getRecentWaitTime(restaurantId) {
  // 獲取過去 2 小時內的回報，計算平均
  // 超過 2 小時的數據自動過期
}
```

**實現**:
- 使用 localStorage 或免費 Firebase Realtime Database
- 匿名 ID（不收集個人信息）
- 數據過期機制（2 小時）
- 簡單 UI：點擊即可回報「當前等候時間」

---

## 推薦執行方案

### Phase 1: 立即執行（1-2 天）— 增強 Overpass

1. **更新 Overpass 查詢** → 獲取 node + way + relation，包含所有 tags
2. **增加餐飲類型** → cafe, fast_food, food_court, bar, pub
3. **解析更多字段** → opening_hours, level, wheelchair, internet_access, delivery, takeaway
4. **預期效果**: 從 1,861 家增至 ~3,000+ 家，字段填充率提升 30-50%

### Phase 2: 短期執行（1 周）— Wikidata 增強

1. **提取 wikidata tag** → 從 OSM 數據中提取所有 wikidata ID
2. **批量查詢 Wikidata** → 獲取圖片、網站、描述等
3. **合并數據** → 將 Wikidata 信息關聯到 OSM 餐廳
4. **預期效果**: ~100-200 家知名餐廳獲得圖片和更多信息

### Phase 3: 中期執行（1-2 周）— OpenRice/Google Maps 爬取

1. **爬取核心商圈** → 中環、灣仔、銅鑼灣、尖沙咀
2. **數據匹配** → 用餐廳名稱 + 地址匹配 OSM 數據
3. **補充評分和照片** → 將 OpenRice 評分、人均消費、照片 URL 關聯
4. **預期效果**: 核心商圈餐廳獲得評分、價格、照片

### Phase 4: 長期（持續）— 用戶回報系統

1. **添加回報 UI** → 簡單的「當前等候時間」按鈕
2. **數據存儲** → Firebase 或本地 JSON
3. **展示邏輯** → 顯示近期平均等候時間
4. **預期效果**: 逐步建立實時數據庫

---

## 數據匹配策略

多來源數據需要统一匹配：

```javascript
function matchRestaurants(osmRestaurant, externalData) {
  // 1. 精確匹配（name + lat/lng 在 50m 內）
  if (osmRestaurant.name === externalData.name &&
      haversine(osmRestaurant.lat, osmRestaurant.lng,
                externalData.lat, externalData.lng) < 0.05) {
    return 'exact';
  }
  
  // 2. 模糊匹配（name 相似度 > 0.8 + 距離 < 200m）
  if (similarity(osmRestaurant.name, externalData.name) > 0.8 &&
      haversine(osmRestaurant.lat, osmRestaurant.lng,
                externalData.lat, externalData.lng) < 0.2) {
    return 'fuzzy';
  }
  
  // 3. 電話匹配
  if (osmRestaurant.phone && externalData.phone &&
      normalizePhone(osmRestaurant.phone) === normalizePhone(externalData.phone)) {
    return 'phone';
  }
  
  return null;
}
```

---

## 風險與注意事項

| 風險 | 影響 | 緩解 |
|------|------|------|
| OSM 數據不完整 | 部分餐廳缺少關鍵字段 | 多來源補充 |
| 爬取被封 IP | 無法獲取外部數據 | 控制頻率、使用代理 |
| 數據匹配錯誤 | 錯誤關聯評分/照片 | 多條件匹配 + 人工抽查 |
| 實時數據不可靠 | 用戶回報不準確 | 多用戶交叉驗證 |
| 法律合規 | 爬取可能違反 ToS | 控制頻率、非商業用途 |

---

## 總結推薦

| 優先級 | 方案 | 成本 | 難度 | 收益 |
|--------|------|------|------|------|
| ⭐⭐⭐⭐⭐ | 增強 Overpass 查詢 | 免費 | 低 | 高（餐廳數量+50%，字段+30%） |
| ⭐⭐⭐⭐ | Wikidata 增強 | 免費 | 低 | 中（知名餐廳獲圖片） |
| ⭐⭐⭐⭐ | OpenRice 爬取 | 免費 | 中 | 高（評分、價格、照片） |
| ⭐⭐⭐ | Foursquare API | 免費（10K/月） | 低 | 中（基本信息驗證） |
| ⭐⭐ | TripAdvisor API | 免費（需申請） | 中 | 中（評分、照片） |
| ⭐⭐ | Google Maps 爬取 | 免費 | 中 | 高（評分、照片、營業時間） |
| ⭐ | 用戶回報系統 | 免費 | 中 | 高（實時數據，但需時間積累） |

**最佳組合**: 增強 Overpass（主力） + Wikidata（知名餐廳圖片） + OpenRice 爬取（評分/照片）
