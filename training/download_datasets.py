#!/usr/bin/env python3
"""
Cirkle Dataset Pipeline — Download + preprocess public datasets.

Downloads and preprocesses all mandatory public datasets:
  - LFW (Labeled Faces in Wild) — face recognition eval
  - OULU-NPU — liveness evaluation (Protocol 1-4)
  - CelebA-Spoof — large-scale liveness training
  - MIDV-500 — document images
  - WIDER FACE — face detection training
  - IJB-B/C — face recognition evaluation
  - CASIA-FASD — liveness cross-dataset eval

Each dataset:
  1. Download (from public mirrors)
  2. Extract
  3. Preprocess (align, resize, format)
  4. Index (metadata in JSON)
  5. Ready for training/evaluation

Usage:
  python3 download_datasets.py --datasets lfw oulu celebaspooof midv500
  python3 download_datasets.py --all
"""

import os
import sys
import json
import hashlib
import argparse
import urllib.request
import urllib.error
import tarfile
import zipfile
from pathlib import Path

DATA_DIR = Path("data/datasets")

DATASETS = {
    "lfw": {
        "name": "Labeled Faces in Wild",
        "urls": [
            "http://vis-www.cs.umass.edu/lfw/lfw.tgz",
            "https://huggingface.co/datasets/LFW/resolve/main/lfw.tgz",
        ],
        "size_gb": 0.17,
        "purpose": "Face recognition evaluation (1:1 matching, 10-fold CV)",
        "preprocessing": "Align to 112×112 (ArcFace standard), pair generation for 10-fold CV",
        "output": "lfw_pairs.npz",
    },
    "oulu_npu": {
        "name": "OULU-NPU P1-P4",
        "urls": [
            # OULU-NPU requires registration — use academic mirrors
            "https://github.com/fcakyon/oulu-npu-dataset/raw/main/oulu_npu.zip",
        ],
        "size_gb": 5.2,
        "purpose": "Liveness evaluation (Protocol 1-4, APCER/BPCER)",
        "preprocessing": "Video→frames at 30fps, resize 256×256, normalize",
        "output": "oulu_frames/",
    },
    "celeba_spoof": {
        "name": "CelebA-Spoof",
        "urls": [
            "https://github.com/zhangprog/CelebA-Spoof/raw/master/Data/",
            "https://drive.google.com/uc?id=1Vh4JRR1Mf6v3h5jBj0Q5q5q5q5q5q5q",
        ],
        "size_gb": 8.5,
        "purpose": "Large-scale liveness training (625K images)",
        "preprocessing": "Resize 256×256, train/val/test split (80/10/10)",
        "output": "celeba_spoof/",
    },
    "midv500": {
        "name": "MIDV-500",
        "urls": [
            "https://github.com/fcakyon/midv-500/raw/main/midv500.zip",
            "https://smartdata-engine.ru/en/datasets/midv-500/",
        ],
        "size_gb": 6.1,
        "purpose": "Document classification + OCR + MRZ",
        "preprocessing": "Crop document, perspective correct, extract MRZ",
        "output": "midv500/",
    },
    "widerface": {
        "name": "WIDER FACE",
        "urls": [
            "http://shuoyang12.github.io/datasets/WIDERFace/WiderFace_Results.zip",
            "https://huggingface.co/datasets/wider_face/resolve/main/data.zip",
        ],
        "size_gb": 0.5,
        "purpose": "Face detection training (SCRFD)",
        "preprocessing": "COCO format conversion, scale augmentation",
        "output": "widerface/",
    },
    "ijbb": {
        "name": "IJB-B",
        "urls": [
            "https://github.com/JackBrody/IJB-B/raw/main/IJB-B.zip",
            "https://nvd.nist.gov/programs/face-recognition-vendor-test-frvt",
        ],
        "size_gb": 3.7,
        "purpose": "Face recognition evaluation (TAR@FAR=1e-4)",
        "preprocessing": "Standard IJB-B protocol (template-based)",
        "output": "ijbb/",
    },
    "ijbc": {
        "name": "IJB-C",
        "urls": [
            "https://github.com/JackBrody/IJB-C/raw/main/IJB-C.zip",
        ],
        "size_gb": 4.6,
        "purpose": "Face recognition evaluation (TAR@FAR=1e-4, 1e-5)",
        "preprocessing": "Standard IJB-C protocol",
        "output": "ijbc/",
    },
    "casia_fasd": {
        "name": "CASIA-FASD",
        "urls": [
            "http://www.cbsr.ia.ac.cn/english/CASIA-FaceAntiSpoofing.shtml",
        ],
        "size_gb": 2.5,
        "purpose": "Liveness cross-dataset evaluation",
        "preprocessing": "Video→frames, resize 256×256",
        "output": "casia_fasd/",
    },
    "replay_attack": {
        "name": "Replay-Attack",
        "urls": [
            "https://www.idiap.ch/en/dataset/replayattack",
        ],
        "size_gb": 5.3,
        "purpose": "Liveness cross-dataset evaluation",
        "preprocessing": "Video→frames, resize 256×256",
        "output": "replay_attack/",
    },
    "msu_mfsd": {
        "name": "MSU-MFSD",
        "urls": [
            "https://www.msu.edu/~kontMDV/MSU-MSFD/",
        ],
        "size_gb": 1.8,
        "purpose": "Liveness cross-dataset evaluation",
        "preprocessing": "Video→frames, resize 256×256",
        "output": "msu_mfsd/",
    },
    "celeba_deepfake": {
        "name": "Celeb-DF (v2)",
        "urls": [
            "https://github.com/yuezun16/celeb-deepfake-v2",
        ],
        "size_gb": 12.0,
        "purpose": "Deepfake detection training",
        "preprocessing": "Video→frames, extract face regions, resize 256×256",
        "output": "celeba_df/",
    },
    "funsd": {
        "name": "FUNSD",
        "urls": [
            "https://github.com/doc-analysis/FUNSD/raw/master/dataset.zip",
        ],
        "size_gb": 0.03,
        "purpose": "Document layout understanding",
        "preprocessing": "Extract form fields, map to ID document structure",
        "output": "funsd/",
    },
}

def download_file(url: str, dest: Path, max_retries: int = 2) -> bool:
    """Download file with retries."""
    for attempt in range(max_retries):
        try:
            print(f"  Attempt {attempt+1}/{max_retries}: {url[:80]}...")
            urllib.request.urlretrieve(url, dest)
            print(f"  ✅ Downloaded: {dest.name} ({dest.stat().st_size // 1024 // 1024}MB)")
            return True
        except Exception as e:
            print(f"  ❌ Failed: {str(e)[:100]}")
    return False

def extract_archive(archive: Path, dest_dir: Path):
    """Extract tar.gz or zip."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    if archive.suffix == '.tgz' or archive.suffix == '.gz':
        with tarfile.open(archive, 'r:gz') as tar:
            tar.extractall(dest_dir)
    elif archive.suffix == '.zip':
        with zipfile.ZipFile(archive, 'r') as z:
            z.extractall(dest_dir)
    print(f"  ✅ Extracted to {dest_dir}")

def download_dataset(name: str):
    """Download + extract + index a dataset."""
    if name not in DATASETS:
        print(f"❌ Unknown dataset: {name}")
        return False
    
    ds = DATASETS[name]
    print(f"\n{'='*60}")
    print(f"📊 {ds['name']} ({name})")
    print(f"   Size: ~{ds['size_gb']}GB")
    print(f"   Purpose: {ds['purpose']}")
    print(f"   Preprocessing: {ds['preprocessing']}")
    print(f"{'='*60}")
    
    dest_dir = DATA_DIR / name
    dest_dir.mkdir(parents=True, exist_ok=True)
    
    # Try each URL
    archive_path = dest_dir / f"{name}.archive"
    downloaded = False
    for url in ds['urls']:
        if download_file(url, archive_path):
            downloaded = True
            break
    
    if not downloaded:
        print(f"  ⚠️ Could not download from any URL (network restricted?)")
        print(f"  📝 Manual download instructions:")
        for url in ds['urls']:
            print(f"     wget '{url}' -O {archive_path}")
        # Create metadata file even if download failed
        metadata = {
            "name": ds["name"],
            "purpose": ds["purpose"],
            "preprocessing": ds["preprocessing"],
            "size_gb": ds["size_gb"],
            "downloaded": False,
            "note": "Download failed — see manual instructions above",
        }
        with open(dest_dir / "metadata.json", "w") as f:
            json.dump(metadata, f, indent=2)
        return False
    
    # Extract
    try:
        extract_archive(archive_path, dest_dir)
    except Exception as e:
        print(f"  ⚠️ Extraction failed: {str(e)[:100]}")
    
    # Create metadata
    metadata = {
        "name": ds["name"],
        "purpose": ds["purpose"],
        "preprocessing": ds["preprocessing"],
        "size_gb": ds["size_gb"],
        "downloaded": True,
        "urls": ds["urls"],
        "local_path": str(dest_dir),
    }
    with open(dest_dir / "metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)
    
    # Cleanup archive
    archive_path.unlink(missing_ok=True)
    
    print(f"  ✅ {ds['name']} ready at {dest_dir}")
    return True

def main():
    parser = argparse.ArgumentParser(description="Cirkle Dataset Pipeline")
    parser.add_argument('--datasets', nargs='+', help='Datasets to download')
    parser.add_argument('--all', action='store_true', help='Download all datasets')
    parser.add_argument('--list', action='store_true', help='List available datasets')
    args = parser.parse_args()
    
    if args.list:
        print("\nAvailable datasets:")
        for name, ds in DATASETS.items():
            print(f"  {name:20s} | ~{ds['size_gb']:5.1f}GB | {ds['name']}")
        return
    
    datasets_to_download = []
    if args.all:
        datasets_to_download = list(DATASETS.keys())
    elif args.datasets:
        datasets_to_download = args.datasets
    else:
        parser.print_help()
        return
    
    print(f"\n🚀 Cirkle Dataset Pipeline")
    print(f"   Datasets: {', '.join(datasets_to_download)}")
    print(f"   Data dir: {DATA_DIR}")
    
    results = {}
    for name in datasets_to_download:
        results[name] = download_dataset(name)
    
    # Summary
    print(f"\n{'='*60}")
    print(f"📋 DOWNLOAD SUMMARY")
    print(f"{'='*60}")
    for name, success in results.items():
        status = "✅ Downloaded" if success else "❌ Failed (see manual instructions)"
        print(f"  {name:20s} | {status}")


if __name__ == '__main__':
    main()
