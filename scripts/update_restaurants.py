#!/usr/bin/env python3
"""Fetch FEHD restaurant licence data and merge with Overpass API coordinates.

Produces data/hk_restaurants.json for the LunchGo app:
- Primary: Overpass API (coordinates, cuisine, hours, phone — real data)
- Supplement: FEHD government data (~17K licensed restaurants, bilingual names, licence info)
- Strategy: OSM-first with FEHD enrichment. Query Overpass by district bboxes,
  then look up each OSM restaurant in FEHD by name to attach licence data.

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

# District bounding boxes for targeted Overpass queries
# Format: (south, west, north, east) — enough overlap to catch border cases
DISTRICT_BBOXES = [
    # Hong Kong Island
    ('Central/Western', '中西區', 22.275, 114.135, 22.295, 114.160),
    ('Wan Chai', '灣仔', 22.270, 114.160, 22.285, 114.185),
    ('Eastern', '東區', 22.270, 114.185, 22.295, 114.230),
    ('Southern', '南區', 22.210, 114.120, 22.270, 114.190),
    # Kowloon
    ('Yau Tsim Mong', '油尖旺', 22.295, 114.155, 22.325, 114.180),
    ('Kowloon City', '九龍城', 22.315, 114.175, 22.340, 114.205),
    ('Wong Tai Sin', '黃大仙', 22.330, 114.185, 22.350, 114.215),
    ('Sham Shui Po', '深水埗', 22.320, 114.145, 22.345, 114.175),
    ('Kwun Tong', '觀塘', 22.300, 114.200, 22.335, 114.240),
    # New Territories
    ('Tsuen Wan', '荃灣', 22.355, 114.090, 22.385, 114.125),
    ('Kwai Tsing', '葵青', 22.335, 114.110, 22.370, 114.145),
    ('Tuen Mun', '屯門', 22.380, 114.070, 22.415, 114.110),
    ('Yuen Long', '元朗', 22.425, 113.990, 22.475, 114.055),
    ('Tai Po', '大埔', 22.430, 114.140, 22.475, 114.195),
    ('North', '北區', 22.470, 114.090, 22.530, 114.160),
    ('Sha Tin', '沙田', 22.365, 114.165, 22.410, 114.215),
    ('Sai Kung', '西貢', 22.310, 114.220, 22.385, 114.310),
    ('Islands', '離島', 22.200, 113.950, 22.290, 114.090),
]

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

# Cuisine keyword mapping
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

    # Merge by licence number, build name index for enrichment
    merged = {}
    name_index = defaultdict(list)  # normalized name -> [licno, ...]

    for licno, data in en_data.items():
        merged[licno] = data
        if licno in tc_data:
            merged[licno]['name_tc'] = tc_data[licno]['name']
            merged[licno]['address_tc'] = tc_data[licno]['address']

        # Index by normalized names for lookup
        name_index[normalize_fehd_name(data['name'])].append(licno)
        if licno in tc_data:
            name_index[normalize_fehd_name(tc_data[licno]['name'])].append(licno)

    # Add TC-only entries
    for licno, data in tc_data.items():
        if licno not in merged:
            merged[licno] = data
            merged[licno]['name_tc'] = data['name']
            merged[licno]['address_tc'] = data['address']
            name_index[normalize_fehd_name(data['name'])].append(licno)

    print(f'  Total unique licences: {len(merged)}')
    return merged, name_index


def normalize_fehd_name(name):
    """Normalize FEHD name for lookup."""
    if not name:
        return ''
    name = name.strip().lower()
    # Remove common suffixes
    for suffix in ['restaurant', 'cafe', 'coffee shop', 'company limited', 'co., ltd.',
                   '有限公司', '餐廳', '咖啡', '茶餐廳', '小食']:
        name = name.replace(suffix, '')
    name = re.sub(r'[^\w\s&\-/]', '', name)
    name = ' '.join(name.split())
    return name


# ── Overpass Data (District-by-District) ───────────────────────────────────

def fetch_overpass_by_districts():
    """Fetch OSM restaurant data by district bounding boxes."""
    print('\nFetching Overpass data (district-by-district)...')
    all_elements = []
    
    for name_en, name_tc, south, west, north, east in DISTRICT_BBOXES:
        query = f'''[out:json][timeout:30];
(
  nwr["amenity"="restaurant"]({south},{west},{north},{east});
  nwr["amenity"="fast_food"]({south},{west},{north},{east});
  nwr["amenity"="cafe"]({south},{west},{north},{east});
);
out center qt;'''

        for endpoint in OVERPASS_ENDPOINTS:
            try:
                data = urllib.parse.urlencode({'data': query}).encode()
                req = urllib.request.Request(endpoint, data=data, headers={
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'LunchGo-Bot/1.0',
                })
                resp = urllib.request.urlopen(req, timeout=45)
                result = json.loads(resp.read())
                elements = result.get('elements', [])
                
                # Tag each element with district info
                for elem in elements:
                    elem['_district_en'] = name_en
                    elem['_district_tc'] = name_tc
                
                all_elements.extend(elements)
                print(f'  {name_en}: {len(elements)} elements')
                break  # Success, move to next district

            except Exception as e:
                print(f'  {name_en} failed ({endpoint.split("/")[2]}): {str(e)[:80]}')
                time.sleep(3)
        
        # Rate limit between districts
        time.sleep(1)

    print(f'  Total Overpass elements: {len(all_elements)}')
    return all_elements


def parse_overpass_element(elem):
    """Parse a single Overpass element into a restaurant dict."""
    tags = elem.get('tags', {})
    # Prefer Chinese name, fall back to generic name
    name = tags.get('name:zh') or tags.get('name:zh-Hant') or tags.get('name', '')
    if not name:
        return None

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
        'district_en': elem.get('_district_en', ''),
        'district_tc': elem.get('_district_tc', ''),
    }


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
    if ';' in raw:
        return normalize_cuisine(raw.split(';')[0])
    return 'other'


# ── Merge Logic (OSM-first with FEHD enrichment) ───────────────────────────

def merge_data(fehd_data, fehd_name_index, overpass_elements):
    """Merge: OSM restaurants as primary, enriched with FEHD licence data."""
    print('\nMerging OSM + FEHD data...')

    # Parse Overpass elements
    osm_restaurants = []
    for elem in overpass_elements:
        parsed = parse_overpass_element(elem)
        if parsed:
            osm_restaurants.append(parsed)

    # Deduplicate OSM by osm_id
    seen_osm = set()
    unique_osm = []
    for r in osm_restaurants:
        if r['osm_id'] not in seen_osm:
            seen_osm.add(r['osm_id'])
            unique_osm.append(r)
    osm_restaurants = unique_osm

    # Build FEHD name lookup (normalized name -> list of licences)
    # Try to match OSM names to FEHD records
    matched_fehd_licences = set()
    
    restaurants = []
    osm_with_fehd = 0
    osm_without_fehd = 0

    for osm_r in osm_restaurants:
        # Try to find FEHD match by name
        fehd_licno = None
        
        # Try exact normalized match on Chinese name
        norm_zh = normalize_fehd_name(osm_r.get('name_zh', ''))
        if norm_zh and norm_zh in fehd_name_index:
            # Pick first match (usually the right one)
            for licno in fehd_name_index[norm_zh]:
                if licno not in matched_fehd_licences:
                    fehd_licno = licno
                    break
        
        # Try English name if Chinese didn't match
        if not fehd_licno:
            norm_en = normalize_fehd_name(osm_r.get('name_en', ''))
            if norm_en and norm_en in fehd_name_index:
                for licno in fehd_name_index[norm_en]:
                    if licno not in matched_fehd_licences:
                        fehd_licno = licno
                        break
        
        # Try generic name
        if not fehd_licno:
            norm = normalize_fehd_name(osm_r.get('name', ''))
            if norm and norm in fehd_name_index:
                for licno in fehd_name_index[norm]:
                    if licno not in matched_fehd_licences:
                        fehd_licno = licno
                        break

        if fehd_licno:
            matched_fehd_licences.add(fehd_licno)
            fehd_r = fehd_data[fehd_licno]
            osm_with_fehd += 1
            
            restaurants.append({
                'id': f"osm_{osm_r['osm_id']}",
                'name': osm_r.get('name_zh', '') or osm_r['name'],
                'name_en': osm_r.get('name_en', '') or fehd_r.get('name', ''),
                'name_tc': osm_r.get('name_zh', ''),
                'lat': osm_r['lat'],
                'lng': osm_r['lng'],
                'address': osm_r.get('address', '') or fehd_r.get('address_tc', fehd_r.get('address', '')),
                'address_tc': fehd_r.get('address_tc', ''),
                'district': osm_r.get('district_en', ''),
                'district_tc': osm_r.get('district_tc', ''),
                'cuisine': normalize_cuisine(osm_r.get('cuisine_raw', '')),
                'cuisine_raw': osm_r.get('cuisine_raw', ''),
                'phone': osm_r.get('phone', ''),
                'website': osm_r.get('website', ''),
                'opening_hours': osm_r.get('opening_hours', ''),
                'amenity': osm_r.get('amenity', 'restaurant'),
                'licence_type': LICENCE_TYPES.get(fehd_r.get('type', ''), fehd_r.get('type', '')),
                'endorsements': fehd_r.get('endorsements', []),
                'expiry': fehd_r.get('expdate', ''),
                'source': 'osm+fehd',
                'osm_id': osm_r['osm_id'],
            })
        else:
            osm_without_fehd += 1
            restaurants.append({
                'id': f"osm_{osm_r['osm_id']}",
                'name': osm_r.get('name_zh', '') or osm_r['name'],
                'name_en': osm_r.get('name_en', ''),
                'name_tc': osm_r.get('name_zh', ''),
                'lat': osm_r['lat'],
                'lng': osm_r['lng'],
                'address': osm_r.get('address', ''),
                'address_tc': '',
                'district': osm_r.get('district_en', ''),
                'district_tc': osm_r.get('district_tc', ''),
                'cuisine': normalize_cuisine(osm_r.get('cuisine_raw', '')),
                'cuisine_raw': osm_r.get('cuisine_raw', ''),
                'phone': osm_r.get('phone', ''),
                'website': osm_r.get('website', ''),
                'opening_hours': osm_r.get('opening_hours', ''),
                'amenity': osm_r.get('amenity', 'restaurant'),
                'licence_type': '',
                'endorsements': [],
                'expiry': '',
                'source': 'osm_only',
                'osm_id': osm_r['osm_id'],
            })

    # Add unmatched FEHD records (not found in OSM) with district center coords
    # District center fallback coordinates
    DISTRICT_CENTERS = {
        'Central/Western': (22.285, 114.150),
        'Wan Chai': (22.278, 114.174),
        'Eastern': (22.280, 114.220),
        'Southern': (22.240, 114.150),
        'Islands': (22.250, 114.050),
        'Kwun Tong': (22.315, 114.225),
        'Kowloon City': (22.330, 114.190),
        'Wong Tai Sin': (22.335, 114.195),
        'Yau Tsim': (22.300, 114.170),
        'Mong Kok': (22.318, 114.170),
        'Sham Shui Po': (22.333, 114.165),
        'Kwai Tsing': (22.360, 114.125),
        'Tsuen Wan': (22.370, 114.110),
        'Tuen Mun': (22.395, 114.105),
        'Yuen Long': (22.445, 114.025),
        'Tai Po': (22.450, 114.170),
        'North': (22.500, 114.130),
        'Sha Tin': (22.380, 114.195),
        'Sai Kung': (22.360, 114.260),
        'Food Truck': (22.290, 114.160),
    }

    fehd_only_count = 0
    import random
    for licno, fehd_r in fehd_data.items():
        if licno in matched_fehd_licences:
            continue
        
        dist_code = fehd_r.get('district', '')
        dist_name = None
        for code, info in DISTRICT_CENTERS.items():
            if code.lower().replace('/', '').replace(' ', '') == dist_code.lower().replace('/', '').replace(' ', ''):
                dist_name = code
                break
        
        # If no exact match, try partial
        if not dist_name:
            for code in DISTRICT_CENTERS:
                if dist_code and dist_code in code:
                    dist_name = code
                    break
        
        center = DISTRICT_CENTERS.get(dist_name or '', (22.319, 114.169))
        lat_offset = (random.random() - 0.5) * 0.01
        lng_offset = (random.random() - 0.5) * 0.01

        fehd_only_count += 1
        restaurants.append({
            'id': f'fehd_{licno}',
            'name': fehd_r.get('name_tc', '') or fehd_r.get('name', ''),
            'name_en': fehd_r.get('name', ''),
            'name_tc': fehd_r.get('name_tc', ''),
            'lat': round(center[0] + lat_offset, 6),
            'lng': round(center[1] + lng_offset, 6),
            'address': fehd_r.get('address_tc', '') or fehd_r.get('address', ''),
            'address_tc': fehd_r.get('address_tc', ''),
            'district': dist_name or dist_code,
            'district_tc': '',
            'cuisine': '',
            'cuisine_raw': '',
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

    print(f'  OSM with FEHD enrichment: {osm_with_fehd}')
    print(f'  OSM only (no FEHD match): {osm_without_fehd}')
    print(f'  FEHD only (not in OSM): {fehd_only_count}')
    print(f'  Total restaurants: {len(restaurants)}')

    return restaurants


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    # Step 1: Fetch FEHD government data (for name enrichment)
    fehd_data, fehd_name_index = fetch_fehd()
    if not fehd_data:
        print('ERROR: No FEHD data fetched. Cannot continue.')
        sys.exit(1)

    # Step 2: Fetch Overpass data by district (coordinates + real metadata)
    overpass_elements = fetch_overpass_by_districts()

    # Step 3: Merge — OSM first, enriched with FEHD where names match
    restaurants = merge_data(fehd_data, fehd_name_index, overpass_elements)

    # Step 4: Write output
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

    output = {
        'last_updated': time.strftime('%Y-%m-%dT%H:%M:%S+08:00'),
        'total': len(restaurants),
        'with_coordinates': sum(1 for r in restaurants if r.get('lat') and r.get('source') != 'fehd_only'),
        'with_cuisine': sum(1 for r in restaurants if r.get('cuisine')),
        'with_phone': sum(1 for r in restaurants if r.get('phone')),
        'with_hours': sum(1 for r in restaurants if r.get('opening_hours')),
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
