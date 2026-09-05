"""Unit-only mutations of a real feature; these fixtures are never shipped to the app."""

import copy
import json
import math
import unittest

from prepare_population import (
    ROOT,
    SOURCE_CRS,
    YEARS,
    collection,
    compact_json,
    coordinate,
    normalize_code,
    population_value,
    prepare_features,
    rectangle_ring,
    summarize,
)
from pyproj import Transformer


class CodeAndValueTests(unittest.TestCase):
    def test_numeric_city_can_be_padded_but_mesh_is_not_invented(self):
        self.assertEqual(normalize_code(3202, 5, "city", True), "03202")
        self.assertEqual(normalize_code(594137654, 9, "mesh"), "594137654")
        for bad in (True, None, 3202.0, "3202", "03202_03201", -1, 123456):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                normalize_code(bad, 5, "city", True)
        with self.assertRaises(ValueError):
            normalize_code(123, 9, "mesh")

    def test_population_null_zero_and_fraction_are_distinct(self):
        self.assertIsNone(population_value(None, "PTN"))
        self.assertEqual(population_value(0, "PTN"), 0)
        self.assertEqual(population_value(0.0001, "PTN"), 0.0001)
        for bad in (True, False, "2.767", -1, math.nan, math.inf, -math.inf):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                population_value(bad, "PTN")

    def test_coordinates_validate_shape_and_reject_non_finite_values(self):
        station = [141.94674615, 39.640204425]
        self.assertIs(coordinate(station, "station"), station)
        for bad in (None, {}, [], [141], [141, 39, 0], [True, 39], [141, "39"],
                    [math.nan, 39], [141, math.inf], [181, 39], [141, 91]):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                coordinate(bad, "coordinate")

    def test_collection_and_polygon_reject_malformed_shapes(self):
        for bad in (None, [], {"type": "Feature"}, {"type": "FeatureCollection"},
                    {"type": "FeatureCollection", "features": []}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                collection(bad, "collection")
        for bad in (None, {}, {"type": "Polygon"}, {"type": "Polygon", "coordinates": []},
                    {"type": "Polygon", "coordinates": [[]]}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                rectangle_ring(bad, "polygon")


class PreparationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        public = json.loads((ROOT / "public/data/miyako-population.geojson").read_text())
        cls.real = next(f for f in public["features"] if f["id"] == "594115541")
        cls.transformer = Transformer.from_crs("EPSG:6668", "EPSG:4326", always_xy=True)

    def source(self):
        feature = copy.deepcopy(self.real)
        feature["properties"] = {
            "MESH_ID": feature["id"], "SHICODE": "03202",
            **{f"PTN_{year}": self.real["properties"]["population"][str(year)] for year in YEARS},
            **{f"PT00_{year}": 0 for year in YEARS[1:]},
            **{f"HITOKU{year}": "*" for year in YEARS[1:]},
            **{f"GASSAN{year}": None for year in YEARS[1:]},
        }
        return {"type": "FeatureCollection", "crs": {"properties": {"name": SOURCE_CRS}}, "features": [feature]}

    def test_invalid_properties_object_fails_explicitly(self):
        for bad in (None, [], 42):
            source = self.source()
            source["features"][0]["properties"] = bad
            with self.subTest(bad=bad), self.assertRaisesRegex(TypeError, "properties object"):
                prepare_features(source, self.transformer)

    def test_ptn_is_not_replaced_by_suppressed_pt00(self):
        result, _ = prepare_features(self.source(), self.transformer)
        self.assertEqual(result[0]["properties"]["population"]["2030"], 2.767)
        self.assertEqual(set(result[0]["properties"]), {"meshId", "cityCode", "population"})

    def test_null_is_preserved_and_inspected(self):
        source = self.source()
        source["features"][0]["properties"]["PTN_2050"] = None
        result, report = prepare_features(source, self.transformer)
        self.assertIsNone(result[0]["properties"]["population"]["2050"])
        self.assertEqual(report["nullValues"], [{"meshId": "594115541", "year": 2050}])
        self.assertIsNone(summarize(result)["totals"]["2050"])

    def test_missing_year_is_not_filled(self):
        source = self.source()
        del source["features"][0]["properties"]["PTN_2050"]
        with self.assertRaisesRegex(ValueError, "PT00 is not a substitute"):
            prepare_features(source, self.transformer)

    def test_duplicate_ids_fail(self):
        source = self.source()
        source["features"].append(copy.deepcopy(source["features"][0]))
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            prepare_features(source, self.transformer)

    def test_other_cities_are_validated_before_filtering(self):
        source = self.source()
        other = copy.deepcopy(source["features"][0])
        other["properties"].update({"SHICODE": "03201", "MESH_ID": "594115542", "PTN_2070": -1})
        source["features"].append(other)
        with self.assertRaisesRegex(ValueError, "PTN_2070"):
            prepare_features(source, self.transformer)

    def test_compound_codes_do_not_reassign_population(self):
        source = self.source()
        other = copy.deepcopy(source["features"][0])
        other["properties"].update({"SHICODE": "03402_03209", "MESH_ID": "594115542"})
        source["features"].append(other)
        result, report = prepare_features(source, self.transformer)
        self.assertEqual(len(result), 1)
        self.assertEqual(report["compoundCityCodesOutsideMiyako"][0]["sourceCityCode"], "03402_03209")
        other["properties"]["SHICODE"] = "03202_03209"
        with self.assertRaisesRegex(ValueError, "ambiguous Miyako"):
            prepare_features(source, self.transformer)

    def test_wrong_crs_empty_input_and_crossed_geometry_fail(self):
        source = self.source()
        source["crs"]["properties"]["name"] = "EPSG:3857"
        with self.assertRaisesRegex(ValueError, "CRS"):
            prepare_features(source, self.transformer)
        source = self.source()
        source["features"] = []
        with self.assertRaisesRegex(ValueError, "empty"):
            prepare_features(source, self.transformer)
        geometry = copy.deepcopy(self.real["geometry"])
        ring = geometry["coordinates"][0]
        ring[1], ring[2] = ring[2], ring[1]
        with self.assertRaisesRegex(ValueError, "crossed"):
            rectangle_ring(geometry, "test")

    def test_round_trip_keeps_population_precision(self):
        value = {"population": 653.5813, "missing": None}
        self.assertEqual(json.loads(compact_json(value)), value)


if __name__ == "__main__":
    unittest.main()
