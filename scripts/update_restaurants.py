#!/usr/bin/env python3
"""Fetch FEHD restaurant licence data and merge with Overpass API coordinates.

Produces data/hk_restaurants.json for the LunchGo app:
- Primary: FEHD government data (~17K licensed restaurants, bilingual)
- Supplement: Overpass API for coordinates, cuisine, hours, phone
- Output: JSON with lat/lng, cuisine, hours, merged bilingual names

Runs daily via GitHub Actions. Can also be run locally:
  python scripts/update_restaurants.py
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict

# ── Configuration ──────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(SCRIPT_DIR)
OUTPUT_PATH = os.path.join(REPO_DIR, 'data', 'hk_restaurants.json')

FEHD_EN_URL = 'https://www.fehd.gov.hk/english/licensing/license/text/LP_Restaurants_EN.XML'
FEHD_TC_URL = 'https://www.fehd.gov.hk/tc_chi/licensing/license/text/LP_Restaurants_TC.XML'

OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
]

# Hong Kong district code -> info mapping
DISTRICT_MAP = {
    '11': {'en': 'Eastern', 'tc': '東區', 'center': (22.280, 114.220)},
    '12': {'en': 'Wan Chai', 'tc': '灣仔', 'center': (22.278, 114.174)},
    '15': {'en': 'Southern', 'tc': '南區', 'center': (22.240, 114.150)},
    '17': {'en': 'Islands', 'tc': '離島', 'center': (22.250, 114.050)},
    '18': {'en': 'Central/Western', 'tc': '中西區', 'center': (22.285, 114.150)},
    '31': {'en': 'Food Truck', 'tc': '美食車', 'center': (22.290, 114.160)},
    '51': {'en': 'Kwun Tong', 'tc': '觀塘', 'center': (22.315, 114.225)},
    '52': {'en': 'Kowloon City', 'tc': '九龍城', 'center': (22.330, 114.190)},
    '53': {'en': 'Wong Tai Sin', 'tc': '黃大仙', 'center': (22.335, 114.195)},
    '61': {'en': 'Yau Tsim', 'tc': '油尖', 'center': (22.300, 114.170)},
    '62': {'en': 'Mong Kok', 'tc': '旺角', 'center': (22.318, 114.170)},
    '63': {'en': 'Sham Shui Po', 'tc': '深水埗', 'center': (22.333, 114.165)},
    '91': {'en': 'Kwai Tsing', 'tc': '葵青', 'center': (22.360, 114.125)},
    '92': {'en': 'Tsuen Wan', 'tc': '荃灣', 'center': (22.370, 114.110)},
    '93': {'en': 'Tuen Mun', 'tc': '屯門', 'center': (22.395, 114.105)},
    '94': {'en': 'Yuen Long', 'tc': '元朗', 'center': (22.445, 114.025)},
    '95': {'en': 'Tai Po', 'tc': '大埔', 'center': (22.450, 114.170)},
    '96': {'en': 'North', 'tc': '北區', 'center': (22.500, 114.130)},
    '97': {'en': 'Sha Tin', 'tc': '沙田', 'center': (22.380, 114.195)},
    '98': {'en': 'Sai Kung', 'tc': '西貢', 'center': (22.360, 114.260)},
}

LICENCE_TYPES = {
    'RL': 'General Restaurant',
    'RR': 'Light Refreshment',
    'MR': 'Marine Restaurant',
}

# Endorsement code map (from FEHD INFO field)
ENDORSEMENT_MAP = {
    'A': 'Outside Seating',
    'B': 'Karaoke',
    'C': 'Karaoke',
    'D': 'ISO 22000',
    'E': 'Raw Meat',
    'F': 'Raw Oysters',
    'G': 'Sashimi',
    'H': 'Sushi',
}

# Cuisine keyword mapping (english keyword -> normalized slug for LunchGo)
CUISINE_MAP = {
    'chinese': ['chinese', 'cantonese', 'sichuan', 'szechuan', 'hunan', 'shanghai',
                 'beijing', 'dim sum', 'hotpot', 'hot pot', 'congee', '點心', '火鍋', '粵菜'],
    'japanese': ['japanese', 'sushi', 'ramen', 'udon', 'tempura', 'yakitori', 'izakaya',
                 'tonkatsu', 'okonomiyaki', '日式', '壽司', '拉麵'],
    'korean': ['korean', 'kimchi', 'bibimbap', '韓式', '韓國'],
    'thai': ['thai', 'siamese', 'tom yum', '泰式', '泰國'],
    'italian': ['italian', 'pasta', 'pizza', 'risotto', '意式', '意大利'],
    'indian': ['indian', 'tandoori', 'curry', 'nepalese', '印度'],
    'vietnamese': ['vietnamese', 'pho', 'banh mi', '越南'],
    'seafood': ['seafood', 'fish', '海鮮'],
    'burger': ['burger', 'hamburger', '漢堡'],
    'noodles': ['noodle', '麵', '麵食', '麵家'],
    'coffee_shop': ['cafe', 'coffee', 'tea house', 'bubble tea', '珍珠奶茶', '咖啡'],
    'cake': ['cake', 'bakery', 'dessert', 'ice cream', 'gelato', '甜品', '蛋糕'],
    'fast_food': ['fast food', 'fast_food', 'deli', 'takeaway', 'snack', '快餐'],
    'western': ['western', 'american', 'french', 'steak', 'grill', 'european', 'continental', '西式'],
    'asian': ['asian', '亞洲'],
    'malaysian': ['malaysian', 'malay', 'nasi', 'laksa', 'satay', 'nyonya', '星馬'],
}


# ── FEHD Data ──────────────────────────────────────────────────────────────

def fetch_fehd():
    """Fetch FEHD restaurant licence XML data (bilingual)."""
    print('Fetching FEHD restaurant licence data...')

    def parse_xml(url):
        print(f'  Downloading {url.split("/")[-1]}...')
        req = urllib.request.Request(url, headers={
            'User-Agent': 'LunchGo-Bot/1.0 (https://timoranjes.github.io/lunchgo)',
            'Accept': 'application/xml',
        })
        try:
            resp = urllib.request.urlopen(req, timeout=60)
            data = resp.read()
            root = ET.fromstring(data)
        except Exception as e:
            print(f'  ERROR fetching {url}: {e}')
            return {}

        restaurants = {}
        lps = root.find('LPS')
        if lps is None:
            # Try direct children
            lps = root

        for lp in lps.findall('LP'):
            def get(tag):
                el = lp.find(tag)
                return el.text.strip() if el is not None and el.text else ''

            licno = get('LICNO')
            if not licno:
                continue

            info_raw = get('INFO')
            endorsements = []
            if info_raw:
                for char in info_raw.replace('#', ''):
                    char = char.strip()
                    if char in ENDORSEMENT_MAP:
                        endorsements.append(ENDORSEMENT_MAP[char])

            restaurants[licno] = {
                'name': get('SS'),
                'address': get('ADR'),
                'district': get('DIST'),
                'type': get('TYPE'),
                'info': info_raw,
                'endorsements': endorsements,
                'expdate': get('EXPDATE'),
            }

        return restaurants

    en_data = parse_xml(FEHD_EN_URL)
    tc_data = parse_xml(FEHD_TC_URL)

    print(f'  English: {len(en_data)} restaurants')
    print(f'  Chinese: {len(tc_data)} restaurants')

    # Merge by licence number
    merged = {}
    for licno, data in en_data.items():
        merged[licno] = data
        if licno in tc_data:
            merged[licno]['name_tc'] = tc_data[licno]['name']
            merged[licno]['address_tc'] = tc_data[licno]['address']

    # Add TC-only entries
    for licno, data in tc_data.items():
        if licno not in merged:
            merged[licno] = data
            merged[licno]['name_tc'] = data['name']
            merged[licno]['address_tc'] = data['address']

    print(f'  Total unique licences: {len(merged)}')
    return merged


# ── Overpass Data ───────────────────────────────────────────────────────────

def fetch_overpass_all():
    """Fetch all HK restaurant data from Overpass in one query."""
    print('\nFetching Overpass data (all HK)...')

    query = '''[out:json][timeout:180];
area["ISO3166-1"="HK"][admin_level=2]->.hk;
(
  nwr["amenity"="restaurant"](area.hk);
  nwr["amenity"="fast_food"](area.hk);
  nwr["amenity"="cafe"](area.hk);
  nwr["amenity"="food_court"](area.hk);
);
out center qt;'''

    for endpoint in OVERPASS_ENDPOINTS:
        try:
            print(f'  Trying {endpoint}...')
            data = urllib.parse.urlencode({'data': query}).encode()
            req = urllib.request.Request(endpoint, data=data, headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'LunchGo-Bot/1.0',
            })
            resp = urllib.request.urlopen(req, timeout=240)
            result = json.loads(resp.read().decode())

            elements = result.get('elements', [])
            print(f'  Got {len(elements)} elements from Overpass')
            return elements

        except Exception as e:
            print(f'  Endpoint failed: {e}')
            time.sleep(5)

    print('  All Overpass endpoints failed')
    return []


def parse_overpass_element(elem):
    """Parse a single Overpass element into a restaurant dict."""
    tags = elem.get('tags', {})
    name = tags.get('name:zh') or tags.get('name:zh-Hant') or tags.get('name', '')
    if not name:
        return None

    # Get coordinates
    lat = elem.get('lat') or (elem.get('center', {}) or {}).get('lat')
    lng = elem.get('lon') or (elem.get('center', {}) or {}).get('lng')
    if not lat or not lng:
        return None

    return {
        'osm_id': elem.get('id'),
        'osm_type': elem.get('type', ''),
        'name': name,
        'name_en': tags.get('name:en', ''),
        'name_zh': tags.get('name:zh', tags.get('name:zh-Hant', '')),
        'lat': float(lat),
        'lng': float(lng),
        'cuisine_raw': tags.get('cuisine', ''),
        'phone': tags.get('phone', tags.get('contact:phone', '')),
        'website': tags.get('website', tags.get('contact:website', '')),
        'address': tags.get('addr:full', tags.get('addr:street', '')),
        'opening_hours': tags.get('opening_hours', ''),
        'amenity': tags.get('amenity', 'restaurant'),
        'operator': tags.get('operator', ''),
        'brand': tags.get('brand', ''),
        'wheelchair': tags.get('wheelchair', ''),
        'delivery': tags.get('delivery', ''),
        'takeaway': tags.get('takeaway', ''),
        'outdoor_seating': tags.get('outdoor_seating', ''),
    }


# ── Name Normalization / Fuzzy Matching ────────────────────────────────────

def normalize_name(name):
    """Normalize restaurant name for fuzzy matching."""
    if not name:
        return ''
    name = name.lower().strip()
    # Remove common suffixes
    for suffix in ['restaurant', 'cafe', 'coffee shop', 'company limited', 'co., ltd.',
                   '有限公司', '餐廳', '咖啡', '茶餐廳', '小食', '茶餐廳']:
        name = name.replace(suffix, '')
    # Remove special chars
    name = re.sub(r'[^\w\s&\-./]', '', name)
    name = ' '.join(name.split())
    return name


def names_match(name1, name2):
    """Check if two restaurant names likely refer to the same place."""
    n1 = normalize_name(name1)
    n2 = normalize_name(name2)
    if not n1 or not n2:
        return False
    if n1 == n2:
        return True
    # One contains the other (min length to avoid false positives)
    if len(n1) > 3 and n1 in n2:
        return True
    if len(n2) > 3 and n2 in n1:
        return True
    # Common words check for short names
    words1 = set(n1.split())
    words2 = set(n2.split())
    common = words1 & words2
    if len(common) >= 2:
        return True
    return False


# ── Normalize cuisine ──────────────────────────────────────────────────────

def normalize_cuisine(raw):
    """Map raw cuisine string to LunchGo slug."""
    if not raw:
        return 'other'
    lower = raw.lower()
    for slug, keywords in CUISINE_MAP.items():
        for kw in keywords:
            if kw in lower:
                return slug
    # Handle semicolon-separated cuisines: take the first
    if ';' in raw:
        return normalize_cuisine(raw.split(';')[0])
    return 'other'


# ── Merge Logic ────────────────────────────────────────────────────────────

def merge_data(fehd_data, overpass_elements):
    """Merge FEHD government data with Overpass coordinates/metadata."""
    print('\nMerging FEHD + Overpass data...')

    # Parse Overpass elements
    overpass_restaurants = []
    for elem in overpass_elements:
        parsed = parse_overpass_element(elem)
        if parsed:
            overpass_restaurants.append(parsed)

    # Build spatial index for Overpass (district-based grouping)
    overpass_by_district = defaultdict(list)
    for r in overpass_restaurants:
        # Assign district based on coordinates proximity
        best_district = None
        best_dist = float('inf')
        for code, info in DISTRICT_MAP.items():
            dlat = r['lat'] - info['center'][0]
            dlng = r['lng'] - info['center'][1]
            dist = dlat * dlat + dlng * dlng  # Squared distance (no need for sqrt)
            if dist < best_dist:
                best_dist = dist
                best_district = code
        r['_district'] = best_district
        overpass_by_district[best_district].append(r)

    # Merge: FEHD records + Overpass metadata
    restaurants = []
    matched = 0
    unmatched = 0

    for licno, fehd_r in fehd_data.items():
        dist_code = fehd_r['district']
        dist_info = DISTRICT_MAP.get(dist_code, {})
        candidates = overpass_by_district.get(dist_code, [])

        # Try to find a matching Overpass record by name
        best_match = None
        for op_r in candidates:
            fehd_name = fehd_r.get('name_tc') or fehd_r.get('name', '')
            if names_match(fehd_name, op_r.get('name', '')) or \
               names_match(fehd_r.get('name', ''), op_r.get('name_en', '')):
                best_match = op_r
                break

        # Also try matching by normalized name in nearby districts
        if not best_match and dist_code:
            # Search adjacent districts too
            for dc in list(overpass_by_district.keys()):
                for op_r in overpass_by_district[dc]:
                    fehd_name = fehd_r.get('name_tc') or fehd_r.get('name', '')
                    if names_match(fehd_name, op_r.get('name', '')):
                        best_match = op_r
                        break
                if best_match:
                    break

        if best_match:
            matched += 1
            restaurants.append({
                'id': f'fehd_{licno}',
                'name': fehd_r.get('name_tc') or fehd_r.get('name', '') or best_match['name'],
                'name_en': fehd_r.get('name', '') or best_match.get('name_en', ''),
                'name_tc': fehd_r.get('name_tc', ''),
                'lat': best_match['lat'],
                'lng': best_match['lng'],
                'address': fehd_r.get('address_tc') or fehd_r.get('address', '') or best_match.get('address', ''),
                'address_tc': fehd_r.get('address_tc', ''),
                'district': dist_info.get('en', dist_code),
                'district_tc': dist_info.get('tc', ''),
                'cuisine': best_match.get('cuisine_raw', ''),
                'phone': best_match.get('phone', ''),
                'website': best_match.get('website', ''),
                'opening_hours': best_match.get('opening_hours', ''),
                'amenity': 'restaurant',
                'licence_type': LICENCE_TYPES.get(fehd_r.get('type', ''), fehd_r.get('type', '')),
                'endorsements': fehd_r.get('endorsements', []),
                'expiry': fehd_r.get('expdate', ''),
                'source': 'fehd+osm',
                'osm_id': best_match.get('osm_id'),
            })
        else:
            # FEHD-only record — no coordinates from Overpass
            # Estimate coordinates from district center for basic map display
            center = dist_info.get('center', (22.319, 114.169)) if dist_info else (22.319, 114.169)
            # Add small random offset to avoid stacking on district center
            import random
            lat_offset = (random.random() - 0.5) * 0.01  # ~±0.5km
            lng_offset = (random.random() - 0.5) * 0.01

            unmatched += 1
            restaurants.append({
                'id': f'fehd_{licno}',
                'name': fehd_r.get('name_tc') or fehd_r.get('name', ''),
                'name_en': fehd_r.get('name', ''),
                'name_tc': fehd_r.get('name_tc', ''),
                'lat': round(center[0] + lat_offset, 6),
                'lng': round(center[1] + lng_offset, 6),
                'address': fehd_r.get('address_tc') or fehd_r.get('address', ''),
                'address_tc': fehd_r.get('address_tc', ''),
                'district': dist_info.get('en', dist_code),
                'district_tc': dist_info.get('tc', ''),
                'cuisine': '',
                'phone': '',
                'website': '',
                'opening_hours': '',
                'amenity': 'restaurant',
                'licence_type': LICENCE_TYPES.get(fehd_r.get('type', ''), fehd_r.get('type', '')),
                'endorsements': fehd_r.get('endorsements', []),
                'expiry': fehd_r.get('expdate', ''),
                'source': 'fehd_only',
                'osm_id': None,
            })

    # Add Overpass-only restaurants (not in FEHD — might be unlicensed or recently added)
    fehd_ids = {f'fehd_{l}' for l in fehd_data}
    existing_osm_ids = set()
    for r in restaurants:
        if r.get('osm_id'):
            existing_osm_ids.add(r['osm_id'])

    overpass_only = 0
    for op_r in overpass_restaurants:
        if op_r['osm_id'] not in existing_osm_ids:
            overpass_only += 1
            dist_info = DISTRICT_MAP.get(op_r.get('_district', ''), {})
            restaurants.append({
                'id': f"osm_{op_r['osm_id']}" + ('w' if op_r['osm_type'] == 'way' else 'r' if op_r['osm_type'] == 'relation' else ''),
                'name': op_r['name'],
                'name_en': op_r.get('name_en', ''),
                'name_tc': op_r.get('name_zh', ''),
                'lat': op_r['lat'],
                'lng': op_r['lng'],
                'address': op_r.get('address', ''),
                'address_tc': '',
                'district': dist_info.get('en', ''),
                'district_tc': dist_info.get('tc', ''),
                'cuisine': op_r.get('cuisine_raw', ''),
                'phone': op_r.get('phone', ''),
                'website': op_r.get('website', ''),
                'opening_hours': op_r.get('opening_hours', ''),
                'amenity': op_r.get('amenity', 'restaurant'),
                'licence_type': '',
                'endorsements': [],
                'expiry': '',
                'source': 'osm_only',
                'osm_id': op_r.get('osm_id'),
            })

    print(f'  FEHD matched with OSM: {matched}')
    print(f'  FEHD unmatched (no OSM coords): {unmatched}')
    print(f'  Overpass-only (not in FEHD): {overpass_only}')
    print(f'  Total restaurants: {len(restaurants)}')

    return restaurants


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    # Step 1: Fetch FEHD government data
    fehd_data = fetch_fehd()
    if not fehd_data:
        print('ERROR: No FEHD data fetched. Cannot continue.')
        sys.exit(1)

    # Step 2: Fetch Overpass data (coordinates + metadata)
    overpass_elements = fetch_overpass_all()

    # Step 3: Merge datasets
    restaurants = merge_data(fehd_data, overpass_elements)

    # Step 4: Write output
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

    output = {
        'last_updated': time.strftime('%Y-%m-%dT%H:%M:%S+08:00'),
        'total': len(restaurants),
        'with_coordinates': sum(1 for r in restaurants if r.get('lat') and r.get('source') != 'fehd_only'),
        'sources': {
            'fehd': 'https://www.fehd.gov.hk/english/licensing/license/text/LP_Restaurants_EN.XML',
            'overpass': 'https://overpass-api.de/api/interpreter',
        },
        'restaurants': restaurants,
    }

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    total_size = os.path.getsize(OUTPUT_PATH)
    print(f'\nSaved to {OUTPUT_PATH}')
    print(f'File size: {total_size / 1024 / 1024:.1f} MB')
    print(f'Total restaurants: {len(restaurants)}')


if __name__ == '__main__':
    main()