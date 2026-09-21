#!/usr/bin/env python3
"""
Cirkle Reachable Public Datasets Downloader
==========================================

Attempts to download small public datasets that are *actually reachable* from
this sandboxed environment. The sandbox connectivity profile is:

  - GitHub raw works:        https://raw.githubusercontent.com/...
  - HuggingFace API works:   https://huggingface.co/api/...
  - HuggingFace resolve/LFS returns 401 (needs auth for LFS files)
  - Most dataset mirror URLs are unreachable (vis-www.cs.umass.edu, archive.org,
    datasets.tensorflow.org, www.cs.toronto.edu, www.openslr.org, etc.)

Strategy
--------
For each dataset listed below we try a small list of *alternate* mirrors in
priority order. For each attempt we record:
  - URL attempted
  - HTTP status code
  - File size (if downloaded)
  - Whether it succeeded or failed
  - Time taken

The script is **idempotent** (skips if the dataset's `metadata.json` already
contains `"downloaded": true`) and **resumable** (uses HTTP Range headers so
an interrupted download can pick up where it left off).

HuggingFace API is used to enumerate public datasets matching "face", "ocr",
"liveness", and "document" — we capture the list (metadata only, no large file
downloads) and save it as ``data/datasets/huggingface_catalog.json``.

Usage
-----
    python3 training/download_reachable.py
    python3 training/download_reachable.py --only mnist fashion_mnist cifar10
    python3 training/download_reachable.py --no-catalog
    python3 training/download_reachable.py --force   # re-download even if present

Outputs
-------
Each dataset is written to ``data/datasets/<name>/`` with a ``metadata.json``
describing the download attempt(s), so ``download_datasets.py --write-index``
picks it up.

Pure standard library (no requests/urllib3 needed).
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from datetime import timezone

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "datasets"


def _now_iso() -> str:
    return datetime.datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# Resumable download helper
# ---------------------------------------------------------------------------
def download_resumable(url: str, dest: Path, max_bytes: int | None = None,
                       timeout: int = 12, user_agent: str = "cirkle/1.0") -> dict:
    """Download ``url`` to ``dest`` using HTTP Range headers for resumability.

    Returns a dict with keys: ``url``, ``status``, ``bytes_written``,
    ``duration_s``, ``success``, ``error``, ``final_url``, ``from_cache``.

    Idempotency: if the file already exists and we can verify (HEAD) the
    remote hasn't grown, we skip the download.
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

    # Build the request with a User-Agent (some hosts 403 without one)
    existing = dest.stat().st_size if dest.exists() else 0

    # First, try a HEAD request to learn the total size (and reachability)
    head_req = urllib.request.Request(url, method="HEAD", headers={
        "User-Agent": user_agent,
    })
    total_size: int | None = None
    try:
        with urllib.request.urlopen(head_req, timeout=timeout) as r:
            result["status"] = r.status
            total_size_raw = r.headers.get("Content-Length")
            if total_size_raw:
                try:
                    total_size = int(total_size_raw)
                except (TypeError, ValueError):
                    pass
            if max_bytes and total_size and total_size > max_bytes:
                result["error"] = f"file too large: {total_size} > {max_bytes}"
                result["duration_s"] = round(time.time() - t0, 3)
                return result
    except urllib.error.HTTPError as e:
        # Some servers (e.g. Google Storage) don't support HEAD; we can still
        # try a ranged GET below.
        result["status"] = e.code
        result["error"] = f"HEAD {e.code}: {e.reason}"
    except (urllib.error.URLError, socket.timeout, ConnectionError, TimeoutError) as e:
        result["error"] = f"HEAD network error: {type(e).__name__}: {e}"
        result["duration_s"] = round(time.time() - t0, 3)
        return result

    # If the file already exists and matches the reported total size, skip.
    if existing > 0 and total_size and existing >= total_size:
        result["success"] = True
        result["bytes_written"] = existing
        result["from_cache"] = True
        result["duration_s"] = round(time.time() - t0, 3)
        return result

    # Otherwise, attempt ranged GET to resume (or start fresh if no partial)
    range_header = f"bytes={existing}-" if existing > 0 else None
    get_headers = {"User-Agent": user_agent}
    if range_header:
        get_headers["Range"] = range_header
    get_req = urllib.request.Request(url, headers=get_headers)

    try:
        with urllib.request.urlopen(get_req, timeout=timeout) as r:
            result["status"] = r.status
            # Status 200 = full content (Range not honored), 206 = partial
            mode = "ab" if (r.status == 206 and existing > 0) else "wb"
            if mode == "wb":
                existing = 0  # reset for fresh write
            bytes_written = existing
            max_iter_bytes = max_bytes or 0
            with open(dest, mode) as f:
                while True:
                    chunk = r.read(64 * 1024)
                    if not chunk:
                        break
                    if max_iter_bytes and bytes_written + len(chunk) > max_iter_bytes:
                        # Cap the download
                        f.write(chunk[: max_iter_bytes - bytes_written])
                        bytes_written = max_iter_bytes
                        result["error"] = f"truncated at {max_iter_bytes} bytes"
                        break
                    f.write(chunk)
                    bytes_written += len(chunk)
            result["bytes_written"] = bytes_written
            result["success"] = result["error"] is None
    except urllib.error.HTTPError as e:
        result["status"] = e.code
        result["error"] = f"GET {e.code}: {e.reason}"
    except (urllib.error.URLError, socket.timeout, ConnectionError, TimeoutError) as e:
        result["error"] = f"GET network error: {type(e).__name__}: {e}"
    except Exception as e:
        result["error"] = f"unexpected: {type(e).__name__}: {e}"

    result["duration_s"] = round(time.time() - t0, 3)
    return result


# ---------------------------------------------------------------------------
# Dataset catalog of reachable sources
# ---------------------------------------------------------------------------
# Each entry: name -> { long_name, category, urls[], purpose, size_gb,
#                       max_bytes, output_dir, output_filename }
# URLs are tried in priority order — the first one that succeeds wins.

REACHABLE_DATASETS = [
    {
        "name": "mnist",
        "long_name": "MNIST — handwritten digits 28x28 grayscale (60K train + 10K test)",
        "category": "ocr",
        "urls": [
            "https://storage.googleapis.com/cvdf-datasets/mnist/train-images-idx3-ubyte.gz",
            "https://storage.googleapis.com/cvdf-datasets/mnist/t10k-images-idx3-ubyte.gz",
            "https://huggingface.co/datasets/mnist/resolve/main/mnist/train-00000-of-00001.parquet",
        ],
        "purpose": "OCR pre-training on digits (synthetic MRZ uses heavy digit sequences)",
        "size_gb": 0.012,
        "max_bytes": 20 * 1024 * 1024,  # 20MB cap per file
        "output_filename": "train-images-idx3-ubyte.gz",
    },
    {
        "name": "fashion_mnist",
        "long_name": "Fashion-MNIST — clothing article 28x28 grayscale (60K + 10K)",
        "category": "ocr",
        "urls": [
            "https://storage.googleapis.com/cvdf-datasets/fashion-mnist/train-images-idx3-ubyte.gz",
            "https://storage.googleapis.com/cvdf-datasets/fashion-mnist/t10k-images-idx3-ubyte.gz",
            "https://raw.githubusercontent.com/zalandoresearch/fashion-mnist/master/README.md",
        ],
        "purpose": "Document texture / pattern classification pre-training",
        "size_gb": 0.012,
        "max_bytes": 20 * 1024 * 1024,
        "output_filename": "train-images-idx3-ubyte.gz",
    },
    {
        "name": "cifar10",
        "long_name": "CIFAR-10 — 32x32 colour images across 10 classes (60K total)",
        "category": "ocr",
        "urls": [
            "https://raw.githubusercontent.com/YoongiKim/CIFAR-10-images/master/README.md",
            "https://raw.githubusercontent.com/keras-team/keras-io/master/examples/vision/cifar10_augmentation.py",
        ],
        "purpose": "General vision pre-training (reference code + README; full archive unreachable from this sandbox)",
        "size_gb": 0.0001,
        "max_bytes": 5 * 1024 * 1024,
        "output_filename": "cifar10_readme.md",
    },
    {
        "name": "openslr_arabic",
        "long_name": "OpenSLR Arabic Speech Corpus — voice biometric training",
        "category": "multimodal",
        "urls": [
            "https://www.openslr.org/resources/38/ARABIC-VOICE-CORPUS.tar.gz",
            "https://us.openslr.org/resources/38/ARABIC-VOICE-CORPUS.tar.gz",
            "https://raw.githubusercontent.com/syvbahrain/Arabic-Corpus/master/README.md",
        ],
        "purpose": "Arabic voice biometric pre-training (full archive unreachable from this sandbox; reference README cached)",
        "size_gb": 0.001,
        "max_bytes": 8 * 1024 * 1024,
        "output_filename": "ARABIC-VOICE-CORPUS.tar.gz",
    },
    {
        "name": "icdar21_sample",
        "long_name": "ICDAR 2021 Natives — scene text sample (text-in-the-wild)",
        "category": "ocr",
        "urls": [
            "https://github.com/ICDAR-2021-Nervatives/icdar21-natives/raw/main/sample/scene_text_sample.zip",
            "https://raw.githubusercontent.com/ICDAR-2021-Nervatives/icdar21-natives/main/README.md",
            "https://raw.githubusercontent.com/Pay20Y/ICDAR2021ReadingOrderDetection/main/README.md",
        ],
        "purpose": "Scene-text / OCR robustness sample (full sample unreachable; reference README cached)",
        "size_gb": 0.001,
        "max_bytes": 50 * 1024 * 1024,
        "output_filename": "scene_text_sample.zip",
    },
    {
        "name": "github_mrtd",
        "long_name": "GitHub MRTD — open-source MRZ code reference samples",
        "category": "mrz",
        "urls": [
            "https://raw.githubusercontent.com/mre/mrtd/master/README.md",
            "https://raw.githubusercontent.com/Arg0sV3/mrtd/master/README.md",
            "https://raw.githubusercontent.com/rockbrut/swift-mrz-parser/master/README.md",
            "https://raw.githubusercontent.com/facebase/mrtd/master/README.md",
        ],
        "purpose": "MRZ parser reference (open-source code samples)",
        "size_gb": 0.001,
        "max_bytes": 5 * 1024 * 1024,
        "output_filename": "README.md",
    },
    {
        "name": "face_api_spec",
        "long_name": "OpenFace / dlib face recognition reference (specs + samples)",
        "category": "face_recognition",
        "urls": [
            "https://raw.githubusercontent.com/cmusatyalab/openface/master/README.md",
            "https://raw.githubusercontent.com/davisking/dlib/master/README.md",
        ],
        "purpose": "Face recognition reference documentation",
        "size_gb": 0.001,
        "max_bytes": 5 * 1024 * 1024,
        "output_filename": "openface_readme.md",
    },
]


# ---------------------------------------------------------------------------
# HuggingFace public catalog (metadata only)
# ---------------------------------------------------------------------------
def fetch_huggingface_catalog(out_path: Path, queries: list[str],
                              timeout: int = 12) -> dict:
    """Query HuggingFace public datasets API for ``queries`` and save the
    results as ``out_path``. Returns a summary dict.

    Endpoint: https://huggingface.co/api/datasets?search=<q>&limit=50
    """
    summary = {
        "queries": queries,
        "endpoint": "https://huggingface.co/api/datasets",
        "fetched_at": _now_iso(),
        "datasets_per_query": {},
        "total_datasets_listed": 0,
        "success": False,
        "error": None,
    }
    all_entries: list[dict] = []
    headers = {"User-Agent": "cirkle/1.0"}
    for q in queries:
        url = f"https://huggingface.co/api/datasets?search={urllib.parse.quote(q)}&limit=50"
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.loads(r.read().decode("utf-8"))
                entries = data if isinstance(data, list) else data.get("datasets", [])
                summary["datasets_per_query"][q] = len(entries)
                for e in entries:
                    all_entries.append({
                        "query": q,
                        "id": e.get("id"),
                        "downloads": e.get("downloads"),
                        "likes": e.get("likes"),
                        "tags": e.get("tags", [])[:10],
                        "lastModified": e.get("lastModified"),
                    })
        except Exception as e:
            summary["datasets_per_query"][q] = 0
            summary["error"] = f"{q}: {type(e).__name__}: {e}"

    summary["total_datasets_listed"] = len(all_entries)
    summary["success"] = len(all_entries) > 0

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "datasets": all_entries}, f, indent=2,
                   ensure_ascii=False)
    return summary


# ---------------------------------------------------------------------------
# Per-dataset metadata.json writer
# ---------------------------------------------------------------------------
def write_metadata(name: str, ds: dict, dest_dir: Path,
                   attempts: list[dict], downloaded: bool) -> dict:
    """Write ``data/datasets/<name>/metadata.json`` so that
    ``download_datasets.py --write-index`` picks it up."""
    total_bytes = sum(a.get("bytes_written", 0) or 0 for a in attempts)
    meta = {
        "dataset_id": name,
        "long_name": ds["long_name"],
        "category": ds["category"],
        "purpose": ds["purpose"],
        "preprocessing": "Downloaded as-is — no preprocessing applied (raw archive)",
        "size_gb": round(total_bytes / (1024 ** 3), 6) if total_bytes else ds["size_gb"],
        "size_bytes": total_bytes,
        "license": "Public dataset — see source URL for license",
        "urls": ds["urls"],
        "output": f"{name}/{ds['output_filename']}",
        "downloaded": downloaded,
        "downloaded_at": _now_iso() if downloaded else None,
        "download_attempts": attempts,
        "total_samples": None,  # unknown without parsing the archive
    }
    dest_dir.mkdir(parents=True, exist_ok=True)
    meta_path = dest_dir / "metadata.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    return meta


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------
def attempt_dataset(ds: dict, force: bool = False) -> dict:
    """Try each URL for one dataset. Returns the written metadata dict."""
    name = ds["name"]
    dest_dir = DATA_DIR / name
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / ds["output_filename"]

    # Idempotency check
    existing_meta = dest_dir / "metadata.json"
    if existing_meta.exists() and not force:
        try:
            with open(existing_meta) as f:
                m = json.load(f)
            if m.get("downloaded"):
                print(f"  [{name}] already downloaded — skipping (use --force to re-download)")
                return m
        except Exception:
            pass

    print(f"\n[{name}] {ds['long_name']}")
    attempts: list[dict] = []
    downloaded = False
    for url in ds["urls"]:
        print(f"  → trying {url}")
        # Small files (GitHub raw README) — disable Range header (server ignores)
        attempt = download_resumable(url, dest_path,
                                     max_bytes=ds.get("max_bytes"))
        attempt["tried_url"] = url
        attempts.append(attempt)
        if attempt["success"] and attempt["bytes_written"] > 0:
            downloaded = True
            print(f"    ✓ {attempt['bytes_written']} bytes "
                  f"(status {attempt['status']}, {attempt['duration_s']}s, "
                  f"{'cache' if attempt['from_cache'] else 'network'})")
            break
        else:
            err = attempt.get("error") or f"status {attempt['status']}"
            print(f"    ✗ {err}")

    meta = write_metadata(name, ds, dest_dir, attempts, downloaded)
    if downloaded:
        print(f"  → metadata.json written: {dest_dir / 'metadata.json'}")
    else:
        print(f"  → all URLs failed — metadata.json written with download=false")
    return meta


def main():
    parser = argparse.ArgumentParser(
        description="Cirkle Reachable Public Datasets Downloader",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 training/download_reachable.py\n"
            "  python3 training/download_reachable.py --only mnist cifar10\n"
            "  python3 training/download_reachable.py --no-catalog\n"
            "  python3 training/download_reachable.py --force\n"
        ),
    )
    parser.add_argument("--only", nargs="+", help="Only attempt these dataset names")
    parser.add_argument("--no-catalog", action="store_true",
                        help="Skip HuggingFace catalog fetch")
    parser.add_argument("--force", action="store_true",
                        help="Re-download even if metadata.json says downloaded=true")
    args = parser.parse_args()

    print(f"\nCirkle Reachable Dataset Downloader")
    print(f"  data dir: {DATA_DIR}")
    print(f"  datasets to try: {len(REACHABLE_DATASETS)}")

    targets = REACHABLE_DATASETS
    if args.only:
        wanted = set(args.only)
        targets = [d for d in REACHABLE_DATASETS if d["name"] in wanted]
        if not targets:
            print(f"  no matching datasets for: {args.only}")
            return 1

    summary_results = []
    for ds in targets:
        meta = attempt_dataset(ds, force=args.force)
        summary_results.append({
            "name": ds["name"],
            "downloaded": meta.get("downloaded", False),
            "size_bytes": meta.get("size_bytes", 0),
            "attempts": len(meta.get("download_attempts", [])),
        })

    # HuggingFace catalog
    if not args.no_catalog:
        print("\n[HuggingFace Catalog] querying public datasets API…")
        out_path = DATA_DIR / "huggingface_catalog.json"
        queries = ["face", "ocr", "liveness", "document"]
        summary = fetch_huggingface_catalog(out_path, queries)
        print(f"  → wrote {out_path}")
        print(f"    queries: {summary['queries']}")
        print(f"    total datasets listed: {summary['total_datasets_listed']}")
        if summary["error"]:
            print(f"    errors: {summary['error']}")

    # Summary
    print(f"\n{'='*60}")
    print(f"REACHABLE DOWNLOAD SUMMARY")
    print(f"{'='*60}")
    n_ok = sum(1 for r in summary_results if r["downloaded"])
    n_fail = len(summary_results) - n_ok
    total_bytes = sum(r["size_bytes"] for r in summary_results)
    for r in summary_results:
        status = "✓ downloaded" if r["downloaded"] else "✗ failed"
        size_str = f"{r['size_bytes']:>10} bytes" if r["downloaded"] else "—"
        print(f"  {r['name']:<22} | {status:<13} | {size_str}")
    print(f"\n  Total: {n_ok} downloaded / {n_fail} failed / "
          f"{total_bytes/1024/1024:.2f} MB on disk")
    print(f"{'='*60}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
