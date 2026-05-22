"""Tests for scripts/enrich_data.py.

Comprehensive test suite for LunchGo data pipeline with proper mocking and coverage.
"""

import json
import sys
import os
import tempfile
from unittest.mock import patch, MagicMock
from typing import Dict, Any
import xml.etree.ElementTree as ET
import requests

import pytest

# Allow importing from scripts/ directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from enrich_data import (
    _parse_fehd_xml, fetch_fehd, fetch_overpass, parse_osm_element,
    merge, write_chunks, _retry_with_backoff, _http_get, _http_post,
    normalize_name, name_similarity, haversine_km, assign_district,
    FIELDS, DISTRICT_MAP, LICENCE_TYPES, ENDORSEMENT_MAP
)


class TestFehdParsing:

    def test_parse_fehd_xml_valid_data(self):
        xml_data = '''<?xml version="1.0" encoding="UTF-8"?>
        <LPS>
            <LP>
                <LICNO>1234567890</LICNO>
                <SS>Golden Dragon Restaurant</SS>
                <ADR>123 Main Street, Central</ADR>
                <DIST>18</DIST>
                <TYPE>RL</TYPE>
                <INFO>A#B#C</INFO>
                <EXPDATE>2025-12-31</EXPDATE>
            </LP>
            <LP>
                <LICNO>0987654321</LICNO>
                <SS>Silver Moon Cafe</SS>
                <ADR>456 Queen's Road, Wan Chai</ADR>
                <DIST>12</DIST>
                <TYPE>RR</TYPE>
                <INFO>D#E</INFO>
                <EXPDATE>2024-06-30</EXPDATE>
            </LP>
        </LPS>'''
        
        result = _parse_fehd_xml(xml_data)
        
        assert len(result) == 2
        assert '1234567890' in result
        assert '0987654321' in result
        
        record1 = result['1234567890']
        assert record1['name'] == 'Golden Dragon Restaurant'
        assert record1['address'] == '123 Main Street, Central'
        assert record1['district'] == '18'
        assert record1['type'] == 'RL'
        assert record1['expdate'] == '2025-12-31'
        assert set(record1['endorsements']) == {'Outside Seating', 'Karaoke'}
        
        record2 = result['0987654321']
        assert record2['name'] == 'Silver Moon Cafe'
        assert record2['address'] == "456 Queen's Road, Wan Chai"
        assert record2['district'] == '12'
        assert record2['type'] == 'RR'
        assert record2['expdate'] == '2024-06-30'
        assert set(record2['endorsements']) == {'ISO 22000', 'Raw Meat'}

    def test_parse_fehd_xml_empty_licence_number(self):
        xml_data = '''<?xml version="1.0" encoding="UTF-8"?>
        <LPS>
            <LP>
                <LICNO></LICNO>
                <SS>Invalid Restaurant</SS>
                <ADR>789 Fake Street</ADR>
            </LP>
            <LP>
                <LICNO>1111111111</LICNO>
                <SS>Valid Restaurant</SS>
                <ADR>101 Real Street</ADR>
            </LP>
        </LPS>'''
        
        result = _parse_fehd_xml(xml_data)
        assert len(result) == 1
        assert '1111111111' in result
        assert result['1111111111']['name'] == 'Valid Restaurant'

    def test_parse_fehd_xml_missing_fields(self):
        xml_data = '''<?xml version="1.0" encoding="UTF-8"?>
        <LPS>
            <LP>
                <LICNO>2222222222</LICNO>
                <SS>Minimal Restaurant</SS>
            </LP>
        </LPS>'''
        
        result = _parse_fehd_xml(xml_data)
        assert len(result) == 1
        record = result['2222222222']
        assert record['name'] == 'Minimal Restaurant'
        assert record['address'] == ''
        assert record['district'] == ''
        assert record['type'] == ''
        assert record['endorsements'] == []
        assert record['expdate'] == ''

    def test_parse_fehd_xml_malformed_endorsements(self):
        xml_data = '''<?xml version="1.0" encoding="UTF-8"?>
        <LPS>
            <LP>
                <LICNO>3333333333</LICNO>
                <SS>Test Endorsements</SS>
                <INFO>X#Y#Z#A</INFO>
            </LP>
        </LPS>'''
        
        result = _parse_fehd_xml(xml_data)
        record = result['3333333333']
        assert record['endorsements'] == ['Outside Seating']

    def test_fetch_fehd_success(self):
        en_xml = '''<?xml version="1.0" encoding="UTF-8"?>
        <LPS>
            <LP>
                <LICNO>EN123</LICNO>
                <SS>English Name</SS>
                <ADR>English Address</ADR>
                <DIST>18</DIST>
            </LP>
        </LPS>'''
        
        tc_xml = '''<?xml version="1.0" encoding="UTF-8"?>
        <LPS>
            <LP>
                <LICNO>EN123</LICNO>
                <SS>中文名稱</SS>
                <ADR>中文地址</ADR>
                <DIST>18</DIST>
            </LP>
            <LP>
                <LICNO>TC456</LICNO>
                <SS>只有中文</SS>
                <ADR>只有中文地址</ADR>
                <DIST>12</DIST>
            </LP>
        </LPS>'''
        
        with patch('enrich_data._retry_with_backoff') as mock_retry:
            mock_en_resp = MagicMock()
            mock_en_resp.text = en_xml
            mock_tc_resp = MagicMock()
            mock_tc_resp.text = tc_xml
            
            mock_retry.side_effect = [mock_en_resp, mock_tc_resp]
            
            result = fetch_fehd()
            
            assert len(result) == 2
            assert 'EN123' in result
            assert 'TC456' in result
            
            merged_record = result['EN123']
            assert merged_record['name'] == 'English Name'
            assert merged_record['name_tc'] == '中文名稱'
            assert merged_record['address'] == 'English Address'
            assert merged_record['address_tc'] == '中文地址'
            
            tc_only_record = result['TC456']
            assert tc_only_record['name'] == '只有中文'
            assert tc_only_record['name_tc'] == '只有中文'
            assert tc_only_record['address'] == '只有中文地址'
            assert tc_only_record['address_tc'] == '只有中文地址'

    def test_fetch_fehd_partial_failure(self):
        en_xml = '''<?xml version="1.0" encoding="UTF-8"?>
        <LPS>
            <LP>
                <LICNO>EN789</LICNO>
                <SS>English Only</SS>
                <ADR>English Address Only</ADR>
                <DIST>15</DIST>
            </LP>
        </LPS>'''
        
        with patch('enrich_data._retry_with_backoff') as mock_retry:
            mock_en_resp = MagicMock()
            mock_en_resp.text = en_xml
            mock_retry.side_effect = [mock_en_resp, {}]
            
            result = fetch_fehd()
            
            assert len(result) == 1
            assert 'EN789' in result
            record = result['EN789']
            assert record['name'] == 'English Only'
            assert 'name_tc' not in record or record['name_tc'] == 'English Only'
            assert record['address'] == 'English Address Only'


class TestOverpassParsing:

    def test_fetch_overpass_success(self):
        overpass_response = {
            'elements': [
                {
                    'id': 12345,
                    'type': 'node',
                    'lat': 22.280,
                    'lon': 114.155,
                    'tags': {
                        'name': 'Test Restaurant',
                        'amenity': 'restaurant'
                    }
                },
                {
                    'id': 67890,
                    'type': 'way',
                    'center': {'lat': 22.310, 'lon': 114.170},
                    'tags': {
                        'name': 'Test Cafe',
                        'amenity': 'cafe'
                    }
                }
            ]
        }
        
        with patch('enrich_data._retry_with_backoff') as mock_retry:
            mock_resp = MagicMock()
            mock_resp.json.return_value = overpass_response
            mock_retry.return_value = mock_resp
            
            result = fetch_overpass()
            
            assert len(result) == 2
            assert result[0]['id'] == 12345
            assert result[0]['lat'] == 22.280
            assert result[0]['tags']['name'] == 'Test Restaurant'
            assert result[1]['id'] == 67890
            assert result[1]['center']['lat'] == 22.310
            assert result[1]['tags']['name'] == 'Test Cafe'

    def test_fetch_overpass_all_endpoints_fail(self):
        with patch('enrich_data._retry_with_backoff') as mock_retry:
            mock_retry.side_effect = [Exception("Endpoint 1 failed"), 
                                    Exception("Endpoint 2 failed"),
                                    Exception("Endpoint 3 failed")]
            
            result = fetch_overpass()
            assert result == []

    def test_parse_osm_element_valid_node(self):
        elem = {
            'id': 12345,
            'type': 'node',
            'lat': 22.280,
            'lon': 114.155,
            'tags': {
                'name': 'Test Restaurant',
                'name:en': 'Test Restaurant EN',
                'cuisine': 'chinese',
                'phone': '+852 1234 5678',
                'website': 'https://test.com',
                'addr:full': '123 Main Street',
                'opening_hours': 'Mo-Fr 10:00-22:00',
                'amenity': 'restaurant'
            }
        }
        result = parse_osm_element(elem)
        assert result is not None
        assert result['osm_id'] == 12345
        assert result['osm_type'] == 'node'
        assert result['name'] == 'Test Restaurant'
        assert result['name_en'] == 'Test Restaurant EN'
        assert result['lat'] == 22.280
        assert result['lng'] == 114.155
        assert result['cuisine'] == 'chinese'
        assert result['phone'] == '+852 1234 5678'
        assert result['website'] == 'https://test.com'
        assert result['address'] == '123 Main Street'
        assert result['opening_hours'] == 'Mo-Fr 10:00-22:00'
        assert result['amenity'] == 'restaurant'

    def test_parse_osm_element_valid_way_with_center(self):
        elem = {
            'id': 67890,
            'type': 'way',
            'center': {'lat': 22.310, 'lon': 114.170},
            'tags': {
                'name': 'Test Way Restaurant',
                'amenity': 'restaurant'
            }
        }
        result = parse_osm_element(elem)
        assert result is not None
        assert result['osm_id'] == 67890
        assert result['lat'] == 22.310
        assert result['lng'] == 114.170
        assert result['name'] == 'Test Way Restaurant'

    def test_parse_osm_element_missing_name(self):
        elem = {
            'id': 99999,
            'type': 'node',
            'lat': 22.280,
            'lon': 114.155,
            'tags': {
                'amenity': 'restaurant'
            }
        }
        assert parse_osm_element(elem) is None

    def test_parse_osm_element_missing_coordinates(self):
        elem = {
            'id': 88888,
            'type': 'node',
            'tags': {
                'name': 'No Coords Restaurant'
            }
        }
        assert parse_osm_element(elem) is None

    def test_parse_osm_element_fallback_names(self):
        elem1 = {
            'id': 11111,
            'type': 'node',
            'lat': 22.280,
            'lon': 114.155,
            'tags': {
                'name:zh': '中文名稱',
                'amenity': 'restaurant'
            }
        }
        result1 = parse_osm_element(elem1)
        assert result1['name'] == '中文名稱'
        
        elem2 = {
            'id': 22222,
            'type': 'node',
            'lat': 22.280,
            'lon': 114.155,
            'tags': {
                'name:zh-Hant': '繁體中文',
                'amenity': 'restaurant'
            }
        }
        result2 = parse_osm_element(elem2)
        assert result2['name'] == '繁體中文'


class TestMergeLogic:

    def test_merge_exact_name_match(self):
        fehd_data = {
            '123456': {
                'name': 'Golden Dragon',
                'name_tc': '金龍餐廳',
                'address': '123 Main St',
                'address_tc': '主街123號',
                'district': '18',
                'type': 'RL',
                'expdate': '2025-12-31'
            }
        }
        
        osm_elements = [
            {
                'id': 98765,
                'type': 'node',
                'lat': 22.285,
                'lon': 114.150,
                'tags': {
                    'name': '金龍餐廳',
                    'cuisine': 'chinese',
                    'phone': '+852 1234 5678',
                    'amenity': 'restaurant'
                }
            }
        ]
        
        result = merge(fehd_data, osm_elements)
        assert len(result) == 1
        restaurant = result[0]
        assert restaurant['id'] == 'fehd_123456'
        assert restaurant['name'] == '金龍餐廳'
        assert restaurant['name_en'] == 'Golden Dragon'
        assert restaurant['address'] == '主街123號'
        assert restaurant['district'] == 'Central/Western'
        assert restaurant['district_tc'] == '中西區'
        assert restaurant['licence_type'] == 'General Restaurant'
        assert restaurant['expiry'] == '2025-12-31'
        assert restaurant['cuisine'] == 'chinese'
        assert restaurant['phone'] == '+852 1234 5678'
        assert restaurant['source'] == 'fehd+osm'

    def test_merge_fehd_only_no_match(self):
        fehd_data = {
            '789012': {
                'name': 'Island Restaurant',
                'address': 'Remote Island',
                'district': '17',
                'type': 'RL',
                'expdate': '2024-06-30'
            }
        }
        
        osm_elements = [
            {
                'id': 11111,
                'type': 'node',
                'lat': 22.280,
                'lon': 114.155,
                'tags': {
                    'name': 'Unrelated Restaurant',
                    'amenity': 'restaurant'
                }
            }
        ]
        
        result = merge(fehd_data, osm_elements)
        assert len(result) == 2
        
        fehd_record = next(r for r in result if r['id'] == 'fehd_789012')
        assert fehd_record['name'] == 'Island Restaurant'
        assert fehd_record['address'] == 'Remote Island'
        assert fehd_record['district'] == 'Islands'
        assert fehd_record['district_tc'] == '離島'
        assert fehd_record['source'] == 'fehd'
        assert fehd_record['lat'] is None
        assert fehd_record['lng'] is None

    def test_merge_osm_only_no_fehd(self):
        fehd_data = {}
        
        osm_elements = [
            {
                'id': 22222,
                'type': 'node',
                'lat': 22.318,
                'lon': 114.170,
                'tags': {
                    'name': 'New OSM Place',
                    'cuisine': 'japanese',
                    'amenity': 'restaurant'
                }
            }
        ]
        
        result = merge(fehd_data, osm_elements)
        assert len(result) == 1
        osm_record = result[0]
        assert osm_record['id'] == 'osm_22222'
        assert osm_record['name'] == 'New OSM Place'
        assert osm_record['cuisine'] == 'japanese'
        assert osm_record['district'] == 'Mong Kok'
        assert osm_record['district_tc'] == '旺角'
        assert osm_record['source'] == 'osm'

    def test_merge_empty_inputs(self):
        result = merge({}, [])
        assert result == []

    def test_merge_proximity_matching(self):
        fehd_data = {
            '345678': {
                'name': 'Similar Name Restaurant',
                'address': '456 Similar St',
                'district': '12',
                'type': 'RL',
                'expdate': '2025-01-01'
            }
        }
        
        osm_elements = [
            {
                'id': 33333,
                'type': 'node',
                'lat': 22.278,
                'lon': 114.174,
                'tags': {
                    'name': 'Similar Name Rest',
                    'amenity': 'restaurant'
                }
            }
        ]
        
        result = merge(fehd_data, osm_elements)
        assert len(result) == 1
        merged = result[0]
        assert merged['source'] == 'fehd+osm'


class TestOutputFormat:

    def test_write_chunks_creates_valid_structure(self):
        restaurants = [
            {
                'id': 'test_1',
                'name': 'Test Restaurant 1',
                'name_en': 'Test Restaurant 1 EN',
                'lat': 22.285,
                'lng': 114.150,
                'address': '123 Test St',
                'district': 'Central/Western',
                'district_tc': '中西區',
                'licence_type': 'General Restaurant',
                'expiry': '2025-12-31',
                'cuisine': 'chinese',
                'phone': '+852 1234 5678',
                'website': 'https://test1.com',
                'opening_hours': 'Mo-Fr 10:00-22:00',
                'amenity': 'restaurant',
                'source': 'fehd+osm'
            },
            {
                'id': 'test_2',
                'name': 'Test Restaurant 2',
                'name_en': 'Test Restaurant 2 EN',
                'lat': 22.278,
                'lng': 114.174,
                'address': '456 Test Ave',
                'district': 'Wan Chai',
                'district_tc': '灣仔',
                'licence_type': '',
                'expiry': '',
                'cuisine': 'japanese',
                'phone': '',
                'website': '',
                'opening_hours': '',
                'amenity': 'restaurant',
                'source': 'osm'
            }
        ]
        
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch('enrich_data.DATA_DIR', temp_dir):
                write_chunks(restaurants)
                
                central_file = os.path.join(temp_dir, 'district_central_western.json')
                wan_chai_file = os.path.join(temp_dir, 'district_wan_chai.json')
                index_file = os.path.join(temp_dir, 'district_index.json')
                
                assert os.path.exists(central_file)
                assert os.path.exists(wan_chai_file)
                assert os.path.exists(index_file)
                
                with open(central_file, 'r', encoding='utf-8') as f:
                    central_data = json.load(f)
                assert central_data['v'] == 3
                assert central_data['district'] == 'Central/Western'
                assert central_data['count'] == 1
                assert central_data['fields'] == FIELDS
                assert len(central_data['rows']) == 1
                row1 = central_data['rows'][0]
                assert row1[0] == 'test_1'
                assert row1[1] == 'Test Restaurant 1'
                assert row1[2] == 'Test Restaurant 1 EN'
                assert row1[3] == 22.285
                assert row1[4] == 114.150
                
                with open(index_file, 'r', encoding='utf-8') as f:
                    index_data = json.load(f)
                assert index_data['v'] == 3
                assert index_data['total'] == 2
                assert 'Central/Western' in index_data['districts']
                assert 'Wan Chai' in index_data['districts']
                assert index_data['districts']['Central/Western']['count'] == 1
                assert index_data['districts']['Wan Chai']['count'] == 1

    def test_write_chunks_handles_special_district_names(self):
        restaurants = [
            {
                'id': 'test_3',
                'name': 'Test with Slash',
                'lat': 22.318,
                'lng': 114.170,
                'address': '789 Test Rd',
                'district': 'Yau Tsim/Mong Kok',
                'district_tc': '油尖旺',
                'licence_type': '',
                'expiry': '',
                'cuisine': '',
                'phone': '',
                'website': '',
                'opening_hours': '',
                'amenity': 'restaurant',
                'source': 'osm'
            }
        ]
        
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch('enrich_data.DATA_DIR', temp_dir):
                write_chunks(restaurants)
                
                expected_file = os.path.join(temp_dir, 'district_yau_tsim_mong_kok.json')
                assert os.path.exists(expected_file)


class TestEdgeCases:

    def test_normalize_name_handles_various_inputs(self):
        assert normalize_name('') == ''
        assert normalize_name(None) == ''
        assert normalize_name('   ') == ''
        assert normalize_name('Restaurant & Cafe') == '&'
        assert normalize_name('Foo 餐廳 Bar') == 'foo bar'
        assert normalize_name('Test@#$%123') == 'test123'

    def test_name_similarity_edge_cases(self):
        assert name_similarity('', '') == 0.0
        assert name_similarity('Foo', '') == 0.0
        assert name_similarity('', 'Bar') == 0.0
        assert name_similarity('A', 'B') == 0.0

    def test_haversine_km_edge_cases(self):
        assert haversine_km(0, 0, 0, 0) == 0
        dist = haversine_km(0, 0, 0, 180)
        assert 19000 < dist < 21000

    def test_assign_district_out_of_bounds(self):
        assert assign_district(0, 0) is None
        assert assign_district(50, 50) is None

    def test_parse_osm_element_malformed_data(self):
        elem = {
            'id': 55555,
            'type': 'node',
            'lat': 'invalid',
            'lon': 'invalid',
            'tags': {'name': 'Bad Coords'}
        }
        assert parse_osm_element(elem) is None

    def test_merge_with_invalid_district_codes(self):
        fehd_data = {
            '999999': {
                'name': 'Unknown District',
                'address': 'Somewhere',
                'district': '999',
                'type': 'RL',
                'expdate': '2025-01-01'
            }
        }
        
        osm_elements = []
        result = merge(fehd_data, osm_elements)
        assert len(result) == 1
        record = result[0]
        assert record['district'] == '999'
        assert record['district_tc'] == ''


class TestApiFailures:

    def test_retry_with_backoff_success(self):
        call_count = 0
        def flaky_func():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                raise requests.RequestException("Temporary failure")
            return "success"
        
        result = _retry_with_backoff(flaky_func, max_retries=3)
        assert result == "success"
        assert call_count == 2

    def test_retry_with_backoff_exhausted(self):
        def always_fails():
            raise requests.RequestException("Always fails")
        
        with pytest.raises(requests.RequestException):
            _retry_with_backoff(always_fails, max_retries=2)

    def test_http_get_failure(self):
        with patch('requests.get') as mock_get:
            mock_get.side_effect = requests.RequestException("Connection failed")
            with pytest.raises(requests.RequestException):
                _http_get("http://example.com")

    def test_http_post_failure(self):
        with patch('requests.post') as mock_post:
            mock_post.side_effect = requests.RequestException("Connection failed")
            with pytest.raises(requests.RequestException):
                _http_post("http://example.com", b"test data")


class TestEnrichDataPlaceholder:

    def test_import_enrich_data(self):
        import importlib
        spec = importlib.util.spec_from_file_location(
            'enrich_data',
            os.path.join(os.path.dirname(__file__), 'enrich_data.py')
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        assert hasattr(module, 'normalize_name')
        assert hasattr(module, 'name_similarity')
        assert hasattr(module, 'haversine_km')
        assert hasattr(module, 'assign_district')
        assert hasattr(module, 'parse_osm_element')

    def test_normalize_name_strips_suffixes(self):
        assert normalize_name('Foo Restaurant') == 'foo'
        assert normalize_name('Bar 餐廳') == 'bar'
        assert normalize_name('Cafe Coffee Shop') == ''

    def test_normalize_name_empty(self):
        assert normalize_name('') == ''
        assert normalize_name(None) == ''

    def test_name_similarity_identical(self):
        assert name_similarity('Foo', 'Foo') == 1.0
        assert name_similarity('Foo 餐廳', 'Foo 餐廳') == 1.0

    def test_name_similarity_different(self):
        score = name_similarity('McDonalds', 'Starbucks')
        assert score < 0.5

    def test_haversine_km_known_distance(self):
        dist = haversine_km(22.280, 114.160, 22.295, 114.172)
        assert 1 < dist < 5

    def test_haversine_km_same_point(self):
        assert haversine_km(22.3, 114.1, 22.3, 114.1) == 0

    def test_assign_district_returns_valid_code(self):
        code = assign_district(22.280, 114.155)
        assert code is not None
        assert code in ('18', '12', '15')

    def test_parse_osm_element_valid(self):
        elem = {
            'id': 12345,
            'type': 'node',
            'lat': 22.280,
            'lon': 114.155,
            'tags': {
                'name': 'Test Restaurant',
                'name:en': 'Test Restaurant EN',
                'cuisine': 'chinese',
                'phone': '+852 1234 5678',
                'amenity': 'restaurant',
            }
        }
        result = parse_osm_element(elem)
        assert result is not None
        assert result['name'] == 'Test Restaurant'
        assert result['name_en'] == 'Test Restaurant EN'
        assert result['cuisine'] == 'chinese'
        assert result['osm_id'] == 12345

    def test_parse_osm_element_missing_name(self):
        elem = {
            'id': 99999,
            'type': 'node',
            'lat': 22.280,
            'lon': 114.155,
            'tags': {
                'amenity': 'restaurant',
            }
        }
        assert parse_osm_element(elem) is None

    def test_parse_osm_element_missing_coords(self):
        elem = {
            'id': 88888,
            'type': 'node',
            'tags': {
                'name': 'No Coords Restaurant',
            }
        }
        assert parse_osm_element(elem) is None
    """Placeholder test class to verify test infrastructure works."""

    def test_import_enrich_data(self):
        """Verify enrich_data module can be imported."""
        import importlib
        # Import by file path since module has no __init__.py
        spec = importlib.util.spec_from_file_location(
            'enrich_data',
            os.path.join(os.path.dirname(__file__), 'enrich_data.py')
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        # Verify key functions exist
        assert hasattr(module, 'normalize_name')
        assert hasattr(module, 'name_similarity')
        assert hasattr(module, 'haversine_km')
        assert hasattr(module, 'assign_district')
        assert hasattr(module, 'parse_osm_element')

    def test_normalize_name_strips_suffixes(self):
        """Test normalize_name removes common restaurant suffixes."""
        from enrich_data import normalize_name

        assert normalize_name('Foo Restaurant') == 'foo'
        assert normalize_name('Bar 餐廳') == 'bar'
        assert normalize_name('Cafe Coffee Shop') == ''

    def test_normalize_name_empty(self):
        """Test normalize_name handles empty input."""
        from enrich_data import normalize_name

        assert normalize_name('') == ''
        assert normalize_name(None) == ''

    def test_name_similarity_identical(self):
        """Test name_similarity returns 1.0 for identical names."""
        from enrich_data import name_similarity

        assert name_similarity('Foo', 'Foo') == 1.0
        assert name_similarity('Foo 餐廳', 'Foo 餐廳') == 1.0

    def test_name_similarity_different(self):
        """Test name_similarity returns low score for unrelated names."""
        from enrich_data import name_similarity

        score = name_similarity('McDonalds', 'Starbucks')
        assert score < 0.5

    def test_haversine_km_known_distance(self):
        """Test haversine_km against known distance (HK to Kowloon ~5km)."""
        from enrich_data import haversine_km

        # Central to Tsim Sha Tsui ≈ 3km
        dist = haversine_km(22.280, 114.160, 22.295, 114.172)
        assert 1 < dist < 5  # Should be roughly 2-3km

    def test_haversine_km_same_point(self):
        """Test haversine_km returns 0 for same coordinates."""
        from enrich_data import haversine_km

        assert haversine_km(22.3, 114.1, 22.3, 114.1) == 0

    def test_assign_district_returns_valid_code(self):
        """Test assign_district returns a valid district code for HK coordinates."""
        from enrich_data import assign_district

        # Central coordinates
        code = assign_district(22.280, 114.155)
        assert code is not None
        assert code in ('18', '12', '15')  # Should be Central/Western, Wan Chai, or Southern

    def test_parse_osm_element_valid(self):
        """Test parse_osm_element extracts fields from Overpass element."""
        from enrich_data import parse_osm_element

        elem = {
            'id': 12345,
            'type': 'node',
            'lat': 22.280,
            'lon': 114.155,
            'tags': {
                'name': 'Test Restaurant',
                'name:en': 'Test Restaurant EN',
                'cuisine': 'chinese',
                'phone': '+852 1234 5678',
                'amenity': 'restaurant',
            }
        }
        result = parse_osm_element(elem)
        assert result is not None
        assert result['name'] == 'Test Restaurant'
        assert result['name_en'] == 'Test Restaurant EN'
        assert result['cuisine'] == 'chinese'
        assert result['osm_id'] == 12345

    def test_parse_osm_element_missing_name(self):
        """Test parse_osm_element returns None for element without name."""
        from enrich_data import parse_osm_element

        elem = {
            'id': 99999,
            'type': 'node',
            'lat': 22.280,
            'lon': 114.155,
            'tags': {
                'amenity': 'restaurant',
            }
        }
        assert parse_osm_element(elem) is None

    def test_parse_osm_element_missing_coords(self):
        """Test parse_osm_element returns None for element without coordinates."""
        from enrich_data import parse_osm_element

        elem = {
            'id': 88888,
            'type': 'node',
            'tags': {
                'name': 'No Coords Restaurant',
            }
        }
        assert parse_osm_element(elem) is None
