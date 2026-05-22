#!/usr/bin/env python3
"""Enrich LunchGo restaurant data by merging FEHD licence data with Overpass tags."""

from __future__ import annotations

import glob
import hashlib
import json
import logging
import math
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from collections import defaultdict
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

SCRIPT_DIR: str = os.path.dirname(os.path.abspath(__file__))
REPO_DIR: str = os.path.dirname(SCRIPT_DIR)
DATA_DIR: str = os.path.join(REPO_DIR, 'data')

FEHD_EN_URL: str = (
    'https://www.fehd.gov.hk/english/licensing/license/text/LP_Restaurants_EN.XML'
)
FEHD_TC_URL: str = (
    'https://www.fehd.gov.hk/tc_chi/licensing/license/text/LP_Restaurants_TC.XML'
)

OVERPASS_ENDPOINTS: List[str] = [
    'https://overpass-api.de/api/interpreter',
    'https://z.overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
]

HK_BOUNDS: Tuple[float, float, float, float] = (22.11, 113.83, 22.57, 114.43)

MAX_RETRIES: int = 3
INITIAL_BACKOFF: float = 2.0
MAX_BACKOFF: float = 60.0

DISTRICT_MAP: Dict[str, Dict[str, Any]] = {
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

LICENCE_TYPES: Dict[str, str] = {
    'RL': 'General Restaurant',
    'RR': 'Light Refreshment',
    'MR': 'Marine Restaurant',
}

ENDORSEMENT_MAP: Dict[str, str] = {
    'A': 'Outside Seating', 'B': 'Karaoke', 'C': 'Karaoke',
    'D': 'ISO 22000', 'E': 'Raw Meat', 'F': 'Raw Oysters',
    'G': 'Sashimi', 'H': 'Sushi',
}

FIELDS: List[str] = [
    'id', 'name', 'name_en', 'lat', 'lng', 'address',
    'district', 'district_tc', 'licence_type', 'expiry',
    'cuisine', 'phone', 'website', 'opening_hours',
    'amenity', 'source',
]

FehdRecord = Dict[str, Any]
OsmElement = Dict[str, Any]
ParsedOsmPlace = Dict[str, Any]
MergedRestaurant = Dict[str, Any]


def _retry_with_backoff(
    func: callable,
    *args: Any,
    max_retries: int = MAX_RETRIES,
    initial_backoff: float = INITIAL_BACKOFF,
    **kwargs: Any,
) -> Any:
    backoff = initial_backoff
    last_exception: Optional[Exception] = None

    for attempt in range(max_retries + 1):
        try:
            return func(*args, **kwargs)
        except (requests.RequestException, ConnectionError, TimeoutError) as exc:
            last_exception = exc
            if attempt < max_retries:
                logger.warning(
                    'Attempt %d/%d failed: %s — retrying in %.1fs',
                    attempt + 1, max_retries, exc, backoff,
                )
                time.sleep(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF)
            else:
                logger.error(
                    'All %d attempts exhausted: %s', max_retries + 1, exc,
                )

    raise last_exception  # type: ignore[misc]


def _http_get(url: str, timeout: int = 60) -> requests.Response:
    resp = requests.get(
        url,
        headers={
            'User-Agent': 'LunchGo-Bot/2.0',
            'Accept': 'application/xml',
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp


def _http_post(
    url: str,
    data: bytes,
    timeout: int = 240,
) -> requests.Response:
    resp = requests.post(
        url,
        data=data,
        headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': (
                'LunchGo HK Restaurant Finder '
                '(https://timoranjes.github.io/lunchgo; '
                'contact:liaozicheng@gmail.com)'
            ),
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp


def _parse_fehd_xml(xml_text: str) -> Dict[str, FehdRecord]:
    root = ET.fromstring(xml_text)
    restaurants: Dict[str, FehdRecord] = {}

    lps = root.find('LPS') or root
    for lp in lps.findall('LP'):
        def get(tag: str) -> str:
            el = lp.find(tag)
            return el.text.strip() if el is not None and el.text else ''

        licno = get('LICNO')
        if not licno:
            continue

        endorsements: List[str] = []
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


def fetch_fehd() -> Dict[str, FehdRecord]:
    logger.info('Fetching FEHD restaurant licence data...')

    def _fetch_and_parse(url: str) -> Dict[str, FehdRecord]:
        filename = url.split('/')[-1]
        logger.info('  Downloading %s...', filename)
        try:
            resp = _retry_with_backoff(_http_get, url, timeout=60)
            return _parse_fehd_xml(resp.text)
        except Exception as exc:
            logger.error('  ERROR fetching %s: %s', filename, exc)
            return {}

    en_data = _fetch_and_parse(FEHD_EN_URL)
    tc_data = _fetch_and_parse(FEHD_TC_URL)
    logger.info('  EN: %d, TC: %d', len(en_data), len(tc_data))

    merged: Dict[str, FehdRecord] = {}
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

    logger.info('  Total unique: %d', len(merged))
    return merged


def fetch_overpass() -> List[OsmElement]:
    logger.info('Fetching Overpass data...')

    s, w, n, e = HK_BOUNDS
    query = (
        f'[out:json][timeout:180];\n'
        f'(\n'
        f'  nwr["amenity"="restaurant"]({s},{w},{n},{e});\n'
        f'  nwr["amenity"="fast_food"]({s},{w},{n},{e});\n'
        f'  nwr["amenity"="cafe"]({s},{w},{n},{e});\n'
        f');\n'
        f'out center qt;'
    )

    for endpoint in OVERPASS_ENDPOINTS:
        try:
            logger.info('  Trying %s...', endpoint)
            resp = _retry_with_backoff(
                _http_post,
                endpoint,
                data=query.encode('utf-8'),
                timeout=240,
            )
            result = resp.json()
            elements: List[OsmElement] = result.get('elements', [])
            logger.info('  Got %d elements', len(elements))
            return elements
        except Exception as exc:
            logger.warning('  Failed %s: %s', endpoint, exc)
            time.sleep(5)

    logger.error('  All Overpass endpoints failed')
    return []


def parse_osm_element(elem: OsmElement) -> Optional[ParsedOsmPlace]:
    tags: Dict[str, str] = elem.get('tags', {})
    name: str = (
        tags.get('name:zh')
        or tags.get('name:zh-Hant')
        or tags.get('name', '')
    )
    if not name:
        return None

    center: Optional[Dict[str, float]] = elem.get('center')
    lat: Optional[float] = elem.get('lat') or (center or {}).get('lat')
    lng: Optional[float] = elem.get('lon') or (center or {}).get('lon')
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
        'address': tags.get(
            'addr:full',
            tags.get('addr:street', tags.get('addr:interpolation', '')),
        ),
        'opening_hours': tags.get('opening_hours', ''),
        'amenity': tags.get('amenity', 'restaurant'),
    }


def normalize_name(name: Optional[str]) -> str:
    if not name:
        return ''
    name = name.lower().strip()
    for sfx in [
        'restaurant', 'cafe', 'coffee shop', 'limited', 'company',
        '餐廳', '咖啡', '茶餐廳', '小食店', '酒家', '飯店',
    ]:
        name = name.replace(sfx, '')
    name = re.sub(r'[^\w\s&\-./]', '', name)
    return ' '.join(name.split())


def name_similarity(a: str, b: str) -> float:
    n1, n2 = normalize_name(a), normalize_name(b)
    if not n1 or not n2:
        return 0.0
    if n1 == n2:
        return 1.0
    if len(n1) > 2 and n1 in n2:
        return 0.9
    if len(n2) > 2 and n2 in n1:
        return 0.9
    return SequenceMatcher(None, n1, n2).ratio()


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def assign_district(lat: float, lng: float) -> Optional[str]:
    best_code: Optional[str] = None
    best_dist = float('inf')
    for code, info in DISTRICT_MAP.items():
        d = haversine_km(lat, lng, info['center'][0], info['center'][1])
        if d < best_dist:
            best_dist = d
            best_code = code
    return best_code if best_dist < 50 else None


def merge(
    fehd_data: Dict[str, FehdRecord],
    osm_elements: List[OsmElement],
) -> List[MergedRestaurant]:
    logger.info('Merging data...')

    osm_places: List[ParsedOsmPlace] = []
    for elem in osm_elements:
        p = parse_osm_element(elem)
        if p:
            p['_district'] = assign_district(p['lat'], p['lng'])
            osm_places.append(p)
    logger.info('  Parsed OSM places: %d', len(osm_places))

    osm_by_district: Dict[str, List[ParsedOsmPlace]] = defaultdict(list)
    for p in osm_places:
        if p['_district']:
            osm_by_district[p['_district']].append(p)

    osm_name_index: Dict[str, List[ParsedOsmPlace]] = defaultdict(list)
    for p in osm_places:
        norm = normalize_name(p['name'])
        if norm and len(norm) > 2:
            osm_name_index[norm].append(p)
        if p.get('name_en') and len(p['name_en']) > 2:
            osm_name_index[normalize_name(p['name_en'])].append(p)

    matched_osm_ids: set = set()
    results: List[MergedRestaurant] = []
    fehd_matched = 0
    fehd_unmatched = 0

    for licno, fehd in fehd_data.items():
        dist_code: str = fehd['district']
        dist_info: Dict[str, Any] = DISTRICT_MAP.get(dist_code, {})
        name_tc: str = fehd.get('name_tc', '') or fehd.get('name', '')
        name_en: str = fehd.get('name', '')

        best_match: Optional[ParsedOsmPlace] = None
        best_score = 0.0

        for norm_name in [normalize_name(name_tc), normalize_name(name_en)]:
            if norm_name and norm_name in osm_name_index:
                for candidate in osm_name_index[norm_name]:
                    score = name_similarity(name_tc, candidate['name'])
                    if score > best_score and candidate['osm_id'] not in matched_osm_ids:
                        if candidate['_district'] == dist_code or haversine_km(
                            dist_info['center'][0], dist_info['center'][1],
                            candidate['lat'], candidate['lng'],
                        ) < 5:
                            best_score = score
                            best_match = candidate

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
                'address': (
                    fehd.get('address_tc', '')
                    or fehd.get('address', '')
                    or best_match.get('address', '')
                ),
                'district': dist_info.get('en', dist_code),
                'district_tc': dist_info.get('tc', ''),
                'licence_type': LICENCE_TYPES.get(
                    fehd.get('type', ''), fehd.get('type', ''),
                ),
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
            center: Tuple[float, float] = dist_info.get(
                'center', (22.319, 114.169),
            )
            h = int(hashlib.md5(licno.encode()).hexdigest(), 16)
            lat_off = ((h % 1000) - 500) * 0.00002
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
                'licence_type': LICENCE_TYPES.get(
                    fehd.get('type', ''), fehd.get('type', ''),
                ),
                'expiry': fehd.get('expdate', ''),
                'cuisine': '',
                'phone': '',
                'website': '',
                'opening_hours': '',
                'amenity': 'restaurant',
                'source': 'fehd',
            })

    osm_only = 0
    for p in osm_places:
        if p['osm_id'] not in matched_osm_ids:
            osm_only += 1
            dinfo: Dict[str, str] = (
                DISTRICT_MAP.get(p['_district'], {})
                if p.get('_district')
                else {}
            )
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

    logger.info('  FEHD+OSM matched: %d', fehd_matched)
    logger.info('  FEHD-only (no match): %d', fehd_unmatched)
    logger.info('  OSM-only (new places): %d', osm_only)
    logger.info('  Total: %d', len(results))
    return results


def write_chunks(restaurants: List[MergedRestaurant]) -> None:
    logger.info('Writing district chunks...')

    for f in glob.glob(os.path.join(DATA_DIR, 'district_*.json')):
        os.remove(f)

    by_district: Dict[str, List[MergedRestaurant]] = defaultdict(list)
    for r in restaurants:
        by_district[r['district']].append(r)

    index: Dict[str, Any] = {
        'v': 3,
        'total': len(restaurants),
        'districts': {},
    }

    total_with_cuisine = 0
    total_with_phone = 0
    total_with_hours = 0

    for district, records in by_district.items():
        safe_name = district.replace('/', '_').replace(' ', '_').lower()
        filename = f'district_{safe_name}.json'

        rows: List[List[Any]] = []
        for r in records:
            row = [r.get(f, '') for f in FIELDS]
            rows.append(row)
            if r.get('cuisine'):
                total_with_cuisine += 1
            if r.get('phone'):
                total_with_phone += 1
            if r.get('opening_hours'):
                total_with_hours += 1

        chunk: Dict[str, Any] = {
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
        file_size_kb = os.path.getsize(path) // 1024
        logger.info('  %s: %d records (%dKB)', district, len(records), file_size_kb)

    index_path = os.path.join(DATA_DIR, 'district_index.json')
    with open(index_path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    total = len(restaurants)
    logger.info('Enrichment stats:')
    logger.info(
        '  Restaurants with cuisine: %d (%.1f%%)',
        total_with_cuisine, 100 * total_with_cuisine / total,
    )
    logger.info(
        '  Restaurants with phone: %d (%.1f%%)',
        total_with_phone, 100 * total_with_phone / total,
    )
    logger.info(
        '  Restaurants with hours: %d (%.1f%%)',
        total_with_hours, 100 * total_with_hours / total,
    )


def _setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format='%(asctime)s [%(levelname)s] %(message)s',
        datefmt='%H:%M:%S',
    )


def main() -> None:
    verbose = '--verbose' in sys.argv or '-v' in sys.argv
    _setup_logging(verbose)

    logger.info('Starting LunchGo data enrichment pipeline')

    fehd = fetch_fehd()
    if not fehd:
        logger.error('No FEHD data — aborting')
        sys.exit(1)

    osm = fetch_overpass()
    results = merge(fehd, osm)
    write_chunks(results)

    logger.info('Done.')


if __name__ == '__main__':
    main()
