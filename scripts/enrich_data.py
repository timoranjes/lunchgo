#!/usr/bin/env python3
"""Enrich LunchGo restaurant data by merging FEHD licence data with Overpass tags.

Strategy:
1. Fetch fresh FEHD data (authoritative names, addresses, licence info)
2. Fetch Overpass data (cuisine, phone, hours, website, exact coordinates)
3. Multi-strategy merge: exact name match > address proximity + name similarity
4. Output district-chunked compact JSON with enriched fields
"""

import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from difflib import SequenceMatcher

# ── Configuration ──────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(REPO_DIR, 'data')

FEHD_EN_URL = 'https://www.fehd.gov.hk/english/licensing/license/text/LP_Restaurants_EN.XML'
FEHD_TC_URL = 'https://www.fehd.gov.hk/tc_chi/licensing/license/text/LP_Restaurants_TC.XML'

OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://z.overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
]

# HK bounding box: south, west, north, east
HK_BOUNDS = (22.11, 113.83, 22.57, 114.43)

DISTRICT_MAP = {
    '11': {'en': 'Eastern', 'tc': '東區', 'center': (22.280, 114.220)},
    '12': {'en': 'Wan Chai', 'tc': '灣仔', 'center': (22.278, 114.174)},
    '15': {'en': 'Southern', 'tc': '南區', 'center': (22.240, 114.150)},
    '17': {'en': 'Islands', 'tc': '離島', 'center': (22.250, 114.050)},
    '18': {'en': 'Central/Western', 'tc': '中西區', 'center': (22.285, 114.150)},
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

ENDORSEMENT_MAP = {
    'A': 'Outside Seating', 'B': 'Karaoke', 'C': 'Karaoke',
    'D': 'ISO 22000', 'E': 'Raw Meat', 'F': 'Raw Oysters',
    'G': 'Sashimi', 'H': 'Sushi',
}

# Schema for compact output
FIELDS = [
    'id', 'name', 'name_en', 'lat', 'lng', 'address',
    'district', 'district_tc', 'licence_type', 'expiry',
    'cuisine', 'phone', 'website', 'opening_hours',
    'amenity', 'source'
]


# ── FEHD Data ──────────────────────────────────────────────────────────────

def fetch_fehd():
    """Fetch FEHD restaurant licence data (bilingual)."""
    print('Fetching FEHD restaurant licence data...')

    def parse_xml(url):
        print(f'  Downloading {url.split("/")[-1]}...')
        req = urllib.request.Request(url, headers={
            'User-Agent': 'LunchGo-Bot/2.0',
            'Accept': 'application/xml',
        })
        try:
            resp = urllib.request.urlopen(req, timeout=60)
            root = ET.fromstring(resp.read())
        except Exception as e:
            print(f'  ERROR: {e}')
            return {}

        restaurants = {}
        lps = root.find('LPS') or root
        for lp in lps.findall('LP'):
            def get(tag):
                el = lp.find(tag)
                return el.text.strip() if el is not None and el.text else ''

            licno = get('LICNO')
            if not licno:
                continue

            endorsements = []
            info_raw = get('INFO')
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
                'endorsements': endorsements,
                'expdate': get('EXPDATE'),
            }
        return restaurants

    en_data = parse_xml(FEHD_EN_URL)
    tc_data = parse_xml(FEHD_TC_URL)
    print(f'  EN: {len(en_data)}, TC: {len(tc_data)}')

    merged = {}
    for licno, data in en_data.items():
        merged[licno] = data
        if licno in tc_data:
            merged[licno]['name_tc'] = tc_data[licno]['name']
            merged[licno]['address_tc'] = tc_data[licno]['address']
    for licno, data in tc_data.items():
        if licno not in merged:
            merged[licno] = data
            merged[licno]['name_tc'] = data['name']
            merged[licno]['address_tc'] = data['address']

    print(f'  Total unique: {len(merged)}')
    return merged


# ── Overpass Data ──────────────────────────────────────────────────────────

def fetch_overpass():
    """Fetch all HK restaurant/cafe/fast_food data from Overpass."""
    print('\nFetching Overpass data...')

    s, w, n, e = HK_BOUNDS
    query = f'''[out:json][timeout:180];
(
  nwr["amenity"="restaurant"]({s},{w},{n},{e});
  nwr["amenity"="fast_food"]({s},{w},{n},{e});
  nwr["amenity"="cafe"]({s},{w},{n},{e});
);
out center qt;'''

    for endpoint in OVERPASS_ENDPOINTS:
        try:
            print(f'  Trying {endpoint}...')
            req = urllib.request.Request(
                endpoint,
                data=query.encode('utf-8'),
                headers={
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'LunchGo HK Restaurant Finder (https://timoranjes.github.io/lunchgo; contact:liaozicheng@gmail.com)',
                },
                method='POST',
            )
            resp = urllib.request.urlopen(req, timeout=240)
            result = json.loads(resp.read().decode())
            elements = result.get('elements', [])
            print(f'  Got {len(elements)} elements')
            return elements
        except Exception as e:
            print(f'  Failed: {e}')
            time.sleep(5)

    print('  All endpoints failed')
    return []


def parse_osm_element(elem):
    """Parse Overpass element into dict with cuisine, phone, hours, etc."""
    tags = elem.get('tags', {})
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
        'lat': float(lat),
        'lng': float(lng),
        'cuisine': tags.get('cuisine', ''),
        'phone': tags.get('phone', tags.get('contact:phone', '')),
        'website': tags.get('website', tags.get('contact:website', '')),
        'address': tags.get('addr:full', tags.get('addr:street', tags.get('addr:interpolation', ''))),
        'opening_hours': tags.get('opening_hours', ''),
        'amenity': tags.get('amenity', 'restaurant'),
    }


# ── Name Matching ──────────────────────────────────────────────────────────

def normalize_name(name):
    """Strip common suffixes for matching."""
    if not name:
        return ''
    name = name.lower().strip()
    for sfx in ['restaurant', 'cafe', 'coffee shop', 'limited', 'company',
                '餐廳', '咖啡', '茶餐廳', '小食店', '酒家', '飯店']:
        name = name.replace(sfx, '')
    name = re.sub(r'[^\w\s&\-./]', '', name)
    return ' '.join(name.split())


def name_similarity(a, b):
    """Return similarity score 0-1 between two names."""
    n1, n2 = normalize_name(a), normalize_name(b)
    if not n1 or not n2:
        return 0
    if n1 == n2:
        return 1.0
    if len(n1) > 2 and n1 in n2:
        return 0.9
    if len(n2) > 2 and n2 in n1:
        return 0.9
    return SequenceMatcher(None, n1, n2).ratio()


# ── Spatial Index ──────────────────────────────────────────────────────────

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def assign_district(lat, lng):
    """Assign district code based on nearest district center."""
    best_code = None
    best_dist = float('inf')
    for code, info in DISTRICT_MAP.items():
        d = haversine_km(lat, lng, info['center'][0], info['center'][1])
        if d < best_dist:
            best_dist = d
            best_code = code
    return best_code if best_dist < 50 else None  # Within 50km of a center


# ── Merge ──────────────────────────────────────────────────────────────────

def merge(fehd_data, osm_elements):
    """Multi-strategy merge: exact match > proximity + name > OSM-only."""
    print('\nMerging data...')

    # Parse OSM elements
    osm_places = []
    for elem in osm_elements:
        p = parse_osm_element(elem)
        if p:
            p['_district'] = assign_district(p['lat'], p['lng'])
            osm_places.append(p)
    print(f'  Parsed OSM places: {len(osm_places)}')

    # Build OSM spatial index: district -> list of places
    osm_by_district = defaultdict(list)
    for p in osm_places:
        if p['_district']:
            osm_by_district[p['_district']].append(p)

    # Build OSM name index for quick lookup
    osm_name_index = defaultdict(list)
    for p in osm_places:
        norm = normalize_name(p['name'])
        if norm and len(norm) > 2:
            osm_name_index[norm].append(p)
        if p.get('name_en') and len(p['name_en']) > 2:
            osm_name_index[normalize_name(p['name_en'])].append(p)

    # Track matched OSM IDs
    matched_osm_ids = set()
    results = []
    fehd_matched = 0
    fehd_unmatched = 0

    for licno, fehd in fehd_data.items():
        dist_code = fehd['district']
        dist_info = DISTRICT_MAP.get(dist_code, {})
        name_tc = fehd.get('name_tc', '') or fehd.get('name', '')
        name_en = fehd.get('name', '')

        best_match = None
        best_score = 0

        # Strategy 1: Name index lookup (fast)
        for norm_name in [normalize_name(name_tc), normalize_name(name_en)]:
            if norm_name and norm_name in osm_name_index:
                for candidate in osm_name_index[norm_name]:
                    score = name_similarity(name_tc, candidate['name'])
                    if score > best_score and candidate['osm_id'] not in matched_osm_ids:
                        # Verify district match
                        if candidate['_district'] == dist_code or haversine_km(
                            dist_info['center'][0], dist_info['center'][1],
                            candidate['lat'], candidate['lng']
                        ) < 5:
                            best_score = score
                            best_match = candidate

        # Strategy 2: Spatial proximity search in same district
        if not best_match and dist_code:
            for candidate in osm_by_district.get(dist_code, []):
                if candidate['osm_id'] in matched_osm_ids:
                    continue
                score = name_similarity(name_tc, candidate['name'])
                if score > best_score and score > 0.6:
                    best_score = score
                    best_match = candidate

        if best_match and best_score > 0.5:
            fehd_matched += 1
            matched_osm_ids.add(best_match['osm_id'])
            results.append({
                'id': f'fehd_{licno}',
                'name': name_tc or best_match['name'],
                'name_en': name_en or best_match.get('name_en', ''),
                'lat': best_match['lat'],
                'lng': best_match['lng'],
                'address': fehd.get('address_tc', '') or fehd.get('address', '') or best_match.get('address', ''),
                'district': dist_info.get('en', dist_code),
                'district_tc': dist_info.get('tc', ''),
                'licence_type': LICENCE_TYPES.get(fehd.get('type', ''), fehd.get('type', '')),
                'expiry': fehd.get('expdate', ''),
                'cuisine': best_match.get('cuisine', ''),
                'phone': best_match.get('phone', ''),
                'website': best_match.get('website', ''),
                'opening_hours': best_match.get('opening_hours', ''),
                'amenity': best_match.get('amenity', 'restaurant'),
                'source': 'fehd+osm',
            })
        else:
            fehd_unmatched += 1
            center = dist_info.get('center', (22.319, 114.169))
            # Use deterministic offset based on licence number hash
            import hashlib
            h = int(hashlib.md5(licno.encode()).hexdigest(), 16)
            lat_off = ((h % 1000) - 500) * 0.00002  # ±0.01 degrees ≈ ±1km
            lng_off = (((h >> 10) % 1000) - 500) * 0.00002

            results.append({
                'id': f'fehd_{licno}',
                'name': name_tc or name_en,
                'name_en': name_en,
                'lat': round(center[0] + lat_off, 5),
                'lng': round(center[1] + lng_off, 5),
                'address': fehd.get('address_tc', '') or fehd.get('address', ''),
                'district': dist_info.get('en', dist_code),
                'district_tc': dist_info.get('tc', ''),
                'licence_type': LICENCE_TYPES.get(fehd.get('type', ''), fehd.get('type', '')),
                'expiry': fehd.get('expdate', ''),
                'cuisine': '',
                'phone': '',
                'website': '',
                'opening_hours': '',
                'amenity': 'restaurant',
                'source': 'fehd',
            })

    # Add unmatched OSM-only places
    osm_only = 0
    for p in osm_places:
        if p['osm_id'] not in matched_osm_ids:
            osm_only += 1
            dinfo = DISTRICT_MAP.get(p['_district'], {}) if p.get('_district') else {}
            results.append({
                'id': f"osm_{p['osm_id']}",
                'name': p['name'],
                'name_en': p.get('name_en', ''),
                'lat': p['lat'],
                'lng': p['lng'],
                'address': p.get('address', ''),
                'district': dinfo.get('en', ''),
                'district_tc': dinfo.get('tc', ''),
                'licence_type': '',
                'expiry': '',
                'cuisine': p.get('cuisine', ''),
                'phone': p.get('phone', ''),
                'website': p.get('website', ''),
                'opening_hours': p.get('opening_hours', ''),
                'amenity': p.get('amenity', 'restaurant'),
                'source': 'osm',
            })

    print(f'  FEHD+OSM matched: {fehd_matched}')
    print(f'  FEHD-only (no match): {fehd_unmatched}')
    print(f'  OSM-only (new places): {osm_only}')
    print(f'  Total: {len(results)}')
    return results


# ── Output ─────────────────────────────────────────────────────────────────

def write_chunks(restaurants):
    """Write district-chunked compact JSON + index."""
    print('\nWriting district chunks...')

    # Remove old district files
    import glob
    for f in glob.glob(os.path.join(DATA_DIR, 'district_*.json')):
        os.remove(f)

    # Group by district
    by_district = defaultdict(list)
    for r in restaurants:
        by_district[r['district']].append(r)

    index = {'v': 3, 'total': len(restaurants), 'districts': {}}

    total_with_cuisine = 0
    total_with_phone = 0
    total_with_hours = 0

    for district, records in by_district.items():
        safe_name = district.replace('/', '_').replace(' ', '_').lower()
        filename = f'district_{safe_name}.json'

        # Convert to compact array format
        rows = []
        for r in records:
            row = [r.get(f, '') for f in FIELDS]
            rows.append(row)
            if r.get('cuisine'):
                total_with_cuisine += 1
            if r.get('phone'):
                total_with_phone += 1
            if r.get('opening_hours'):
                total_with_hours += 1

        chunk = {
            'v': 3,
            'district': district,
            'count': len(records),
            'fields': FIELDS,
            'rows': rows,
        }

        path = os.path.join(DATA_DIR, filename)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(chunk, f, ensure_ascii=False, separators=(',', ':'))

        index['districts'][district] = {
            'file': f'data/{filename}',
            'count': len(records),
            'url': f'data/{filename}',
        }
        print(f'  {district}: {len(records)} records ({os.path.getsize(path) // 1024}KB)')

    # Write index
    index_path = os.path.join(DATA_DIR, 'district_index.json')
    with open(index_path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print(f'\nEnrichment stats:')
    print(f'  Restaurants with cuisine: {total_with_cuisine} ({100*total_with_cuisine/len(restaurants):.1f}%)')
    print(f'  Restaurants with phone: {total_with_phone} ({100*total_with_phone/len(restaurants):.1f}%)')
    print(f'  Restaurants with hours: {total_with_hours} ({100*total_with_hours/len(restaurants):.1f}%)')


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    fehd = fetch_fehd()
    if not fehd:
        print('ERROR: No FEHD data')
        sys.exit(1)

    osm = fetch_overpass()
    results = merge(fehd, osm)
    write_chunks(results)
    print('\nDone.')


if __name__ == '__main__':
    main()
