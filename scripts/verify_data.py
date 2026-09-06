#!/usr/bin/env python3
"""Read-only offline verification of public outputs against pinned local originals."""

import json
import zipfile

from acquire_data import (
    MANIFEST,
    POPULATION_MEMBER,
    POPULATION_SHA,
    ROOT,
    checked,
    digest,
)
from prepare_population import prepare_border, prepare_features, summarize, verify_plan
from pyproj import Transformer
# pyproj 3.7's supported public API is an unmarked Cython re-export.
from pyproj.network import set_network_enabled  # pyright: ignore[reportPrivateImportUsage]


def verify() -> dict:
    sources = json.loads(MANIFEST.read_text())["sources"]
    for key in ("population", "related", "buildings"):
        checked(digest(ROOT / sources[key]["path"]) == sources[key]["sha256"], f"{key}: original hash mismatch")
    checked(sources["population"]["sha256"] == POPULATION_SHA, "Unreviewed population revision")
    checked(sources["buildings"]["sha256"] == "dc2b322e126757e1bae9d38061b0fbc6c016a786b48fa610f9e7441452a82a91", "Unreviewed building revision")
    set_network_enabled(False)
    with zipfile.ZipFile(ROOT / sources["population"]["path"]) as archive:
        features, inspection = prepare_features(json.loads(archive.read(POPULATION_MEMBER)), Transformer.from_crs("EPSG:6668", "EPSG:4326", always_xy=True))
    summary = summarize(features)
    verify_plan(features, inspection, summary)
    public = ROOT / "public/data"
    actual = json.loads((public / "miyako-population.geojson").read_text())
    checked(actual == {"type": "FeatureCollection", "features": features}, "Public cells/values/geometry differ from pinned PTN source")
    with zipfile.ZipFile(ROOT / sources["related"]["path"]) as archive:
        border = prepare_border(json.loads(archive.read(sources["related"]["borderMember"])))
    checked(json.loads((public / "miyako-border.geojson").read_text()) == border, "Public border differs from original LineStrings")
    metadata = json.loads((public / "data-meta.json").read_text())
    for key, value in summary.items():
        checked(metadata[key] == value, f"Metadata mismatch: {key}")
    checked(metadata["series"] == "PTN" and metadata["years"] == list(range(2020, 2071, 5)), "Invalid series/years")
    checked(metadata["buildingDatasetYear"] == 2025 and metadata["populationDatasetYear"] == 2024, "Dataset year mismatch")
    checked(metadata["sourceSha256"] == {key: sources[key]["sha256"] for key in ("population", "related", "buildings")}, "Metadata source hashes mismatch")
    return {"status": "passed", "readOnly": True, "meshCount": len(features), "years": metadata["years"], "valuesChecked": len(features) * len(metadata["years"]), "borderLineStrings": len(border["features"]), "totals": summary["totals"], "zeroCounts": summary["zeroCounts"], "nullCounts": summary["nullCounts"], "station": next(f["properties"]["population"] for f in features if f["id"] == "594137654"), "ptnVsPt00Example": inspection["ptnVsPt00Example"]}


if __name__ == "__main__":
    print(json.dumps(verify(), ensure_ascii=False, indent=2))
