#!/usr/bin/env python3
"""Validate pinned PTN data, select SHICODE 03202, and transform EPSG:6668 to 4326."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import sys
import zipfile
from collections import Counter
from datetime import datetime, timezone
from itertools import pairwise

import pyproj
from acquire_data import (
    MANIFEST,
    POPULATION_MEMBER,
    POPULATION_SHA,
    ROOT,
    checked,
    digest,
    write_json,
)
from pyproj import Transformer
# pyproj 3.7's public network API is an unmarked Cython re-export.
from pyproj.network import is_network_enabled, set_network_enabled  # pyright: ignore[reportPrivateImportUsage]

LOGGER = logging.getLogger(__name__)
YEARS = tuple(range(2020, 2071, 5))
CITY_CODE = "03202"
SOURCE_CRS = "urn:ogc:def:crs:EPSG::6668"
PUBLIC = ROOT / "public/data"
REPORT = ROOT / "data/population-inspection.json"


def normalize_code(value: object, width: int, label: str, pad_numeric: bool = False) -> str:
    if type(value) is int and value >= 0:
        value = str(value).zfill(width) if pad_numeric else str(value)
    if not isinstance(value, str) or re.fullmatch(rf"[0-9]{{{width}}}", value) is None:
        raise ValueError(f"{label}: expected a {width}-digit code, got {value!r}")
    return value


def population_value(value: object, label: str) -> int | float | None:
    if value is None:
        return None
    if not (type(value) is int or type(value) is float) or not math.isfinite(value) or value < 0:
        raise ValueError(f"{label}: expected a finite, non-negative number or null, got {value!r}")
    return value


def coordinate(value: object, label: str) -> list[float]:
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError(f"{label}: expected [longitude, latitude]")
    checked(all(type(n) in (int, float) and math.isfinite(n) for n in value), f"{label}: non-finite coordinate")
    checked(-180 <= value[0] <= 180 and -90 <= value[1] <= 90, f"{label}: longitude/latitude out of range")
    return value


def rectangle_ring(geometry: object, label: str) -> list[list[float]]:
    if not isinstance(geometry, dict) or geometry.get("type") != "Polygon":
        raise ValueError(f"{label}: expected Polygon")
    rings = geometry.get("coordinates")
    if not isinstance(rings, list) or len(rings) != 1:
        raise ValueError(f"{label}: expected one rectangle ring, no holes")
    ring = rings[0]
    if not isinstance(ring, list) or len(ring) != 5:
        raise ValueError(f"{label}: expected four corners plus closure")
    for point in ring:
        coordinate(point, label)
    checked(ring[0] == ring[-1], f"{label}: unclosed ring")
    xs, ys = {p[0] for p in ring[:-1]}, {p[1] for p in ring[:-1]}
    checked(len(xs) == 2 and len(ys) == 2 and len({tuple(p) for p in ring[:-1]}) == 4,
            f"{label}: not the source's simple rectangular geometry")
    checked(all((a[0] == b[0]) != (a[1] == b[1]) for a, b in pairwise(ring)),
            f"{label}: crossed/diagonal rectangle edges")
    return ring


def collection(source: object, label: str) -> list[dict]:
    if not isinstance(source, dict) or source.get("type") != "FeatureCollection":
        raise ValueError(f"{label}: not FeatureCollection")
    features = source.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError(f"{label}: empty/missing features, not zero population")
    return features


def prepare_features(source: dict, transformer: Transformer) -> tuple[list[dict], dict]:
    features = collection(source, "population")
    checked(source.get("crs", {}).get("properties", {}).get("name") == SOURCE_CRS, "Unexpected population CRS; review source revision")
    seen: set[str] = set()
    result = []
    null_values = []
    compound_codes = []
    suppression = {str(year): {"HITOKU": Counter(), "GASSANNonNull": 0} for year in YEARS[1:]}
    ptn_example = None
    for index, feature in enumerate(features):
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise ValueError(f"population[{index}]: not Feature")
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            raise TypeError(f"population[{index}]: missing properties object")
        mesh = normalize_code(properties.get("MESH_ID"), 9, f"MESH_ID[{index}]")
        raw_city = properties.get("SHICODE")
        if isinstance(raw_city, str) and "_" in raw_city:
            # Observed in the SAME pinned archive, outside Miyako. Preserve the raw
            # assignment; do not reinterpret it as multiple new population features.
            parts = [normalize_code(part, 5, f"SHICODE[{index}]") for part in raw_city.split("_")]
            checked(len(parts) == 2 and len(set(parts)) == 2, f"{mesh}: unexpected compound SHICODE")
            checked(CITY_CODE not in parts, f"{mesh}: ambiguous Miyako assignment requires review")
            city = raw_city
            compound_codes.append({"meshId": mesh, "sourceCityCode": raw_city})
        else:
            city = normalize_code(raw_city, 5, f"SHICODE[{index}]", pad_numeric=True)
        checked(mesh not in seen, f"Duplicate source MESH_ID: {mesh}")
        seen.add(mesh)
        populations = {}
        for year in YEARS:
            field = f"PTN_{year}"
            checked(field in properties, f"{mesh}: missing {field}; PT00 is not a substitute")
            populations[str(year)] = population_value(properties[field], f"{mesh}.{field}")
        ring = rectangle_ring(feature.get("geometry"), mesh)
        # Validate the entire prefecture's required contract before selecting Miyako.
        if city != CITY_CODE:
            continue
        coordinates = [list(transformer.transform(point[0], point[1], errcheck=True)) for point in ring]
        for point in coordinates:
            coordinate(point, f"transformed {mesh}")
        checked(coordinates[0] == coordinates[-1], f"{mesh}: transformed ring is unclosed")
        result.append({"type": "Feature", "id": mesh,
                       "properties": {"meshId": mesh, "cityCode": city, "population": populations},
                       "geometry": {"type": "Polygon", "coordinates": [coordinates]}})
        for year in YEARS:
            if populations[str(year)] is None:
                null_values.append({"meshId": mesh, "year": year})
        for year in YEARS[1:]:
            # Preserve the actual field spelling; these do not invalidate the public PTN total.
            for field in (f"HITOKU{year}", f"GASSAN{year}"):
                checked(field in properties, f"{mesh}: missing inspection field {field}")
            suppression[str(year)]["HITOKU"][str(properties[f"HITOKU{year}"])] += 1
            suppression[str(year)]["GASSANNonNull"] += properties[f"GASSAN{year}"] is not None
        if mesh == "594115541":
            ptn_example = {key: properties[key] for key in ("MESH_ID", "PTN_2030", "PT00_2030", "HITOKU2030", "GASSAN2030")}
    checked(bool(result), "No Miyako records found; this is not a zero-population dataset")
    return sorted(result, key=lambda feature: feature["id"]), {
        "sourceCount": len(features), "sourceUniqueIds": len(seen), "nullValues": null_values,
        "suppressionInspection": suppression, "ptnVsPt00Example": ptn_example,
        "compoundCityCodesOutsideMiyako": compound_codes,
        "specDifference": "The plan/page describe a single 5-digit SHICODE, but the hash-identical original contains compound codes outside Miyako. Components are validated; raw assignments are retained and not split. Only exact SHICODE 03202 is selected. No compound code includes Miyako.",
    }


def summarize(features: list[dict]) -> dict:
    totals, null_counts, zero_counts = {}, {}, {}
    for year in YEARS:
        values = [f["properties"]["population"][str(year)] for f in features]
        valid = [value for value in values if value is not None]
        totals[str(year)] = math.fsum(valid) if valid else None
        null_counts[str(year)] = sum(value is None for value in values)
        zero_counts[str(year)] = sum(value == 0 for value in values)
    points = [point for f in features for point in f["geometry"]["coordinates"][0]]
    return {"meshCount": len(features), "uniqueIds": len({f["id"] for f in features}),
            "totals": totals, "nullCounts": null_counts, "zeroCounts": zero_counts,
            "bbox": [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]}


def verify_plan(features: list[dict], inspection: dict, summary: dict) -> None:
    checked(inspection["sourceCount"] == 16684, "Prefecture count differs from plan")
    checked(summary["meshCount"] == summary["uniqueIds"] == 692, "Miyako count differs from plan")
    checked(not inspection["nullValues"], "Pinned original must pass completeness; nulls were preserved, not replaced")
    for year, expected in {2020: 50369.0000, 2050: 26633.0007, 2070: 15526.9996}.items():
        checked(abs(summary["totals"][str(year)] - expected) <= 0.01, f"PTN_{year} total differs from plan")
    checked(summary["zeroCounts"]["2020"] == 0, "2020 zero count differs from plan")
    checked(summary["zeroCounts"]["2070"] == 225, "2070 zero count differs from plan")
    by_id = {f["id"]: f for f in features}
    for year, expected in {2020: 653.5813, 2050: 377.5496, 2070: 220.6021}.items():
        checked(by_id["594137654"]["properties"]["population"][str(year)] == expected, f"Station PTN_{year} differs from plan")
    example = inspection["ptnVsPt00Example"]
    checked(example is not None and example["PTN_2030"] == 2.767 and example["PT00_2030"] == 0 and example["HITOKU2030"] == "*",
            "PTN/PT00 regression example differs from plan")


def prepare_border(source: dict) -> dict:
    features = collection(source, "border")
    checked("crs" not in source, "Related border declares a CRS; review before treating it as GeoJSON longitude/latitude")
    for feature in features:
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise ValueError("Invalid border feature")
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict) or geometry.get("type") != "LineString":
            raise ValueError("Border must remain LineString, not a clipping polygon")
        points = geometry.get("coordinates")
        if not isinstance(points, list) or len(points) < 2:
            raise ValueError("Invalid border LineString")
        for point in points:
            coordinate(point, "border")
    checked(len(features) == 1823, "Border count differs from plan; review revised source")
    return {"type": "FeatureCollection", "features": features}


def compact_json(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def run() -> dict:
    report: dict[str, object] = {"checkedAt": datetime.now(timezone.utc).isoformat(), "status": "validating"}
    try:
        manifest = json.loads(MANIFEST.read_text())
        sources = manifest["sources"]
        for key in ("population", "related"):
            actual = digest(ROOT / sources[key]["path"])
            checked(actual == sources[key]["sha256"], f"{key}: local original no longer matches source manifest")
        checked(sources["population"]["sha256"] == POPULATION_SHA, "Unreviewed population revision; do not force plan totals")
        set_network_enabled(False)
        transformer = Transformer.from_crs("EPSG:6668", "EPSG:4326", always_xy=True)
        with zipfile.ZipFile(ROOT / sources["population"]["path"]) as archive:
            source = json.loads(archive.read(POPULATION_MEMBER))
        features, inspection = prepare_features(source, transformer)
        del source
        summary = summarize(features)
        report.update({**inspection, **summary})
        verify_plan(features, inspection, summary)
        with zipfile.ZipFile(ROOT / sources["related"]["path"]) as archive:
            border = prepare_border(json.loads(archive.read(sources["related"]["borderMember"])))
            stations = collection(json.loads(archive.read(sources["related"]["stationMember"])), "station")
        station_points = {tuple(f["geometry"]["coordinates"]) for f in stations
                          if f["properties"].get("駅名") == "宮古駅" and f["geometry"]["type"] == "Point"}
        checked(station_points == {(141.94674615, 39.640204425)}, "Miyako station coordinates differ from plan")
        station = list(next(iter(station_points)))
        ring = next(f for f in features if f["id"] == "594137654")["geometry"]["coordinates"][0]
        checked(min(p[0] for p in ring) <= station[0] <= max(p[0] for p in ring)
                and min(p[1] for p in ring) <= station[1] <= max(p[1] for p in ring), "Station not inside mesh 594137654")
        # The selected noop pipeline has no last-used-operation handle in PROJ 9.5.
        # Its concrete definition and component operations are available on Transformer.
        operation = transformer
        crs_report = {"source": "EPSG:6668", "output": "EPSG:4326", "alwaysXY": True,
                      "pyprojVersion": pyproj.__version__, "projVersion": pyproj.proj_version_str,
                      "networkEnabled": is_network_enabled(),
                      "description": operation.description, "definition": operation.definition,
                      "accuracyMeters": operation.accuracy,
                      "note": "For 500m visualization, not survey-grade or tectonic displacement alignment. An identity transform is valid."}
        report.update({"crs": crs_report, "borderCount": len(border["features"]), "station": station})
        metadata = {"schemaVersion": 1, "cityCode": CITY_CODE, "years": YEARS,
                    "series": "PTN", "populationDatasetYear": 2024,
                    "buildingDatasetYear": 2025, "preparedAt": report["checkedAt"],
                    **summary, "crs": crs_report, "station": station,
                    "sourceSha256": {key: sources[key]["sha256"] for key in ("population", "related", "buildings")},
                    "sources": {key: {field: sources[key][field] for field in ("url", "retrievedAt", "sha256", "licenseUrl", "datasetYear")}
                                for key in ("population", "related", "buildings", "terrain")},
                    "coverageNote": "宮古市にSHICODEで割り当てられた500mメッシュ。市境で切り抜かず、建物公開範囲によっても絞り込まない。建物の未表示は無人口を意味しない。",
                    "buildingCoverageNote": "2025年度索引図にR6 LOD1 66.44km²、R7整備範囲20.97km²の記載あり。市全域を覆わず、面積を単純加算したカバー率は示さない。建物形状は全年共通。",
                    "processing": ["SHICODE 03202抽出", "PTN_2020〜2070のみ採用（丸め・再合算なし）", "pyprojによるEPSG:6668→4326、always_xy", "行政界をLineStringとして保持"],
                    "populationNotes": ["2020年は国勢調査を基に調整された基準人口。2025年以降は推計値。", "2055年以降は2050年の仮定を用いた延長推計。", "無居住化処理は1kmメッシュ単位の仮定に基づき、正確な消滅年を示すものではない。"]}
        outputs = {"miyako-population.geojson": {"type": "FeatureCollection", "features": features},
                   "miyako-border.geojson": border, "data-meta.json": metadata}
        encoded = {name: compact_json(value) for name, value in outputs.items()}
        # No output is written until all source/geometry/numeric checks above have passed.
        PUBLIC.mkdir(parents=True, exist_ok=True)
        for name, content in encoded.items():
            temporary = PUBLIC / f"{name}.tmp"
            temporary.write_bytes(content)
            temporary.replace(PUBLIC / name)
        report["outputs"] = {name: {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
                             for name, content in encoded.items()}
        report["status"] = "passed"
        print(json.dumps({"meshCount": summary["meshCount"], "years": YEARS, "totals": summary["totals"],
                          "zeroCounts": summary["zeroCounts"], "outputs": report["outputs"], "crs": crs_report}, ensure_ascii=False, indent=2))
        return report
    except Exception as error:
        report.update({"status": "failed", "error": str(error), "decision": "Do not publish revised/invalid source; review the report. Null is not zero."})
        raise
    finally:
        write_json(REPORT, report)


if __name__ == "__main__":
    try:
        run()
    except Exception:
        LOGGER.exception("Preparation failed")
        sys.exit(1)
