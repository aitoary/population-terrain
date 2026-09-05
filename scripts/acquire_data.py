#!/usr/bin/env python3
"""Acquire and pin official inputs. Never publish originals or silently adopt revisions."""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import shutil
import struct
import sys
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

LOGGER = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw"
MANIFEST = ROOT / "data/source-manifest.json"
POPULATION_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/m500r6/m500r6-24/500m_mesh_2024_03_GEOJSON.zip"
POPULATION_SHA = "2ca30e11eaf5328098c93af59a11ec2f55e73a727c3359f297a4667c628c0d59"
POPULATION_MEMBER = "500m_mesh_2024_03_GEOJSON/500m_mesh_2024_03.geojson"
CKAN_URL = "https://www.geospatial.jp/ckan/api/3/action/package_show?id=plateau-03202-miyako-shi-2025"
CATALOG_URL = "https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets"
BUILDINGS_URL = "https://assets.cms.plateau.reearth.io/assets/2f/68cfb0-341f-4e67-a522-89d844f79a85/03202_miyako-shi_city_2025_citygml_1_op_bldg_3dtiles_lod1/tileset.json"
BUILDINGS_SHA = "dc2b322e126757e1bae9d38061b0fbc6c016a786b48fa610f9e7441452a82a91"
RELATED_URL = "https://assets.cms.plateau.reearth.io/assets/39/0bd192-ed87-4666-bc7c-c2d9edd69581/03202_miyako-shi_2024_related.zip"
INDEX_URL = "https://assets.cms.plateau.reearth.io/assets/df/6b6322-deea-4594-83a7-cbc713f8ab05/03202_indexmap_op.pdf"
TERRAIN_URL = "https://tile.plateauview.mlit.go.jp/terrain/layer.json"
POPULATION_LICENSE = "https://nlftp.mlit.go.jp/ksj/other/agreement_01.html"
PLATEAU_LICENSE = "https://www.mlit.go.jp/plateau/site-policy/"
TERRAIN_LICENSE = "https://docs.plateauview.mlit.go.jp/datasets/terrain/"


def digest(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def write_json(path: Path, value: object) -> None:
    text = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def checked(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def acquire(refresh: bool) -> dict:
    RAW.mkdir(parents=True, exist_ok=True)
    previous = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    records: dict[str, dict] = {}
    report: dict = {
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "planDate": "2026-09-05", "hashChanges": [], "specDifferences": [],
        "decision": "pending", "sources": records,
    }

    def download(key: str, url: str, filename: str, year: int | None, license_url: str) -> Path:
        old = previous.get("sources", {}).get(key)
        if not refresh and old and old["url"] == url:
            cached = ROOT / old["path"]
            if cached.is_file() and digest(cached) == old["sha256"]:
                records[key] = old
                print(f"cached {key}: {old['sha256']}", flush=True)
                return cached
        request = urllib.request.Request(url, headers={"User-Agent": "population-terrain-source-verifier/1.0"})
        temporary: Path | None = None
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                checked(response.status == 200, f"{key}: HTTP {response.status}")
                checked(urlparse(response.url).scheme == "https", f"{key}: non-HTTPS redirect")
                with tempfile.NamedTemporaryFile(dir=RAW, delete=False) as output:
                    temporary = Path(output.name)
                    shutil.copyfileobj(response, output)
                sha = digest(temporary)
                destination = RAW / f"{sha}-{filename}"
                size = temporary.stat().st_size
                content_length = response.headers.get("Content-Length")
                checked(size > 0, f"{key}: empty response")
                if content_length is not None:
                    checked(size == int(content_length), f"{key}: truncated response")
                temporary.replace(destination)
                records[key] = {
                    "url": url, "resolvedUrl": response.url, "datasetYear": year,
                    "retrievedAt": datetime.now(timezone.utc).isoformat(), "sha256": sha,
                    "path": str(destination.relative_to(ROOT)), "bytes": size,
                    "licenseUrl": license_url, "httpStatus": response.status,
                    "contentType": response.headers.get("Content-Type"),
                    "accessControlAllowOrigin": response.headers.get("Access-Control-Allow-Origin"),
                    "etag": response.headers.get("ETag"),
                    "lastModified": response.headers.get("Last-Modified"),
                }
                if old and old["sha256"] != sha:
                    report["hashChanges"].append({"source": key, "previous": old["sha256"], "current": sha})
                print(f"acquired {key}: {size} bytes / {sha}", flush=True)
                return destination
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def expect(label: str, actual: object, expected: object) -> None:
        if actual != expected:
            report["specDifferences"].append({"field": label, "expected": expected, "actual": actual})

    def archive(path: Path, key: str, members: list[str]) -> list[str]:
        with zipfile.ZipFile(path) as zf:
            checked(zf.testzip() is None, f"{key}: invalid ZIP CRC")
            names = zf.namelist()
            checked(len(names) == len(set(names)), f"{key}: duplicate ZIP entries")
            for member in members:
                checked(member in names, f"{key}: missing expected member {member}; inspect revised archive")
            records[key]["members"] = names
            return names

    try:
        ckan_path = download("ckanCatalog", CKAN_URL, "ckan.json", 2025, PLATEAU_LICENSE)
        ckan = json.loads(ckan_path.read_text())
        checked(ckan["success"] is True, "CKAN reported failure")
        dataset = ckan["result"]
        expect("ckan.name", dataset["name"], "plateau-03202-miyako-shi-2025")
        resources = {resource["url"]: resource for resource in dataset["resources"]}
        checked(RELATED_URL in resources, "Related ZIP no longer present in official 2025 catalog")
        checked(INDEX_URL in resources, "Index map no longer present in official 2025 catalog")
        catalog_path = download("plateauCatalog", CATALOG_URL, "plateau-catalog.json", 2025, PLATEAU_LICENSE)
        catalog = json.loads(catalog_path.read_text())
        entries = [d for d in catalog["datasets"] if d.get("city_code") == "03202"
                   and d.get("type_en") == "bldg" and d.get("year") == 2025 and d.get("lod") == "1"]
        checked(len(entries) == 1, f"Expected exactly one Miyako 2025 LOD1 entry; found {len(entries)}")
        entry = entries[0]
        for key, value in {"url": BUILDINGS_URL, "spec": "5.0", "format": "3D Tiles", "format_version": "1.0"}.items():
            expect(f"catalog.{key}", entry.get(key), value)
        population = download("population", POPULATION_URL, "500m_mesh_2024_03_GEOJSON.zip", 2024, POPULATION_LICENSE)
        archive(population, "population", [POPULATION_MEMBER, "500m_mesh_2024_03_GEOJSON/KS-META-500mMR6-24_03.xml"])
        expect("population.sha256", records["population"]["sha256"], POPULATION_SHA)
        related = download("related", RELATED_URL, "03202_miyako-shi_2024_related.zip", 2025, PLATEAU_LICENSE)
        names = archive(related, "related", [])
        for kind in ("border", "station"):
            matches = [n for n in names if Path(n).name == f"03202_miyako-shi_city_2024_{kind}.geojson"]
            checked(len(matches) == 1, f"related: missing or ambiguous {kind} GeoJSON")
            records["related"][f"{kind}Member"] = matches[0]
        records["related"]["filenameYearNote"] = "Listed in the 2025 v5 catalog; the ZIP and member names retain 2024."
        tileset_path = download("buildings", BUILDINGS_URL, "tileset.json", 2025, PLATEAU_LICENSE)
        expect("buildings.sha256", records["buildings"]["sha256"], BUILDINGS_SHA)
        tileset = json.loads(tileset_path.read_text())
        expect("tileset.asset.version", tileset["asset"]["version"], "1.0")
        refs: list[str] = []

        def visit(tile: dict) -> None:
            content = tile.get("content", {})
            uri = content.get("uri", content.get("url"))
            if uri:
                refs.append(uri)
            for child in tile.get("children", []):
                visit(child)

        visit(tileset["root"])
        expect("tileset.contentCount", len(refs), 410)
        sample_urls = [urljoin(BUILDINGS_URL, ref) for ref in refs if ref.endswith("/data409.b3dm")]
        checked(len(sample_urls) == 1, "Previously checked sample is no longer referenced by tileset")
        sample_path = download("buildingSample", sample_urls[0], "data409.b3dm", 2025, PLATEAU_LICENSE)
        sample = sample_path.read_bytes()
        checked(sample[:4] == b"b3dm", "Building sample is not b3dm")
        version, byte_length = struct.unpack_from("<II", sample, 4)
        checked(version == 1 and byte_length == len(sample), "Invalid b3dm header/length")
        terrain_path = download("terrain", TERRAIN_URL, "layer.json", None, TERRAIN_LICENSE)
        terrain = json.loads(terrain_path.read_text())
        for key, value in {"format": "quantized-mesh-1.0", "maxzoom": 18, "scheme": "tms"}.items():
            expect(f"terrain.{key}", terrain.get(key), value)
        checked(bool(terrain.get("tiles")), "Terrain has no tile references")
        for key in ("buildings", "buildingSample", "terrain"):
            expect(f"{key}.cors", records[key]["accessControlAllowOrigin"], "*")
        index_path = download("indexMap", INDEX_URL, "03202_indexmap_op.pdf", 2025, PLATEAU_LICENSE)
        checked(index_path.read_bytes().startswith(b"%PDF"), "Index map is not PDF")
        # The related archive has no hash in the plan. Once pinned, a change needs review.
        for change in report["hashChanges"]:
            if change["source"] == "related":
                report["specDifferences"].append({"field": "related.sha256", **change})
        checked(not report["specDifferences"], "Source differs from approved plan/pin. Review data/acquisition-report.json before changing expectations.")
        selected = {"retrievedAt": records["plateauCatalog"]["retrievedAt"], "catalogUrl": CATALOG_URL,
                    "catalogSha256": records["plateauCatalog"]["sha256"], "entry": entry}
        write_json(ROOT / "data/plateau-2025-lod1-entry.json", selected)
        report["decision"] = "accepted: population and LOD1 hashes match plan; catalog/spec/ZIP/CORS checks passed"
        report["limitations"] = ["Only one b3dm downloaded; all 410 references are not verified.",
                                  "Terrain tile availability and browser rendering require separate checks."]
        result = {"schemaVersion": 1, "cityCode": "03202", "checkedAt": report["checkedAt"],
                  "planDate": "2026-09-05", "sources": records,
                  "buildingDatasetYear": 2025, "buildingLod": 1,
                  "ckan": {k: dataset.get(k) for k in ("name", "title", "license_id", "license_title", "license_url", "metadata_modified")},
                  "buildingEntryPath": "data/plateau-2025-lod1-entry.json",
                  "decision": report["decision"]}
        write_json(MANIFEST, result)
        return result
    except Exception as error:
        report["decision"] = "blocked: no new source manifest published"
        report["error"] = str(error)
        raise
    finally:
        write_json(ROOT / "data/acquisition-report.json", report)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Fetch again; keep old content-addressed originals and report changes")
    args = parser.parse_args()
    try:
        acquire(args.refresh)
    except Exception:
        LOGGER.exception("Acquisition failed")
        sys.exit(1)
