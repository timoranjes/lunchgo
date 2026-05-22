"""Tests for scripts/enrich_data.py.

Test infrastructure placeholder — add tests as enrich_data.py is refactored.
"""

import sys
import os

# Allow importing from scripts/ directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


class TestEnrichDataPlaceholder:
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
