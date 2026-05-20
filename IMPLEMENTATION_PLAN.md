# LunchGo H5 — 真實餐廳 + 定位方案

## 目標
- 用真實餐廳數據替換 mock data
- 支持預設地點（公司/家）
- 瀏覽器 GPS 定位 → 顯示附近餐廳
- 保持零成本架構

---

## 一、數據來源方案

### 方案 A：OpenStreetMap + Overpass API（推薦）
- **免費**，無需 API key，無配額限制
- 全球覆蓋，香港餐廳數據足夠
- 可過濾類型（restaurant/cafe/fast_food）
- 返回 JSON，自帶 lat/lng/name

**Overpass 查詢示例**：
```
[out:json];
node(around:2000,22.2810,114.1580)[amenity=restaurant];
out body;
```

### 方案 B：混合方案
- Overpass API 作為主力
- 補充 Google Sheets 手動精選列表（評分、推薦語、營業時間）
- 兩邊數據用 restaurant name 匹配合并

### 方案 C：全量預存
- 預先爬取香港主要商圈（中環/灣仔/銅鑼灣/尖沙咀）餐廳
- 存為 JSON 文件，隨頁面包部署
- 配合 Haversine 公式計算距離
- 優點：秒加載，不依賴外部 API
- 缺點：數據需要定期更新

**推薦：A + C 組合**
- 核心商圈預存 JSON（~500 家）→ 秒加載
- Overpass API 作為補充/刷新 → 獲取最新開業餐廳

---

## 二、定位功能

### 1. 瀏覽器 GPS
```javascript
navigator.geolocation.getCurrentPosition(
  (pos) => { lat: pos.coords.latitude, lng: pos.coords.longitude },
  (err) => { fallback to preset location }
)
```

### 2. 預設地點管理
存在 `localStorage`：
```json
{
  "locations": [
    { "label": "公司", "lat": 22.2810, "lng": 114.1580, "isDefault": true },
    { "label": "家", "lat": 22.2750, "lng": 114.1650, "isDefault": false }
  ]
}
```

### 3. 用戶流程
```
首次打開
  → 詢問「允許定位？」
    → 允許 → 用 GPS 座標，提示「是否儲存為公司/家？」
    → 拒絕 → 顯示預設地點列表，可新增/編輯
  → 之後打開
    → GPS 可用 → 自動刷新
    → GPS 不可用 → 用最後一個地點
```

---

## 三、頁面改動

### 新增：地點選擇器（首頁頂部）
```
📍 [中環 IFN ▼]  刷新
```
- 點擊展開預設地點列表
- 顯示當前距離/最後刷新時間
- 「+ 新增地點」→ 地圖選點或當前 GPS

### 改動：餐廳列表
- 從 `MOCK_RESTAURANTS` → `fetchRestaurants(lat, lng, radius)`
- 顯示真實距離、評分、營業時間
- 空狀態：「附近 500m 內沒有餐廳，擴大範圍？」

### 改動：餐廳詳情
- 真實地址
- Google Maps 導航連結
- 營業時間
- 用戶評分（如果有補充數據）

---

## 四、技術架構

```
index.html
  ├── LocationService     (GPS + 預設地點 + localStorage)
  ├── RestaurantDB        (預存 JSON + Overpass fetch + 合并)
  ├── GeoUtils            (Haversine, 範圍過濾)
  ├── RecommendationEngine (評分 + 過濾 + 隨機)
  └── UI Controllers      (頁面渲染)
```

### RestaurantDB 設計
```javascript
class RestaurantDB {
  // 1. 從本地 JSON 加載預存數據（秒級）
  async loadLocal() { ... }
  
  // 2. 從 Overpass API 獲取最新數據
  async fetchOverpass(lat, lng, radius = 2000) { ... }
  
  // 3. 合并兩邊數據（Overpass 優先，本地補充評分/推薦語）
  merge(local, remote) { ... }
  
  // 4. 按距離排序 + 過濾
  query(lat, lng, filters) { ... }
}
```

---

## 五、數據獲取策略

### 第一次加載
1. 從 `restaurants_hk.json` 加載預存數據（~500KB，<1s）
2. 顯示結果，用戶可以立即使用
3. 後台調用 Overpass API 獲取最新數據
4. 合并後更新 localStorage 緩存

### 後續加載
1. 優先讀取 localStorage 緩存（帶時間戳）
2. 緩存 < 24h → 直接用
3. 緩存 > 24h → 後台刷新

### 商圈覆蓋
- 中環 / 金鐘 / 灣仔
- 銅鑼灣 / 太古
- 尖沙咀 / 佐敦 / 旺角
- 觀塘 / 九龍灣
- 每個商圈預存半徑 1km 內的餐廳

---

## 六、實施步驟

| Phase | 內容 | 預估 |
|-------|------|------|
| P1 | 地點選擇器 UI + localStorage 管理 | 1-2h |
| P2 | 瀏覽器 GPS 集成 + 權限處理 | 0.5h |
| P3 | Overpass API 封裝 + 數據解析 | 1h |
| P4 | 預存 JSON 生成（香港商圈 500 家） | 1h |
| P5 | RestaurantDB 合并邏輯 + 緩存策略 | 1h |
| P6 | 餐廳詳情頁改動（真實地址、Maps 導航） | 1h |
| P7 | 推薦算法適配真實數據 | 0.5h |
| P8 | 測試 + 部署 | 0.5h |

**總計：6-7 小時**

---

## 七、風險與緩解

| 風險 | 緩解 |
|------|------|
| Overpass API 響應慢 | 預存數據兜底，永不空白 |
| GPS 精度偏差 | 允許手動調整地點座標 |
| 餐廳已結業 | 用戶反饋機制 + 定期刷新 |
| 包體積過大 | 按商圈分文件，按需加載 |
