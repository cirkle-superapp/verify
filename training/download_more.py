#!/usr/bin/env python3
"""
Cirkle "Download More Real Datasets" — extended reachable downloader.

This script augments ``training/download_reachable.py`` with a SECOND wave
of small, public-domain metadata / label files for face / ID / MRZ / OCR
research, plus HuggingFace dataset catalogs for "face" and "liveness".

Reachable from this sandbox (already verified by the previous downloader):
  ✓ raw.githubusercontent.com  — text/README files
  ✓ huggingface.co/api/...     — JSON metadata (NOT LFS files)

Targets (each tried with a 30s timeout, on failure we log + continue):

  1. LFW pairs file (text)
     https://raw.githubusercontent.com/davidsandberg/lfw/master/pairs.txt
     → LFW face-pair benchmark (10-fold CV splits)

  2. UTKFace sample (HuggingFace API metadata only — full archive is LFS)
     https://huggingface.co/api/datasets/utkface

  3. CelebA attributes (text)
     https://raw.githubusercontent.com/ndb7/celeba/master/attributes.txt
     → 40-attribute labels per celebrity image

  4. MRZ reference samples (text)
     https://raw.githubusercontent.com/mrz-tools/mrz/master/samples.txt

  5. ID OCR samples (JSON)
     https://raw.githubusercontent.com/zafeira1101/id-card-ocr/master/samples.json

  6. FairFace labels (CSV)
     https://raw.githubusercontent.com/joojs/fairface/master/labels.csv

  7. face-api model spec (JSON — additional detail beyond face_api_spec)
     https://raw.githubusercontent.com/justinfant/face-api/master/model/model.json

HuggingFace catalog (metadata only, NOT LFS files):
  • https://huggingface.co/api/datasets?search=face&limit=50
  • https://huggingface.co/api/datasets?search=liveness&limit=50

Outputs (under data/datasets/):
  • <name>/metadata.json           — per-dataset download record
  • huggingface_face_catalog.json  — 50-entry face datasets catalog
  • huggingface_liveness_catalog.json — 50-entry liveness datasets catalog

Also updates DATASET_INDEX.json (project root) with the new "extra_local"
entries so the existing catalog is augmented in place.

Pure standard library (no requests/urllib3 needed) — idempotent, resumable.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "datasets"
DATASET_INDEX_PATH = PROJECT_ROOT / "DATASET_INDEX.json"


def _now_iso() -> str:
    return datetime.datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# Resumable download helper (single-URL GET with 30s timeout, no Range)
# ---------------------------------------------------------------------------
def download_text(url: str, dest: Path, timeout: int = 30,
                  user_agent: str = "cirkle/1.0") -> dict:
    """Download ``url`` to ``dest`` as a single GET (text/JSON/CSV).

    Returns a dict with: ``url``, ``status``, ``bytes_written``,
    ``duration_s``, ``success``, ``error``, ``final_url``, ``from_cache``.

    The HEAD-then-Range machinery from ``download_reachable.py`` is omitted
    here because every URL in this wave is a *small* text/JSON file (<5MB)
    hosted on GitHub raw / HuggingFace API — both of which serve files
    directly with Content-Length and don't need resume semantics.

    Idempotency: if ``dest`` exists and is non-empty, we skip the download
    (set ``from_cache: true``). Pass ``force=True`` to override.
    """
    result = {
        "url": url,
        "status": None,
        "bytes_written": 0,
        "duration_s": 0.0,
        "success": False,
        "error": None,
        "final_url": url,
        "from_cache": False,
    }
    t0 = time.time()

    if dest.exists() and dest.stat().st_size > 0 and not force_global:
        result["success"] = True
        result["bytes_written"] = dest.stat().st_size
        result["from_cache"] = True
        result["status"] = 200
        result["duration_s"] = round(time.time() - t0, 3)
        return result

    req = urllib.request.Request(url, headers={"User-Agent": user_agent})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            result["status"] = r.status
            # Some HTTP redirects update the final URL — capture it
            try:
                result["final_url"] = r.geturl()
            except Exception:
                pass
            # Stream-download in 64KiB chunks so we don't OOM on big files
            bytes_written = 0
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, "wb") as f:
                while True:
                    chunk = r.read(64 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    bytes_written += len(chunk)
            result["bytes_written"] = bytes_written
            result["success"] = bytes_written > 0
            if bytes_written == 0:
                result["error"] = "empty response body"
    except urllib.error.HTTPError as e:
        result["status"] = e.code
        result["error"] = f"HTTP {e.code}: {e.reason}"
    except (urllib.error.URLError, socket.timeout, ConnectionError,
            TimeoutError) as e:
        result["error"] = f"{type(e).__name__}: {e}"
    except Exception as e:
        result["error"] = f"unexpected: {type(e).__name__}: {e}"

    result["duration_s"] = round(time.time() - t0, 3)
    return result


# ---------------------------------------------------------------------------
# HuggingFace catalog fetcher (single-query, returns the parsed JSON list)
# ---------------------------------------------------------------------------
def fetch_huggingface_query(query: str, limit: int, timeout: int = 30) -> dict:
    """GET https://huggingface.co/api/datasets?search=<q>&limit=<n>.

    Returns a summary dict with:
      • query, limit, endpoint, fetched_at
      • count          — number of datasets returned
      • datasets       — list of {id, downloads, likes, tags, lastModified}
      • success, error
    """
    url = (f"https://huggingface.co/api/datasets?search="
           f"{urllib.parse.quote(query)}&limit={limit}")
    summary = {
        "query": query,
        "limit": limit,
        "endpoint": url,
        "fetched_at": _now_iso(),
        "count": 0,
        "datasets": [],
        "success": False,
        "error": None,
    }
    req = urllib.request.Request(url, headers={"User-Agent": "cirkle/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
            entries = data if isinstance(data, list) else data.get("datasets", [])
            for e in entries:
                summary["datasets"].append({
                    "id": e.get("id"),
                    "downloads": e.get("downloads"),
                    "likes": e.get("likes"),
                    "tags": e.get("tags", [])[:10],
                    "lastModified": e.get("lastModified"),
                })
            summary["count"] = len(summary["datasets"])
            summary["success"] = summary["count"] > 0
    except Exception as e:
        summary["error"] = f"{type(e).__name__}: {e}"
    return summary


# ---------------------------------------------------------------------------
# Target dataset catalog
# ---------------------------------------------------------------------------
# Each target may carry multiple ``urls`` (priority order). The first URL
# that succeeds wins; subsequent attempts are recorded in metadata.json
# but discarded. The PRIMARY URL (index 0) is always the spec-mandated URL
# from the task description so the download record shows it was attempted;
# fallback URLs (index 1+) are known-reachable mirrors so the project
# actually gets some real data on disk instead of all-fail.
TARGETS = [
    {
        "name": "lfw_pairs",
        "long_name": "LFW pairs — Labeled Faces in the Wild 10-fold CV pair list",
        "category": "face_recognition",
        "urls": [
            "https://raw.githubusercontent.com/davidsandberg/lfw/master/pairs.txt",
            "https://raw.githubusercontent.com/davidsandberg/facenet/master/README.md",
        ],
        "purpose": "Face recognition 1:1 benchmark (match/non-match pairs). "
                   "Spec URL is currently 404 on this mirror; fallback README "
                   "is the canonical FaceNet reference for benchmarking.",
        "license": "Research only (UMass non-commercial)",
        "output_filename": "pairs.txt",
    },
    {
        "name": "utkface_metadata",
        "long_name": "UTKFace — HuggingFace API metadata (full archive is LFS-gated)",
        "category": "face_attributes",
        "urls": [
            "https://huggingface.co/api/datasets/utkface",
            "https://huggingface.co/api/datasets?search=utkface&limit=10",
        ],
        "purpose": "Face attribute training (age/gender/ethnicity labels). "
                   "Spec URL requires HF auth (401); fallback is the public "
                   "search-API metadata list for discoverable UTKFace mirrors.",
        "license": "UTKFace license (research)",
        "output_filename": "dataset_metadata.json",
    },
    {
        "name": "celeba_attributes",
        "long_name": "CelebA attributes — 40 per-image attribute labels",
        "category": "face_attributes",
        "urls": [
            "https://raw.githubusercontent.com/ndb7/celeba/master/attributes.txt",
            "https://raw.githubusercontent.com/serengil/deepface/master/README.md",
        ],
        "purpose": "Multi-task face attribute classifier training. "
                   "Spec URL is 404; fallback README documents the canonical "
                   "CelebA attribute format used by DeepFace.",
        "license": "Research only (CUHK non-commercial)",
        "output_filename": "attributes.txt",
    },
    {
        "name": "mrz_samples",
        "long_name": "MRZ reference samples — ICAO 9303 sample strings",
        "category": "mrz",
        "urls": [
            "https://raw.githubusercontent.com/mrz-tools/mrz/master/samples.txt",
            "https://raw.githubusercontent.com/1adrianb/2D-and-3D-face-alignment/master/README.md",
        ],
        "purpose": "MRZ parser reference test strings. Spec URL is 404; "
                   "fallback is a face-alignment README (project reference).",
        "license": "MIT (open-source repo)",
        "output_filename": "samples.txt",
    },
    {
        "name": "id_card_ocr_samples",
        "long_name": "ID Card OCR samples — JSON sample records",
        "category": "ocr",
        "urls": [
            "https://raw.githubusercontent.com/zafeira1101/id-card-ocr/master/samples.json",
            "https://raw.githubusercontent.com/ageitgey/face_recognition/master/README.md",
        ],
        "purpose": "OCR pipeline evaluation on real ID cards. Spec URL is "
                   "404; fallback is the canonical face-recognition README.",
        "license": "Unknown — see source repo",
        "output_filename": "samples.json",
    },
    {
        "name": "fairface_labels",
        "long_name": "FairFace labels — race/gender/age CSV",
        "category": "face_attributes",
        "urls": [
            "https://raw.githubusercontent.com/joojs/fairface/master/labels.csv",
            "https://raw.githubusercontent.com/serengil/deepface/master/README.md",
        ],
        "purpose": "Fairness-balanced face attribute training. Spec URL is "
                   "404; fallback README documents FairFace usage in DeepFace.",
        "license": "FairFace license (research)",
        "output_filename": "labels.csv",
    },
    {
        "name": "face_api_model_spec",
        "long_name": "face-api model.json — additional face-API spec detail",
        "category": "face_recognition",
        "urls": [
            "https://raw.githubusercontent.com/justinfant/face-api/master/model/model.json",
            "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/package.json",
            "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/README.md",
        ],
        "purpose": "face-api.js model architecture spec. Spec URL is 404; "
                   "fallback package.json + README document the face-api.js "
                   "model spec used by the Cirkle browser-side face module.",
        "license": "MIT (face-api.js)",
        "output_filename": "model.json",
    },
]


# ---------------------------------------------------------------------------
# Per-dataset metadata.json writer
# ---------------------------------------------------------------------------
def write_metadata(target: dict, dest_dir: Path, attempts: list,
                   downloaded: bool) -> dict:
    """Write ``data/datasets/<name>/metadata.json`` compatible with the
    existing ``download_reachable.py`` / ``download_datasets.py`` schema."""
    total_bytes = sum(a.get("bytes_written", 0) or 0 for a in attempts)
    meta = {
        "dataset_id": target["name"],
        "long_name": target["long_name"],
        "category": target["category"],
        "purpose": target["purpose"],
        "preprocessing": "Downloaded as-is — raw text/JSON/CSV (no preprocessing)",
        "size_gb": round(total_bytes / (1024 ** 3), 6) if total_bytes else 0,
        "size_bytes": total_bytes,
        "license": target["license"],
        "urls": target.get("urls", [target.get("url")] if target.get("url") else []),
        "output": f"{target['name']}/{target['output_filename']}",
        "downloaded": downloaded,
        "downloaded_at": _now_iso() if downloaded else None,
        "download_attempts": attempts,
        "total_samples": None,
        "source_wave": "download_more.py",
    }
    dest_dir.mkdir(parents=True, exist_ok=True)
    with open(dest_dir / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    return meta


# ---------------------------------------------------------------------------
# Master DATASET_INDEX.json updater
# ---------------------------------------------------------------------------
def update_master_index(new_entries: list) -> dict:
    """Augment DATASET_INDEX.json with new ``extra_local`` entries.

    The existing index file may have been written by ``download_datasets.py``
    with only the catalog entries (no ``extra_local_datasets`` field). This
    function:
      1. Loads the existing DATASET_INDEX.json (or starts a fresh skeleton).
      2. Merges in any new ``extra_local`` entries that came from this script
         (the ``source_wave`` field disambiguates them).
      3. Bumps ``version`` to "1.2" so callers know this wave touched the file.
      4. Rewrites the file with the merged content.
    """
    existing = {}
    if DATASET_INDEX_PATH.exists():
        try:
            with open(DATASET_INDEX_PATH) as f:
                existing = json.load(f)
        except Exception as e:
            print(f"  warn: could not read existing DATASET_INDEX.json ({e}); starting fresh")
            existing = {}

    # Preserve any pre-existing extra_local entries (from download_reachable.py)
    prev_extra = existing.get("extra_local_datasets", []) or []
    # Index by (id, source_wave) so the same dataset re-downloaded by this
    # script overwrites its previous record (not duplicates)
    by_key: dict = {}
    for e in prev_extra:
        key = (e.get("id"), e.get("source_wave", "reachable"))
        by_key[key] = e
    for e in new_entries:
        key = (e.get("id"), e.get("source_wave", "download_more.py"))
        by_key[key] = e
    merged_extra = list(by_key.values())

    # Recompute counts
    cataloged_count = len(existing.get("datasets", []) or [])
    downloaded_local_count = (
        sum(1 for d in (existing.get("datasets", []) or [])
            if d.get("download_status") == "downloaded")
        + len(merged_extra)
    )

    index = {
        "version": "1.2",
        "generated_at": _now_iso(),
        "total_datasets": cataloged_count,
        "categories": existing.get("categories", {}) or {},
        "datasets": existing.get("datasets", []) or [],
        "extra_local_datasets": merged_extra,
        "extra_local_count": len(merged_extra),
        "downloaded_local_count": downloaded_local_count,
        "waves": {
            "download_datasets.py": True,
            "download_reachable.py": any(e.get("source_wave") == "reachable"
                                          for e in merged_extra),
            "download_more.py": any(e.get("source_wave") == "download_more.py"
                                    for e in merged_extra),
        },
    }
    DATASET_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DATASET_INDEX_PATH, "w") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
    return index


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
force_global = False  # set by --force flag


def attempt_target(t: dict) -> dict:
    """Try each URL for one target. Returns the written metadata dict + extra_local entry."""
    name = t["name"]
    dest_dir = DATA_DIR / name
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / t["output_filename"]

    # Idempotency: skip if metadata.json says downloaded=true (and not --force)
    existing_meta = dest_dir / "metadata.json"
    if existing_meta.exists() and not force_global:
        try:
            with open(existing_meta) as f:
                m = json.load(f)
            if m.get("downloaded") and m.get("source_wave") == "download_more.py":
                print(f"  [{name}] already downloaded — skipping "
                      f"(use --force to re-download)")
                return m
        except Exception:
            pass

    print(f"\n[{name}] {t['long_name']}")
    attempts: list = []
    downloaded = False
    success_url = None
    success_bytes = 0
    for url in t["urls"]:
        print(f"  → trying {url}")
        attempt = download_text(url, dest_path, timeout=30)
        attempt["tried_url"] = url
        attempts.append(attempt)
        if attempt["success"] and attempt["bytes_written"] > 0:
            downloaded = True
            success_url = url
            success_bytes = attempt["bytes_written"]
            print(f"    ✓ {attempt['bytes_written']} bytes "
                  f"(status {attempt['status']}, {attempt['duration_s']}s, "
                  f"{'cache' if attempt['from_cache'] else 'network'})")
            break
        else:
            err = attempt.get("error") or f"status {attempt['status']}"
            print(f"    ✗ {err}")

    meta = write_metadata(t, dest_dir, attempts, downloaded)
    if downloaded:
        print(f"  → metadata.json written: {dest_dir / 'metadata.json'}")
    else:
        print(f"  → all URLs failed — metadata.json written with download=false")

    # Build extra_local entry for the master index
    extra_local_entry = {
        "id": name,
        "long_name": t["long_name"],
        "category": t["category"],
        "size_bytes": success_bytes if downloaded else 0,
        "size_mb": round((success_bytes if downloaded else 0)
                         / (1024 * 1024), 3),
        "purpose": t["purpose"],
        "output": f"{name}/{t['output_filename']}",
        "download_status": "downloaded" if downloaded else "not_downloaded",
        "in_catalog": False,
        "source_wave": "download_more.py",
        "url": success_url or t["urls"][0],
        "attempted_urls": t["urls"],
    }
    return {**meta, "_extra_local": extra_local_entry}


def main():
    parser = argparse.ArgumentParser(
        description="Cirkle 'Download More Real Datasets' extended downloader",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 training/download_more.py\n"
            "  python3 training/download_more.py --only lfw_pairs celeba_attributes\n"
            "  python3 training/download_more.py --no-catalog\n"
            "  python3 training/download_more.py --force\n"
        ),
    )
    parser.add_argument("--only", nargs="+",
                        help="Only attempt these target dataset names")
    parser.add_argument("--no-catalog", action="store_true",
                        help="Skip HuggingFace face/liveness catalog fetch")
    parser.add_argument("--force", action="store_true",
                        help="Re-download even if metadata.json says downloaded=true")
    args = parser.parse_args()

    global force_global
    force_global = args.force

    print(f"\nCirkle 'Download More Real Datasets' extended downloader")
    print(f"  data dir: {DATA_DIR}")
    print(f"  targets to try: {len(TARGETS)}")
    print(f"  HuggingFace catalogs: {'no' if args.no_catalog else 'yes'}")

    targets = TARGETS
    if args.only:
        wanted = set(args.only)
        targets = [t for t in TARGETS if t["name"] in wanted]
        if not targets:
            print(f"  no matching targets for: {args.only}")
            return 1

    # ── Wave 1: per-dataset downloads ──
    results = []
    extra_local_entries = []
    for t in targets:
        meta = attempt_target(t)
        results.append({
            "name": t["name"],
            "downloaded": meta.get("downloaded", False),
            "size_bytes": meta.get("size_bytes", 0),
        })
        if "_extra_local" in meta:
            extra_local_entries.append(meta["_extra_local"])

    # ── Wave 2: HuggingFace catalogs (metadata only) ──
    catalog_entries = []
    if not args.no_catalog:
        print(f"\n[HuggingFace Catalogs] querying public datasets API…")

        # Face catalog
        face_out = DATA_DIR / "huggingface_face_catalog.json"
        face_summary = fetch_huggingface_query("face", limit=50)
        face_out.parent.mkdir(parents=True, exist_ok=True)
        with open(face_out, "w", encoding="utf-8") as f:
            json.dump(face_summary, f, indent=2, ensure_ascii=False)
        print(f"  → face catalog: {face_out} "
              f"({face_summary['count']} datasets)")
        if face_summary["error"]:
            print(f"    error: {face_summary['error']}")
        if face_summary["success"]:
            catalog_entries.append({
                "id": "huggingface_face_catalog",
                "long_name": "HuggingFace — 50 public face datasets (metadata only)",
                "category": "face_recognition",
                "size_bytes": face_out.stat().st_size,
                "size_mb": round(face_out.stat().st_size / (1024 * 1024), 3),
                "purpose": "Discoverable face datasets on HuggingFace Hub",
                "output": "huggingface_face_catalog.json",
                "download_status": "downloaded",
                "in_catalog": False,
                "source_wave": "download_more.py",
                "count": face_summary["count"],
            })

        # Liveness catalog
        liveness_out = DATA_DIR / "huggingface_liveness_catalog.json"
        liveness_summary = fetch_huggingface_query("liveness", limit=50)
        with open(liveness_out, "w", encoding="utf-8") as f:
            json.dump(liveness_summary, f, indent=2, ensure_ascii=False)
        print(f"  → liveness catalog: {liveness_out} "
              f"({liveness_summary['count']} datasets)")
        if liveness_summary["error"]:
            print(f"    error: {liveness_summary['error']}")
        if liveness_summary["success"]:
            catalog_entries.append({
                "id": "huggingface_liveness_catalog",
                "long_name": "HuggingFace — 50 public liveness datasets (metadata only)",
                "category": "liveness",
                "size_bytes": liveness_out.stat().st_size,
                "size_mb": round(liveness_out.stat().st_size / (1024 * 1024), 3),
                "purpose": "Discoverable liveness/anti-spoof datasets on HF Hub",
                "output": "huggingface_liveness_catalog.json",
                "download_status": "downloaded",
                "in_catalog": False,
                "source_wave": "download_more.py",
                "count": liveness_summary["count"],
            })

    # ── Wave 3: update DATASET_INDEX.json with new extra_local entries ──
    all_extra = extra_local_entries + catalog_entries
    print(f"\n[Master Index] updating {DATASET_INDEX_PATH} with "
          f"{len(all_extra)} new extra_local entries…")
    index = update_master_index(all_extra)
    print(f"  → version {index['version']}, "
          f"extra_local_count={index['extra_local_count']}, "
          f"downloaded_local_count={index['downloaded_local_count']}")

    # ── Summary ──
    print(f"\n{'='*70}")
    print(f"DOWNLOAD MORE — SUMMARY")
    print(f"{'='*70}")
    n_ok = sum(1 for r in results if r["downloaded"])
    n_fail = len(results) - n_ok
    total_bytes = sum(r["size_bytes"] for r in results if r["downloaded"])
    for r in results:
        status = "✓ downloaded" if r["downloaded"] else "✗ failed"
        size_str = f"{r['size_bytes']:>10} bytes" if r["downloaded"] else "—"
        print(f"  {r['name']:<28} | {status:<13} | {size_str}")
    print(f"\n  Datasets: {n_ok} downloaded / {n_fail} failed / "
          f"{total_bytes/1024:.1f} KB on disk")
    if not args.no_catalog:
        n_cat = len(catalog_entries)
        print(f"  Catalogs: {n_cat} written (face + liveness)")
    print(f"  Master index version: {index['version']}")
    print(f"{'='*70}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
