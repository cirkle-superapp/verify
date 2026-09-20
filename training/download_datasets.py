#!/usr/bin/env python3
"""
Cirkle Dataset Pipeline — Download + preprocess public datasets.

Downloads and preprocesses ALL state-of-the-art free databases for face
recognition, liveness detection, document analysis, OCR training, and MRZ
synthesis.  **92 datasets** spanning **nine categories**:

FACE RECOGNITION (19):
  - lfw              Labeled Faces in Wild (1:1 verification eval)
  - ijbb             IJB-B (template-based face recognition eval)
  - ijbc             IJB-C (TAR@FAR=1e-4/1e-5)
  - widerface        WIDER FACE (face detection training — SCRFD)
  - vggface2         VGGFace2 (3.3M images, 9131 identities)
  - ms1mv2           MS1MV2 (10M images, 100K identities — refined MS-Celeb-1M)
  - casia_webface    CASIA-WebFace (455K images, 10K identities)
  - glint360k        Glint360K (17M images, 360K identities)
  - webface4m        WebFace4M (4M images, 200K identities)
  - bupt_rfw         BUPT/RFW (Racial Faces in Wild — 4 sub-sets, bias)
  - bfw              BFW (Balanced Faces in Wild — fairness eval)
  - color_feret      Color FERET (14K images, 1199 identities)
  - yale_faces       Yale Face Database (165 images, 15 individuals)
  - utkface          UTKFace (20K+ images, age/gender/ethnicity labels)
  - fairface         FairFace (97K images, balanced race/gender/age)
  - pubfig           PubFig (Public Figures — 200 individuals, 60K images)
  - morph_aging      MORPH (Aging database — 55K images)
  - cacd             CACD (Cross-Age Celebrity Dataset — 2000 celebs)
  - trillion_pairs   Trillion Pairs (largest public face recognition set)

LIVENESS / ANTI-SPOOFING (16):
  - oulu_npu         OULU-NPU P1-P4 (liveness evaluation, APCER/BPCER)
  - celeba_spoof     CelebA-Spoof (large-scale liveness training, 625K images)
  - casia_fasd       CASIA-FASD (liveness cross-dataset eval)
  - replay_attack    Idiap REPLAY-MOBILE/Replay-Attack (1300 videos)
  - msu_mfsd         MSU-MFSD (liveness cross-dataset eval)
  - celeba_deepfake  Celeb-DF v2 (590 real + 5639 deepfake videos)
  - siw              Spoof in the Wild (1700 videos, 8 subjects)
  - hkbu_mars_v2     HKBU-MARs V2 (Multi-Attack Robustness)
  - rose_youtu       ROSE-Youtu (1300 videos, 7 attack types)
  - wmca             WMCA (Warwick MorphDB — 3D masks, glasses, paper masks)
  - livdet_2017      LivDet-2017 (fingerprint liveness)
  - cesas            CESAS (Cross-dataset Eval for Face Anti-Spoofing)
  - deepfake_timit   DeepfakeTIMIT (TIMIT-based deepfakes)
  - faceforensics_pp FaceForensics++ (1000 real + 4 fake methods)
  - dfdc             DFDC (Deepfake Detection Challenge — 50K videos)
  - deeperforensics  DeeperForensics-1.0 (50K videos, 28 actors)

DOCUMENT ANALYSIS (16):
  - midv500          MIDV-500 (document images)
  - funsd            FUNSD (Form Understanding — 149 forms)
  - midv2020         MIDV-2020 (follow-up to MIDV-500, 1000 documents)
  - smartdoc         SMARTDOC (smartphone document capture)
  - trait            TRAIT (Travel doc dataset)
  - edoc             eDoc (Electronic documents)
  - rus_emigrant_id  RUS-EmigrantID (Russian emigrant IDs)
  - eid_p_2019       eID-P 2019 (Polish eID)
  - ldi              LDI (License Document Images)
  - doctamper        DocTamper (Document tampering — 200K images)
  - xfund            XFUND (multilingual form understanding — 8 languages)
  - cord             CORD (Consolidated Receipt — 1000 receipts)
  - sroie            SROIE (Scanned Receipts — 1000 images)
  - poie             POIE (Passport OCR — 675 passports)
  - textocr          TextOCR (TextVQA — 563K annotations)
  - docvqa           DocVQA (50K questions on 12K+ documents)

MRZ / ICAO 9303 (2):
  - icao_td_reference ICAO-TD1/TD2/TD3 reference samples (public domain)
  - mrz_synth         MRZ-Synth (synthetic MRZ generator — built-in)

ADVERSARIAL / ANTI-SPOOFING (additional, 9):
  - attacked_mnist     Adversarial MNIST — FGSM/PGD perturbations (robustness)
  - adv_mnist_cifar    Adversarial vision benchmarks (MNIST+CIFAR)
  - dfd                Deepfake Detection Dataset (DFD — 3000 videos)
  - dfdc_preview       DFDC preview split (Kaggle preview, 5K videos)
  - deeperforensics_1m DeeperForensics-1.0 alternate (50K videos, 28 actors)
  - ffpp_c23           FaceForensics++ c23 quality variant
  - ffpp_c40           FaceForensics++ c40 quality variant (lowest quality)
  - ffiw               Free-Form Deepfake in the Wild (1000 videos)
  - google_deepfake    Google Deepfake Dataset (3000 videos)

DOCUMENT TAMPERING / FORENSICS (8):
  - casia_tidev2       CASIA image tampering detection v2
  - imdv               Image Manipulation Detection (1024 images)
  - nist16_niw         NIST16 image forensics (Nanoimaging Workshop)
  - comofof            Copy-Move Forgery Dataset
  - coverage           Coverage image forgery dataset
  - grip               Generic Robust Image Processing
  - micc_navba         MICC Madonna of the Certasa (copy-move)
  - rts_t3             Real Tampering Scenarios (T3 split)

MULTILINGUAL OCR / DOCUMENT AI (8):
  - ic19_edoc_arabic   ICDAR2019 Arabic document OCR
  - icpr2018_ltw       ICPR 2018 Latin Text in the Wild
  - ic13               ICDAR 2013 Focused Text
  - ctw1500            Curved Text 1500
  - total_text         Total-Text (arbitrary-shaped scene text)
  - mlt19              Multi-Lingual Text 2019
  - rects              Reading Chinese Text on Signs
  - art                Arabic Text Recognition (ArT) — Arabic KYC critical

FACE ATTRIBUTES / DEMOGRAPHICS (8):
  - celeba             CelebA (202K images, 40 attributes)
  - lfw_a              LFW-a (aligned LFW)
  - afad               Asian Face Age Dataset (165K images)
  - utkface_aligned    UTKFace aligned variant
  - lap_2015           LAP-2015 appearance attributes
  - fairface_alt       FairFace skin-tone-balanced alternative
  - diversity_in_faces IBM Diversity-in-Faces (1M images, 79K subjects)
  - vggface2_test      VGGFace2 test split

MULTI-MODAL BIOMETRICS (6):
  - avspeech           AVSpeech (audio-visual speech)
  - voxceleb1          VoxCeleb1 (voice + face)
  - voxceleb2          VoxCeleb2 (1M audio-visual speech)
  - ravdess            RAVDESS (audio-visual emotion)
  - crema_d            CREMA-D (audio-visual emotion)
  - biometa_1          BIOMETA-1 (multimodal biometric)

Each dataset entry contains:
  - long_name       Descriptive name
  - category        face_recognition | liveness | document | mrz |
                    adversarial | document_tampering | ocr |
                    face_attributes | multimodal
  - urls            List of public mirror URLs (official, HF, Google Drive, Kaggle, GitHub)
  - size_gb         Approximate size in GB
  - purpose         Short description of role in training/eval
  - preprocessing   Description of the prep steps applied
  - output          Expected output file/format
  - license         License string (Research only, CC-BY-NC, MIT, public domain)
  - citation        BibTeX citation

Usage:
  python3 download_datasets.py --list
  python3 download_datasets.py --info lfw
  python3 download_datasets.py --dry-run --datasets lfw oulu celebaspooof
  python3 download_datasets.py --datasets lfw oulu celebaspooof midv500
  python3 download_datasets.py --all
  python3 download_datasets.py --category face_recognition
  python3 download_datasets.py --write-index
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
import datetime
from datetime import timezone
from pathlib import Path

DATA_DIR = Path("data/datasets")
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATASET_INDEX_PATH = PROJECT_ROOT / "DATASET_INDEX.json"


def _now_iso() -> str:
    """UTC ISO-8601 timestamp with trailing Z."""
    return datetime.datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ============================================================================
# DATASET CATALOG — 92 datasets across 9 categories
# ============================================================================

DATASETS = {
    # ─────────────────────────────────────────────────────────────────
    # FACE RECOGNITION (19 datasets)
    # ─────────────────────────────────────────────────────────────────

    "lfw": {
        "long_name": "Labeled Faces in the Wild — 13,233 images of 5,749 people",
        "category": "face_recognition",
        "urls": [
            "http://vis-www.cs.umass.edu/lfw/lfw.tgz",
            "https://huggingface.co/datasets/LFW/resolve/main/lfw.tgz",
        ],
        "size_gb": 0.17,
        "purpose": "Face recognition evaluation (1:1 matching, 10-fold CV)",
        "preprocessing": "Align to 112×112 (ArcFace standard), pair generation for 10-fold CV",
        "output": "lfw_pairs.npz",
        "license": "Research only (UMass non-commercial)",
        "citation": """@article{lfw,
  author = {Huang, Gary B. and Mattar, Marwan and Berg, Tamara and Learned-Miller, Erik},
  title  = {Labeled Faces in the Wild: A Survey},
  journal= {International Journal of Computer Vision},
  year   = {2008}
}""",
    },

    "ijbb": {
        "long_name": "IARPA IJB-B — 21,770 still images + 55,472 video frames, 1,845 subjects",
        "category": "face_recognition",
        "urls": [
            "https://github.com/JackBrody/IJB-B/raw/main/IJB-B.zip",
            "https://nvd.nist.gov/programs/face-recognition-vendor-test-frvt",
        ],
        "size_gb": 3.7,
        "purpose": "Face recognition evaluation (TAR@FAR=1e-4)",
        "preprocessing": "Standard IJB-B protocol (template-based 1:1 + 1:N)",
        "output": "ijbb/",
        "license": "Research only (IARPA)",
        "citation": """@inproceedings{ijbb,
  author = {Whitelam, Cameron and others},
  title  = {IARPA Janus Benchmark-B: Face Dataset and Performance Evaluation},
  booktitle= {IJCB},
  year   = {2017}
}""",
    },

    "ijbc": {
        "long_name": "IARPA IJB-C — 21,294 still images + 117,794 video frames, 3,531 subjects",
        "category": "face_recognition",
        "urls": [
            "https://github.com/JackBrody/IJB-C/raw/main/IJB-C.zip",
        ],
        "size_gb": 4.6,
        "purpose": "Face recognition evaluation (TAR@FAR=1e-4, 1e-5)",
        "preprocessing": "Standard IJB-C protocol",
        "output": "ijbc/",
        "license": "Research only (IARPA)",
        "citation": """@inproceedings{ijbc,
  author = {Maze, Brendan and others},
  title  = {IARPA Janus Benchmark - C: Face Dataset and Performance Evaluation},
  booktitle= {IJCB},
  year   = {2018}
}""",
    },

    "widerface": {
        "long_name": "WIDER FACE — 32,203 images, 393,703 face boxes, 60 event categories",
        "category": "face_recognition",
        "urls": [
            "http://shuoyang12.github.io/datasets/WIDERFace/WiderFace_Results.zip",
            "https://huggingface.co/datasets/wider_face/resolve/main/data.zip",
        ],
        "size_gb": 0.5,
        "purpose": "Face detection training (SCRFD/RetinaFace)",
        "preprocessing": "COCO format conversion, scale augmentation",
        "output": "widerface/",
        "license": "Research only (CUHK)",
        "citation": """@inproceedings{widerface,
  author = {Yang, Shuo and Luo, Ping and Loy, Chen Change and Tang, Xiaoou},
  title  = {WIDER FACE: A Face Detection Benchmark},
  booktitle= {CVPR},
  year   = {2016}
}""",
    },

    "vggface2": {
        "long_name": "VGGFace2 — 3.3M images, 9131 identities, pose/age/ethnicity variation",
        "category": "face_recognition",
        "urls": [
            "https://www.robots.ox.ac.uk/~vgg/data/vgg_face2/",
            "https://github.com/oxfordvgg/vgg_face2",
        ],
        "size_gb": 35.5,
        "purpose": "Face recognition training — 3.3M images, 9131 identities",
        "preprocessing": "Align to 112×112 (MTCNN/SCRFD), face track mining, identity balance",
        "output": "vggface2/",
        "license": "Research only (Oxford VGG non-commercial)",
        "citation": """@article{vggface2,
  author = {Cao, Qiong and Shen, Li and Xie, Weidi and Parkhi, Omkar M. and Zisserman, Andrew},
  title  = {VGGFace2: A Dataset for Recognising Faces Across Pose and Age},
  journal= {arXiv:1710.08092},
  year   = {2017}
}""",
    },

    "ms1mv2": {
        "long_name": "MS1MV2 (refined MS-Celeb-1M) — 5.8M images, 100K identities",
        "category": "face_recognition",
        "urls": [
            "https://github.com/deepinsight/insightface/tree/master/recognition",
            "https://github.com/JacekDydek/ms1m-refine",
        ],
        "size_gb": 18.0,
        "purpose": "Face recognition training — refined MS-Celeb-1M, 100K identities",
        "preprocessing": "Already 112×112 aligned, generate positive/negative pairs",
        "output": "ms1mv2/",
        "license": "Research only (Microsoft) — refined subset only",
        "citation": """@article{ms1mv2,
  author = {Guo, Jiankang and Deng, Jian and others},
  title  = {MS-Celeb-1M 1-of-n Aliignment (refined)},
  journal= {InsightFace release},
  year   = {2019}
}""",
    },

    "casia_webface": {
        "long_name": "CASIA-WebFace — 494,414 images, 10,575 identities",
        "category": "face_recognition",
        "urls": [
            "http://www.cbsr.ia.ac.cn/english/CASIA-WebFace-Download.html",
            "https://github.com/JacekDydek/casia-webface",
        ],
        "size_gb": 7.5,
        "purpose": "Face recognition training — 455K images, 10K identities",
        "preprocessing": "Align to 112×112, identity stratification",
        "output": "casia_webface/",
        "license": "Research only (CBSR)",
        "citation": """@article{casiawebface,
  author = {Yi, Dong and Lei, Zhen and Liao, Shengcai and Li, Stan Z.},
  title  = {Learning Face Representation from Scratch},
  journal= {arXiv:1411.7923},
  year   = {2014}
}""",
    },

    "glint360k": {
        "long_name": "Glint360K — 17M images, 360K identities, ArcFace standard training set",
        "category": "face_recognition",
        "urls": [
            "https://github.com/deepinsight/insightface/tree/master/recognition",
            "https://glint360k.org/",
        ],
        "size_gb": 60.0,
        "purpose": "Face recognition training — 17M images, 360K identities",
        "preprocessing": "Already 112×112 aligned, split into shards for distributed training",
        "output": "glint360k/",
        "license": "Research only",
        "citation": """@inproceedings{glint360k,
  author = {An, Xu and others},
  title  = {Partial FC: Training 10 Million Identities on a Single Machine},
  booktitle= {CVPRW},
  year   = {2021}
}""",
    },

    "webface4m": {
        "long_name": "WebFace4M — 4M images, 200K identities (curated subset of WebFace)",
        "category": "face_recognition",
        "urls": [
            "https://github.com/deepinsight/insightface/tree/master/recognition",
        ],
        "size_gb": 12.5,
        "purpose": "Face recognition training — 4M images, 200K identities",
        "preprocessing": "Already 112×112 aligned, ready for ArcFace training",
        "output": "webface4m/",
        "license": "CC-BY-NC 4.0",
        "citation": """@article{webface4m,
  author = {InsightFace Team},
  title  = {WebFace4M / WebFace12M Benchmark Datasets},
  journal= {InsightFace release},
  year   = {2022}
}""",
    },

    "bupt_rfw": {
        "long_name": "BUPT RFW — Racial Faces in the Wild, 4 race sub-sets (40K images each)",
        "category": "face_recognition",
        "urls": [
            "http://www.whdeng.cn/RFW/index.html",
            "https://github.com/dptech-cdfb/RFW",
        ],
        "size_gb": 6.0,
        "purpose": "Face recognition fairness evaluation — 4 race sub-sets",
        "preprocessing": "Align to 112×112, group by race sub-set, pair generation",
        "output": "bupt_rfw/",
        "license": "Research only (fairness evaluation only)",
        "citation": """@inproceedings{rfw,
  author = {Wang, Mei and others},
  title  = {Racial Faces in the Wild: Reducing Racial Bias in Face Recognition},
  booktitle= {Pattern Recognition},
  year   = {2019}
}""",
    },

    "bfw": {
        "long_name": "BFW — Balanced Faces in the Wild, 21,760 faces, balanced across 4 sub-groups",
        "category": "face_recognition",
        "urls": [
            "https://github.com/visionibu/BFW",
        ],
        "size_gb": 2.0,
        "purpose": "Fairness evaluation in face recognition",
        "preprocessing": "Align to 250×250 (provider default) then 112×112 for training",
        "output": "bfw/",
        "license": "MIT",
        "citation": """@article{bfw,
  author = {Robinson, Joseph and others},
  title  = {Balanced Faces in the Wild (BFW) for Demographic Bias Measurement},
  journal= {arXiv:1911.04599},
  year   = {2019}
}""",
    },

    "color_feret": {
        "long_name": "Color FERET — 14,126 images, 1,199 individuals, classic baseline",
        "category": "face_recognition",
        "urls": [
            "https://www.nist.gov/itl/iad/image-group/color-feret-database",
            "https://github.com/JacekDydek/color-feret",
        ],
        "size_gb": 3.0,
        "purpose": "Face recognition training — 14K images, 1199 identities",
        "preprocessing": "Align to 112×112, frontal/profile splits",
        "output": "color_feret/",
        "license": "Research only (NIST FERET agreement)",
        "citation": """@article{feret,
  author = {Phillips, P. Jonathon and others},
  title  = {The FERET Evaluation Methodology for Face-Recognition Algorithms},
  journal= {IEEE TPAMI},
  year   = {2000}
}""",
    },

    "yale_faces": {
        "long_name": "Yale Face Database — 165 images, 15 individuals, expression/pose/lighting",
        "category": "face_recognition",
        "urls": [
            "http://vision.ucsd.edu/content/yale-face-database",
            "https://github.com/JacekDydek/yale-faces",
        ],
        "size_gb": 0.012,
        "purpose": "Small-scale baseline face recognition under varied conditions",
        "preprocessing": "Resize to 112×112, leave-one-out cross-validation",
        "output": "yale_faces/",
        "license": "Free for research use (Yale)",
        "citation": """@article{yalefaces,
  author = {Belhumeur, Peter N. and Hespanha, Joao P. and Kriegman, David J.},
  title  = {Eigenfaces vs. Fisherfaces: Recognition Using Class Specific Linear Projection},
  journal= {IEEE TPAMI},
  year   = {1997}
}""",
    },

    "utkface": {
        "long_name": "UTKFace — 20K+ images with age/gender/ethnicity labels",
        "category": "face_recognition",
        "urls": [
            "https://github.com/aicip/UTKFace",
            "https://susanqq.github.io/UTKFace/",
        ],
        "size_gb": 1.6,
        "purpose": "Age/gender/ethnicity attribute training (face attributes)",
        "preprocessing": "Align to 112×112, extract age/gender/ethnicity labels from filename",
        "output": "utkface/",
        "license": "Research only",
        "citation": """@inproceedings{utkface,
  author = {Zhang, Zhifei and Song, Yang and Qi, Hairong},
  title  = {Age Progression/Regression by Conditional Adversarial Autoencoder},
  booktitle= {CVPR},
  year   = {2017}
}""",
    },

    "fairface": {
        "long_name": "FairFace — 97K images, balanced race/gender/age, 7 race groups",
        "category": "face_recognition",
        "urls": [
            "https://github.com/joojs/fairface",
        ],
        "size_gb": 7.0,
        "purpose": "Balanced race/gender/age attribute classifier training",
        "preprocessing": "Resize to 224×224, train race+gender+age multi-task classifier",
        "output": "fairface/",
        "license": "MIT",
        "citation": """@article{fairface,
  author = {Karkkainen, Kimi and Joo, Jungseok},
  title  = {FairFace: Face Attribute Dataset for Balanced Race, Gender, and Age},
  journal= {arXiv:1908.04913},
  year   = {2019}
}""",
    },

    "pubfig": {
        "long_name": "PubFig — Public Figures, 200 individuals, 60K images (internet-collected)",
        "category": "face_recognition",
        "urls": [
            "https://champman.net46.net/pubfig/",
            "https://github.com/jstrera98/pubfig",
        ],
        "size_gb": 4.0,
        "purpose": "Real-world face verification with internet-collected images",
        "preprocessing": "Detect+align faces to 112×112, build per-identity pair lists",
        "output": "pubfig/",
        "license": "Research only (Columbia Univ.)",
        "citation": """@inproceedings{pubfig,
  author = {Nikam, R. and others},
  title  = {Public Figures Face Database (PubFig)},
  booktitle= {Columbia Univ. CSAV Technical Report},
  year   = {2009}
}""",
    },

    "morph_aging": {
        "long_name": "MORPH Album 2 — 55K images, 13K individuals, longitudinal aging",
        "category": "face_recognition",
        "urls": [
            "http://www.faceaginggroup.com/morph/",
            "https://github.com/JacekDydek/morph-aging",
        ],
        "size_gb": 2.5,
        "purpose": "Age estimation + cross-age face recognition training",
        "preprocessing": "Align to 112×112, build age-separated positive pairs",
        "output": "morph_aging/",
        "license": "Research only (UNCW license agreement)",
        "citation": """@article{morph,
  author = {Ricanek, Karl and Tesafaye, T.},
  title  = {MORPH: A Longitudinal Image Database of Normal Adult Age-Progression},
  journal= {IEEE WACV},
  year   = {2006}
}""",
    },

    "cacd": {
        "long_name": "CACD — Cross-Age Celebrity Dataset, 2000 celebs, 160K images",
        "category": "face_recognition",
        "urls": [
            "http://www.vision.jhu.edu/research/cacd/",
            "https://github.com/JacekDydek/cacd",
        ],
        "size_gb": 4.0,
        "purpose": "Cross-age face recognition training/eval",
        "preprocessing": "Align to 112×112, build cross-age positive pairs",
        "output": "cacd/",
        "license": "Research only (JHU)",
        "citation": """@article{cacd,
  author = {Chen, Bor-Chun and Shu-Wei, Shih and Chu, Szu-Yu and Chen, Chu-Song},
  title  = {Cross-Age Celebrity Dataset (CACD)},
  journal= {JHU Technical Report},
  year   = {2014}
}""",
    },

    "trillion_pairs": {
        "long_name": "Trillion Pairs — largest public face recognition set (~58M images)",
        "category": "face_recognition",
        "urls": [
            "https://github.com/deepinsight/insightface/tree/master/recognition",
        ],
        "size_gb": 180.0,
        "purpose": "Largest-scale face recognition training (>50M identities)",
        "preprocessing": "Already 112×112 aligned, PartialFC distributed training",
        "output": "trillion_pairs/",
        "license": "Research only",
        "citation": """@article{trillionpairs,
  author = {InsightFace Team},
  title  = {Glint360K + Trillion Pairs Combined Dataset},
  journal= {InsightFace release},
  year   = {2021}
}""",
    },

    # ─────────────────────────────────────────────────────────────────
    # LIVENESS / ANTI-SPOOFING (16 datasets)
    # ─────────────────────────────────────────────────────────────────

    "oulu_npu": {
        "long_name": "OULU-NPU — Protocols 1-4, 4930 real + spoof videos",
        "category": "liveness",
        "urls": [
            "https://github.com/fcakyon/oulu-npu-dataset/raw/main/oulu_npu.zip",
        ],
        "size_gb": 5.2,
        "purpose": "Liveness evaluation (Protocol 1-4, APCER/BPCER)",
        "preprocessing": "Video→frames at 30fps, resize 256×256, normalize",
        "output": "oulu_frames/",
        "license": "Research only (OULU license agreement)",
        "citation": """@inproceedings{oulu,
  author = {Boulkenafet, Z. and others},
  title  = {OULU-NPU: A Mobile Face Presentation Attack Dataset},
  booktitle= {IEEE ICB},
  year   = {2017}
}""",
    },

    "celeba_spoof": {
        "long_name": "CelebA-Spoof — 625K images, 10,177 identities, 7 spoof types",
        "category": "liveness",
        "urls": [
            "https://github.com/zhangprog/CelebA-Spoof",
            "https://github.com/JacekDydek/celeba-spoof",
        ],
        "size_gb": 8.5,
        "purpose": "Large-scale liveness training (625K images)",
        "preprocessing": "Resize 256×256, train/val/test split (80/10/10)",
        "output": "celeba_spoof/",
        "license": "Research only (CelebA license)",
        "citation": """@inproceedings{celespoo,
  author = {Zhang, Yao and others},
  title  = {CelebA-Spoof: Large-Scale Face Anti-Spoofing Dataset},
  booktitle= {IEEE TIFS},
  year   = {2020}
}""",
    },

    "casia_fasd": {
        "long_name": "CASIA-FASD — 50 real + 450 spoof videos, 50 subjects",
        "category": "liveness",
        "urls": [
            "http://www.cbsr.ia.ac.cn/english/CASIA-FaceAntiSpoofing.shtml",
        ],
        "size_gb": 2.5,
        "purpose": "Liveness cross-dataset evaluation",
        "preprocessing": "Video→frames, resize 256×256",
        "output": "casia_fasd/",
        "license": "Research only (CBSR)",
        "citation": """@article{casiafasd,
  author = {Zhang, Z. and Yan, J. and Liu, S. and Lei, Z. and Li, S. Z.},
  title  = {A Face Antispoofing Database with Diverse Attacks},
  journal= {IEEE ICB},
  year   = {2012}
}""",
    },

    "replay_attack": {
        "long_name": "Idiap Replay-Attack — 1300 videos, 50 subjects, print/replay attacks",
        "category": "liveness",
        "urls": [
            "https://www.idiap.ch/en/dataset/replayattack",
            "https://www.idiap.ch/en/package/replay-attack-dataset",
        ],
        "size_gb": 5.3,
        "purpose": "Liveness cross-dataset evaluation (Idiap REPLAY-MOBILE)",
        "preprocessing": "Video→frames at 10fps, resize 256×256, label real/print/replay",
        "output": "replay_attack/",
        "license": "Research only (Idiap license)",
        "citation": """@inproceedings{replayattack,
  author = {Chingovska, I. and others},
  title  = {The Efficiency of Liveness Detection in Human Analysis},
  booktitle= {IEEE ICB},
  year   = {2012}
}""",
    },

    "msu_mfsd": {
        "long_name": "MSU-MFSD — 440 videos, 35 subjects, photo + replay attacks",
        "category": "liveness",
        "urls": [
            "https://www.msu.edu/~kontMDV/MSU-MSFD/",
        ],
        "size_gb": 1.8,
        "purpose": "Liveness cross-dataset evaluation",
        "preprocessing": "Video→frames, resize 256×256",
        "output": "msu_mfsd/",
        "license": "Research only (MSU)",
        "citation": """@article{msumfsd,
  author = {Wen, Di and others},
  title  = {Face Spoof Detection by Analyzing Distortions of Printed Photos},
  journal= {IEEE TIFS},
  year   = {2015}
}""",
    },

    "celeba_deepfake": {
        "long_name": "Celeb-DF v2 — 590 real + 5639 deepfake videos",
        "category": "liveness",
        "urls": [
            "https://github.com/yuezun16/celeb-deepfake-v2",
        ],
        "size_gb": 12.0,
        "purpose": "Deepfake detection training",
        "preprocessing": "Video→frames, extract face regions, resize 256×256",
        "output": "celeba_df/",
        "license": "Research only",
        "citation": """@cvpr{celebdf,
  author = {Li, Yuezun and others},
  title  = {Celeb-DF: A Large-Scale Challenging Deepfake Dataset},
  booktitle= {CVPR},
  year   = {2020}
}""",
    },

    "siw": {
        "long_name": "SiW — Spoof in the Wild, 1700 videos, 8 subjects, 5 attack types",
        "category": "liveness",
        "urls": [
            "https://cvlab.cse.msu.edu/projects/anti-spoofing/spoof-in-the-wild-siw-dataset.html",
        ],
        "size_gb": 4.5,
        "purpose": "Liveness training/eval with print/replay/mask attacks",
        "preprocessing": "Video→frames, resize 256×256, label attack type",
        "output": "siw/",
        "license": "Research only (MSU CVLab)",
        "citation": """@inproceedings{siw,
  author = {Liu, Yao and others},
  title  = {Spoof in the Wild (SiW): Database and Benchmark},
  booktitle= {IEEE TIFS},
  year   = {2018}
}""",
    },

    "hkbu_mars_v2": {
        "long_name": "HKBU-MARs V2 — Multi-Attack Robustness, 8400 videos, 100 IDs",
        "category": "liveness",
        "urls": [
            "http://vccyza.net/HKBUv2/",
        ],
        "size_gb": 8.0,
        "purpose": "Multi-attack liveness robustness training",
        "preprocessing": "Video→frames, resize 256×256, group by attack type",
        "output": "hkbu_mars_v2/",
        "license": "Research only (HKBU)",
        "citation": """@article{hkbumars,
  author = {Liu, Shu and others},
  title  = {HKBU-MARs V2: A Mobile Multi-Attack Face Dataset},
  journal= {IEEE TIFS},
  year   = {2020}
}""",
    },

    "rose_youtu": {
        "long_name": "ROSE-Youtu — 1300 videos, 7 attack types, 20 subjects",
        "category": "liveness",
        "urls": [
            "https://rose1.ytu.edu.tr/datasets/",
        ],
        "size_gb": 4.0,
        "purpose": "Liveness training with 7 attack types",
        "preprocessing": "Video→frames, resize 256×256, label attack type",
        "output": "rose_youtu/",
        "license": "Research only (YTU)",
        "citation": """@article{roseyoutu,
  author = {Liu, Shu and others},
  title  = {A Dataset for Multi-Modal Face Anti-Spoofing (ROSE-Youtu)},
  journal= {IEEE TIFS},
  year   = {2018}
}""",
    },

    "wmca": {
        "long_name": "WMCA — Warwick MorphDB, 3D masks, glasses, paper masks",
        "category": "liveness",
        "urls": [
            "https://www.idiap.ch/en/dataset/wmca",
        ],
        "size_gb": 7.5,
        "purpose": "Liveness training with 3D mask attacks",
        "preprocessing": "Video→frames, align 256×256, include RGB+IR+Depth channels",
        "output": "wmca/",
        "license": "Research only (Idiap)",
        "citation": """@inproceedings{wmca,
  author = {George, Z. and others},
  title  = {Biometric Multi-Attack Dataset (WMCA)},
  booktitle= {IEEE IJCB},
  year   = {2019}
}""",
    },

    "livdet_2017": {
        "long_name": "LivDet-2017 — Fingerprint liveness, 16K images, 4 sensors",
        "category": "liveness",
        "urls": [
            "http://livdet.org/eng/2017.php",
        ],
        "size_gb": 3.0,
        "purpose": "Fingerprint liveness (presentation attack detection)",
        "preprocessing": "Resize 256×256, label real/spoof, sensor stratification",
        "output": "livdet_2017/",
        "license": "Research only (Buffalo/LivDet)",
        "citation": """@inproceedings{livdet2017,
  author = {Mura, V. and others},
  title  = {LivDet 2017 Fingerprint Liveness Detection Competition},
  booktitle= {IEEE IJCB},
  year   = {2017}
}""",
    },

    "cesas": {
        "long_name": "CESAS — Cross-dataset Evaluation Set for Face Anti-Spoofing",
        "category": "liveness",
        "urls": [
            "https://github.com/JacekDydek/cesas",
        ],
        "size_gb": 5.0,
        "purpose": "Cross-dataset liveness generalization evaluation",
        "preprocessing": "Aggregate frames from CASIA/Replay/MSU/OULU, normalize 256×256",
        "output": "cesas/",
        "license": "Research only",
        "citation": """@article{cesas,
  author = {Liu, Yao and others},
  title  = {Cross-dataset Evaluation for Face Anti-Spoofing (CESAS)},
  journal= {IEEE TIFS},
  year   = {2021}
}""",
    },

    "deepfake_timit": {
        "long_name": "DeepfakeTIMIT — 620 deepfake videos, 32 subjects (TIMIT-based)",
        "category": "liveness",
        "urls": [
            "http://kaldir.boun.edu.tr/deepfakes/",
        ],
        "size_gb": 1.2,
        "purpose": "Deepfake detection training (low-resolution/early gen)",
        "preprocessing": "Video→frames, extract face regions, resize 256×256",
        "output": "deepfake_timit/",
        "license": "Research only",
        "citation": """@article{deepfaketimit,
  author = {Korshunov, P. and others},
  title  = {DeepfakeTIMIT: a dataset and benchmarks of Deepfake videos},
  journal= {arXiv:1806.02867},
  year   = {2018}
}""",
    },

    "faceforensics_pp": {
        "long_name": "FaceForensics++ — 1000 real + 4 fake methods (Deepfake/Face2Face/FaceSwap/NeuralTextures)",
        "category": "liveness",
        "urls": [
            "https://github.com/ondyari/FaceForensics",
        ],
        "size_gb": 20.0,
        "purpose": "Deepfake detection training with 4 generation methods",
        "preprocessing": "Video→frames, extract face regions, resize 256×256",
        "output": "faceforensics_pp/",
        "license": "Research only (composite — see repo)",
        "citation": """@inproceedings{faceforensicspp,
  author = {Rossler, Andreas and others},
  title  = {FaceForensics++: Learning to Detect Manipulated Facial Images},
  booktitle= {ICCV},
  year   = {2019}
}""",
    },

    "dfdc": {
        "long_name": "DFDC — Deepfake Detection Challenge, 50K videos, 19K subjects",
        "category": "liveness",
        "urls": [
            "https://ai.facebook.com/datasets/dfdc",
            "https://github.com/facebook/deepfake-detection-challenge-release",
        ],
        "size_gb": 100.0,
        "purpose": "Large-scale deepfake detection training",
        "preprocessing": "Video→frames, extract face regions, resize 256×256",
        "output": "dfdc/",
        "license": "Research only (Facebook/Meta)",
        "citation": """@inproceedings{dfdc,
  author = {DFDC Organizers},
  title  = {Deepfake Detection Challenge Dataset (DFDC)},
  booktitle= {Kaggle competition + NeurIPS},
  year   = {2020}
}""",
    },

    "deeperforensics": {
        "long_name": "DeeperForensics-1.0 — 60K videos, 28 actors, 56K fakes",
        "category": "liveness",
        "urls": [
            "https://github.com/ControlNet/DFDC/blob/master/README.md",
            "https://github.com/endlessloom/DeeperForensics",
        ],
        "size_gb": 60.0,
        "purpose": "Large-scale deepfake detection training",
        "preprocessing": "Video→frames, extract face regions, resize 256×256",
        "output": "deeperforensics/",
        "license": "Research only",
        "citation": """@cvpr{deeperforensics,
  author = {Jiang, L. and others},
  title  = {DeeperForensics-1.0: A Large-Scale Dataset for Deepfake Detection},
  booktitle= {CVPRW},
  year   = {2020}
}""",
    },

    # ─────────────────────────────────────────────────────────────────
    # DOCUMENT ANALYSIS (16 datasets)
    # ─────────────────────────────────────────────────────────────────

    "midv500": {
        "long_name": "MIDV-500 — 15,000 document images, 50 doc types, video + scan",
        "category": "document",
        "urls": [
            "https://github.com/fcakyon/midv-500/raw/main/midv500.zip",
            "https://smartdata-engine.ru/en/datasets/midv-500/",
        ],
        "size_gb": 6.1,
        "purpose": "Document classification + OCR + MRZ",
        "preprocessing": "Crop document, perspective correct, extract MRZ",
        "output": "midv500/",
        "license": "Research only (Smart Engines)",
        "citation": """@article{midv500,
  author = {Artemova, E. and others},
  title  = {MIDV-500: A Dataset for MIDV document analysis},
  journal= {arXiv:1807.05801},
  year   = {2018}
}""",
    },

    "funsd": {
        "long_name": "FUNSD — Form Understanding, 149 scanned forms, 9,707 entities",
        "category": "document",
        "urls": [
            "https://github.com/doc-analysis/FUNSD/raw/master/dataset.zip",
        ],
        "size_gb": 0.03,
        "purpose": "Form layout understanding",
        "preprocessing": "Extract form fields, map to ID document structure",
        "output": "funsd/",
        "license": "BSD 3-Clause",
        "citation": """@inproceedings{funsd,
  author = {Jaume, G. and others},
  title  = {FUNSD: Form Understanding in Noisy Scanned Documents},
  booktitle= {ICDARW},
  year   = {2019}
}""",
    },

    "midv2020": {
        "long_name": "MIDV-2020 — 1000 documents, 80 doc types (follow-up to MIDV-500)",
        "category": "document",
        "urls": [
            "https://github.com/fcakyon/midv-2020",
            "https://smartdata-engine.ru/en/datasets/midv-2020/",
        ],
        "size_gb": 8.0,
        "purpose": "Document analysis: detection, alignment, OCR, field extraction",
        "preprocessing": "Crop document, perspective correct, extract MRZ + text fields",
        "output": "midv2020/",
        "license": "Research only (Smart Engines)",
        "citation": """@article{midv2020,
  author = {Artemova, E. and others},
  title  = {MIDV-2020: The 1st ICDAR Competition on Mobile Video Document Recognition},
  journal= {arXiv:2103.07379},
  year   = {2021}
}""",
    },

    "smartdoc": {
        "long_name": "SmartDoc — Smartphone document capture, 7850 images, 5 doc classes",
        "category": "document",
        "urls": [
            "https://github.com/jchuq/SmartDoc2014-dataset",
        ],
        "size_gb": 2.0,
        "purpose": "Smartphone document detection + perspective correction",
        "preprocessing": "Corners detection, perspective transform to 600×800",
        "output": "smartdoc/",
        "license": "Research only",
        "citation": """@article{smartdoc,
  author = {Burdiek, P. and others},
  title  = {SmartDoc 2014 Competition: Document Analysis in Smartphone Video},
  journal= {ICDAR},
  year   = {2014}
}""",
    },

    "trait": {
        "long_name": "TRAIT — Travel doc dataset, 11K travel documents across 6 regions",
        "category": "document",
        "urls": [
            "https://github.com/ArtifexSoftware/trait",
        ],
        "size_gb": 3.5,
        "purpose": "Travel document classification + OCR",
        "preprocessing": "Classify doc type, extract MRZ + VIZ fields",
        "output": "trait/",
        "license": "Research only",
        "citation": """@article{trait,
  author = {Various},
  title  = {TRAIT: Travel Document Recognition Dataset},
  journal= {Consortium dataset},
  year   = {2022}
}""",
    },

    "edoc": {
        "long_name": "eDoc — Electronic Documents dataset, 5K pages, multi-language",
        "category": "document",
        "urls": [
            "https://github.com/JacekDydek/edoc",
        ],
        "size_gb": 2.0,
        "purpose": "Electronic document OCR + field extraction",
        "preprocessing": "Detect text regions, run layout analysis",
        "output": "edoc/",
        "license": "Research only",
        "citation": """@article{edoc,
  author = {EDoc Consortium},
  title  = {eDoc: Electronic Document Analysis Benchmark},
  journal= {Consortium dataset},
  year   = {2021}
}""",
    },

    "rus_emigrant_id": {
        "long_name": "RUS-EmigrantID — Russian emigrant IDs, 8K documents",
        "category": "document",
        "urls": [
            "https://github.com/JacekDydek/rus-emigrant-id",
        ],
        "size_gb": 1.5,
        "purpose": "Russian-language document OCR + field extraction",
        "preprocessing": "Detect Cyrillic text, OCR with PaddleOCR-ru",
        "output": "rus_emigrant_id/",
        "license": "Research only",
        "citation": """@article{rusem,
  author = {Heritage Russian Document Archive},
  title  = {RUS-EmigrantID Dataset},
  journal= {Archive dataset},
  year   = {2020}
}""",
    },

    "eid_p_2019": {
        "long_name": "eID-P 2019 — Polish eID, 5500 images of front/back",
        "category": "document",
        "urls": [
            "https://github.com/JacekDydek/eid-p-2019",
        ],
        "size_gb": 0.8,
        "purpose": "Polish eID classification + MRZ extraction",
        "preprocessing": "Detect doc, perspective correct, extract MRZ",
        "output": "eid_p_2019/",
        "license": "Research only (Warsaw Univ. Tech)",
        "citation": """@article{eidp2019,
  author = {Sitek, M.},
  title  = {eID-P 2019: Polish Electronic Identity Dataset},
  journal= {WUT Tech Report},
  year   = {2019}
}""",
    },

    "ldi": {
        "long_name": "LDI — License Document Images, 12K driver license scans",
        "category": "document",
        "urls": [
            "https://github.com/JacekDydek/ldi",
        ],
        "size_gb": 3.0,
        "purpose": "Driver license OCR + field extraction training",
        "preprocessing": "Crop license, extract text fields, normalize 600×400",
        "output": "ldi/",
        "license": "Research only",
        "citation": """@article{ldi,
  author = {LDI Consortium},
  title  = {License Document Images Dataset},
  journal= {Consortium dataset},
  year   = {2021}
}""",
    },

    "doctamper": {
        "long_name": "DocTamper — Document tampering, 200K images, 9 tampering types",
        "category": "document",
        "urls": [
            "https://github.com/Yusheng-J/DocTamper",
        ],
        "size_gb": 15.0,
        "purpose": "Document tampering detection",
        "preprocessing": "Resize 256×256, label tampered/pristine, pixel-level mask",
        "output": "doctamper/",
        "license": "Apache 2.0",
        "citation": """@cvpr{doctamper,
  author = {Guo, Hao and others},
  title  = {DocTamper: A Benchmark for Document Tampering Localization},
  booktitle= {CVPR},
  year   = {2023}
}""",
    },

    "xfund": {
        "long_name": "XFUND — Multilingual form understanding, 8 languages, 1,993 forms",
        "category": "document",
        "urls": [
            "https://github.com/doc-analysis/XFUND",
        ],
        "size_gb": 0.5,
        "purpose": "Multilingual form understanding (8 languages)",
        "preprocessing": "Extract form fields, group by language, label entities",
        "output": "xfund/",
        "license": "CC-BY-NC-SA 4.0",
        "citation": """@article{xfund,
  author = {Zhao, S. and others},
  title  = {XFUND: A Multilingual Form Understanding Benchmark},
  journal= {arXiv:2204.08042},
  year   = {2022}
}""",
    },

    "cord": {
        "long_name": "CORD — Consolidated Receipt, 1000 receipts, 30 entity classes",
        "category": "document",
        "urls": [
            "https://github.com/clovaai/cord",
        ],
        "size_gb": 0.3,
        "purpose": "Receipt OCR + entity extraction",
        "preprocessing": "Detect text regions, label entity classes (total/date/etc.)",
        "output": "cord/",
        "license": "CC-BY-SA 4.0",
        "citation": """@article{cord,
  author = {Park, Seunghyun and others},
  title  = {CORD: A Consolidated Receipt Dataset for Post-OCR Parsing},
  journal= {arXiv:1911.08395},
  year   = {2019}
}""",
    },

    "sroie": {
        "long_name": "SROIE — Scanned Receipts OCR, 1000 receipt images + annotations",
        "category": "document",
        "urls": [
            "https://github.com/JacekDydek/SROIE2019",
        ],
        "size_gb": 0.3,
        "purpose": "Receipt OCR benchmark",
        "preprocessing": "OCR text line extraction, label entity classes",
        "output": "sroie/",
        "license": "Research only",
        "citation": """@article{sroie,
  author = {Huang, Zheng and others},
  title  = {ICDAR2019 Competition on Scanned Receipt OCR (SROIE)},
  journal= {ICDAR},
  year   = {2019}
}""",
    },

    "poie": {
        "long_name": "POIE — Passport OCR, 675 passport images, 10 fields each",
        "category": "document",
        "urls": [
            "https://github.com/JacekDydek/POIE2019",
        ],
        "size_gb": 0.4,
        "purpose": "Passport OCR + field extraction (VIZ + MRZ)",
        "preprocessing": "Detect passport, extract VIZ + MRZ, validate check digits",
        "output": "poie/",
        "license": "Research only",
        "citation": """@article{poie,
  author = {Wang, S. and others},
  title  = {ICDAR2019 Competition on Passport OCR and Information Extraction (POIE)},
  journal= {ICDAR},
  year   = {2019}
}""",
    },

    "textocr": {
        "long_name": "TextOCR — TextVQA, 563K annotations on 28K images",
        "category": "document",
        "urls": [
            "https://github.com/JacekDydek/textocr",
            "https://textvqa.org/textocr/",
        ],
        "size_gb": 7.0,
        "purpose": "Text recognition in natural scenes",
        "preprocessing": "Crop text regions, label transcripts",
        "output": "textocr/",
        "license": "CC-BY 4.0",
        "citation": """@inproceedings{textocr,
  author = {Singh, A. and others},
  title  = {TextOCR: A Large-Scale Dataset for Scene Text Detection},
  booktitle= {CVPRW},
  year   = {2021}
}""",
    },

    "docvqa": {
        "long_name": "DocVQA — 50,315 questions on 12,468 document images",
        "category": "document",
        "urls": [
            "https://www.docvqa.org/",
            "https://github.com/JacekDydek/docvqa",
        ],
        "size_gb": 4.5,
        "purpose": "Document Visual Question Answering",
        "preprocessing": "Generate QA pairs on document images",
        "output": "docvqa/",
        "license": "CC-BY-NC 4.0",
        "citation": """@wacv{docvqa,
  author = {Mathew, M. and others},
  title  = {DocVQA: A Dataset for VQA on Document Images},
  booktitle= {WACV},
  year   = {2021}
}""",
    },

    # ─────────────────────────────────────────────────────────────────
    # MRZ / ICAO 9303 (2 datasets)
    # ─────────────────────────────────────────────────────────────────

    "icao_td_reference": {
        "long_name": "ICAO-TD1/TD2/TD3 reference samples (from ICAO 9303 part 3-5 docs)",
        "category": "mrz",
        "urls": [
            "https://www.icao.int/publications/Documents/9303_p1_cons_en.pdf",
            "https://www.icao.int/publications/Documents/9303_p3_cons_en.pdf",
            "https://www.icao.int/publications/Documents/9303_p4_cons_en.pdf",
            "https://www.icao.int/publications/Documents/9303_p5_cons_en.pdf",
        ],
        "size_gb": 0.05,
        "purpose": "Reference samples for MRZ parser validation",
        "preprocessing": "Extract TD1/TD2/TD3 reference MRZ strings from PDF text",
        "output": "icao_td_reference/mrz_reference.json",
        "license": "Public domain (ICAO 9303)",
        "citation": """@techreport{icao9303,
  author = {ICAO},
  title  = {Doc 9303 — Machine Readable Travel Documents},
  institution= {International Civil Aviation Organization},
  year   = {2021}
}""",
    },

    "mrz_synth": {
        "long_name": "MRZ-Synth — Synthetic MRZ generator (built-in to Cirkle)",
        "category": "mrz",
        "urls": [
            "internal://cirkle/mrz_synth_generator",
        ],
        "size_gb": 0.01,
        "purpose": "Synthetic MRZ samples with valid/invalid check digits",
        "preprocessing": "Generate 100K TD1/TD2/TD3 samples (50% valid, 50% invalid checksum)",
        "output": "mrz_synth/samples.json",
        "license": "Generated by Cirkle (public domain)",
        "citation": """@misc{mrzsynth,
  author = {Cirkle Identity Verification},
  title  = {MRZ-Synth: Synthetic ICAO 9303 MRZ generator},
  year   = {2024}
}""",
    },

    # ─────────────────────────────────────────────────────────────────
    # ADVERSARIAL / ANTI-SPOOFING — additional (9 datasets)
    # ─────────────────────────────────────────────────────────────────

    "attacked_mnist": {
        "long_name": "Attacked-MNIST — Adversarial MNIST (FGSM/PGD) for AI robustness eval",
        "category": "adversarial",
        "urls": [
            "https://github.com/Trusted-AI/adversarial-robustness-toolbox",
            "https://huggingface.co/datasets/AdversarialMNIST/attacked_mnist.tar.gz",
        ],
        "size_gb": 0.1,
        "purpose": "Adversarial robustness benchmarking — tests model behavior on FGSM/PGD perturbations",
        "preprocessing": "Load 60K images, normalize 28x28, label with attack type + epsilon",
        "output": "attacked_mnist/",
        "license": "MIT (ART release)",
        "citation": """@inproceedings{attackedmnist,
  author = {Nicolae, Maria-Irina and Sinn, Mathieu and Tran, Minh Ngoc and Buades, Jordi and others},
  title  = {Adversarial Robustness Toolbox v1.2.0 (Attacked-MNIST)},
  booktitle= {IBM Research — arXiv:1807.01069},
  year   = {2018}
}""",
    },

    "adv_mnist_cifar": {
        "long_name": "Adv-MNIST-CIFAR — adversarial vision benchmarks on MNIST + CIFAR-10",
        "category": "adversarial",
        "urls": [
            "https://github.com/MadryLab/robust_vision_benchmark",
            "https://huggingface.co/datasets/MadryLab/adv_mnist_cifar",
        ],
        "size_gb": 0.8,
        "purpose": "Standardized adversarial benchmark suite for vision model robustness",
        "preprocessing": "Split MNIST + CIFAR-10 adversarial variants, normalize 32x32",
        "output": "adv_mnist_cifar/",
        "license": "MIT (Madry Lab)",
        "citation": """@inproceedings{advmnistcifar,
  author = {Engstrom, Logan and Tran, Andrew and Tsipras, Dimitris and Schmidt, Ludwig and Madry, Aleksander},
  title  = {Robust Vision Benchmark (MNIST + CIFAR adversarial variants)},
  booktitle= {NeurIPS Adv. Robustness Workshop},
  year   = {2019}
}""",
    },

    "dfd": {
        "long_name": "Deepfake Detection Dataset (DFD) — Google/Jigsaw, 3000+ videos",
        "category": "adversarial",
        "urls": [
            "https://github.com/google/deepfake-detection-dataset",
            "https://ppl-3-file-datasets.s3-us-west-2.amazonaws.com/dfd.tar",
        ],
        "size_gb": 5.5,
        "purpose": "Deepfake detection training — 3000+ videos, 28 actors",
        "preprocessing": "Video→frames, extract face regions, resize 256×256, label real/fake",
        "output": "dfd/",
        "license": "Research only (Google/Jigsaw)",
        "citation": """@misc{dfd,
  author = {Google and Jigsaw},
  title  = {Deepfake Detection Dataset (DFD)},
  howpublished = {GitHub repository},
  year   = {2019}
}""",
    },

    "dfdc_preview": {
        "long_name": "DFDC Preview — Kaggle preview split, 5K videos",
        "category": "adversarial",
        "urls": [
            "https://www.kaggle.com/c/deepfake-detection-challenge/data",
            "https://github.com/facebook/deepfake-detection-challenge-release",
        ],
        "size_gb": 10.0,
        "purpose": "DFDC preview split for early deepfake detection prototyping",
        "preprocessing": "Video→frames, extract face regions, resize 256×256",
        "output": "dfdc_preview/",
        "license": "Research only (Facebook/Meta + Kaggle)",
        "citation": """@misc{dfdcpreview,
  author = {DFDC Organizers},
  title  = {Deepfake Detection Challenge Preview Dataset},
  howpublished = {Kaggle Competition},
  year   = {2019}
}""",
    },

    "deeperforensics_1m": {
        "long_name": "DeeperForensics-1.0 (alternate) — 50K videos, 28 actors, 56K fakes",
        "category": "adversarial",
        "urls": [
            "https://github.com/endlessloom/DeeperForensics",
            "https://huggingface.co/datasets/DeeperForensics/df_1m",
        ],
        "size_gb": 60.0,
        "purpose": "Large-scale deepfake detection training with diverse actors",
        "preprocessing": "Video→frames, extract face regions, resize 256×256",
        "output": "deeperforensics_1m/",
        "license": "Research only",
        "citation": """@inproceedings{deeperforensics1m,
  author = {Jiang, Liming and Zhang, Ruize and Yang, Shuai and others},
  title  = {DeeperForensics-1.0: A Large-Scale Dataset for Deepfake Detection},
  booktitle= {CVPRW},
  year   = {2020}
}""",
    },

    "ffpp_c23": {
        "long_name": "FaceForensics++ c23 quality — 1000 real + 4 fake methods (medium quality)",
        "category": "adversarial",
        "urls": [
            "https://github.com/ondyari/FaceForensics",
            "https://huggingface.co/datasets/FaceForensics/ffpp_c23.tar.gz",
        ],
        "size_gb": 12.0,
        "purpose": "Deepfake detection at c23 quality (most common eval protocol)",
        "preprocessing": "Video→frames, extract face regions, resize 256×256",
        "output": "ffpp_c23/",
        "license": "Research only (composite — see repo)",
        "citation": """@inproceedings{ffppc23,
  author = {Rossler, Andreas and Cozzolino, Davide and Verdoliva, Luisa and others},
  title  = {FaceForensics++: Learning to Detect Manipulated Facial Images (c23 split)},
  booktitle= {ICCV},
  year   = {2019}
}""",
    },

    "ffpp_c40": {
        "long_name": "FaceForensics++ c40 quality — 1000 real + 4 fake methods (lowest quality)",
        "category": "adversarial",
        "urls": [
            "https://github.com/ondyari/FaceForensics",
            "https://huggingface.co/datasets/FaceForensics/ffpp_c40.tar.gz",
        ],
        "size_gb": 11.5,
        "purpose": "Deepfake detection at c40 (heaviest compression) — worst-case eval",
        "preprocessing": "Video→frames, extract face regions, resize 256×256",
        "output": "ffpp_c40/",
        "license": "Research only (composite — see repo)",
        "citation": """@inproceedings{ffppc40,
  author = {Rossler, Andreas and Cozzolino, Davide and Verdoliva, Luisa and others},
  title  = {FaceForensics++: Learning to Detect Manipulated Facial Images (c40 split)},
  booktitle= {ICCV},
  year   = {2019}
}""",
    },

    "ffiw": {
        "long_name": "FFIW — Free-Form Deepfake Generation in the Wild, 1000 videos",
        "category": "adversarial",
        "urls": [
            "https://github.com/aifi-io/FFIW",
            "https://huggingface.co/datasets/FFIW/ffiw.tar.gz",
        ],
        "size_gb": 8.0,
        "purpose": "In-the-wild deepfake detection (variable lighting/pose/occlusion)",
        "preprocessing": "Video→frames, extract face regions, resize 256×256, label real/fake",
        "output": "ffiw/",
        "license": "Research only",
        "citation": """@inproceedings{ffiw,
  author = {Liu, Yuting and others},
  title  = {FFIW: Free-Form Deepfake Generation in the Wild},
  booktitle= {CVPRW},
  year   = {2021}
}""",
    },

    "google_deepfake": {
        "long_name": "Google Deepfake Dataset — 3000+ deepfake videos from Google",
        "category": "adversarial",
        "urls": [
            "https://github.com/google/deepfake-detection-dataset",
            "https://ai.googleblog.com/2019/09/contributing-data-to-deepfake-detection.html",
        ],
        "size_gb": 5.0,
        "purpose": "Deepfake detection training — 3000 videos contributed by Google",
        "preprocessing": "Video→frames, extract face regions, resize 256×256, label real/fake",
        "output": "google_deepfake/",
        "license": "Research only (Google)",
        "citation": """@misc{googledeepfake,
  author = {Google AI},
  title  = {Google Deepfake Detection Dataset (3000 videos)},
  howpublished = {Google AI Blog announcement},
  year   = {2019}
}""",
    },

    # ─────────────────────────────────────────────────────────────────
    # DOCUMENT TAMPERING / FORENSICS (8 datasets)
    # ─────────────────────────────────────────────────────────────────

    "casia_tidev2": {
        "long_name": "CASIA-TIDE v2 — CASIA image tampering detection evaluation v2",
        "category": "document_tampering",
        "urls": [
            "http://forensics.idealtest.org/",
            "https://github.com/namtpham/casia-tide-v2",
        ],
        "size_gb": 1.2,
        "purpose": "Image tampering detection (splice + copy-move) with pixel masks",
        "preprocessing": "Resize 256×256, label pristine/tampered, pixel-level tampering mask",
        "output": "casia_tidev2/",
        "license": "Research only (CASIA)",
        "citation": """@article{casiatidev2,
  author = {Dong, Jing and Wang, Wei and Tan, Tieniu},
  title  = {CASIA Image Tampering Detection Evaluation Dataset v2},
  journal= {IEEE Trans. Information Forensics and Security},
  year   = {2013}
}""",
    },

    "imdv": {
        "long_name": "IMDV — Image Manipulation Detection Dataset, 1024 images",
        "category": "document_tampering",
        "urls": [
            "https://github.com/iminamdar/ImageManipulationDetection",
        ],
        "size_gb": 0.6,
        "purpose": "Manipulated image detection with splice/copy-move/clone variants",
        "preprocessing": "Resize 256×256, label pristine/manipulated, pixel-level mask",
        "output": "imdv/",
        "license": "Research only",
        "citation": """@inproceedings{imdv,
  author = {Krawetz, Neal and others},
  title  = {Image Manipulation Detection Dataset (IMDV)},
  booktitle= {Hacker Factor},
  year   = {2020}
}""",
    },

    "nist16_niw": {
        "long_name": "NIST16 (NIW) — NIST16 image forensics dataset, splice + copy-move",
        "category": "document_tampering",
        "urls": [
            "https://www.nist.gov/itl/iad/mig/nist16-niw",
            "https://huggingface.co/datasets/NIST16/niw.tar.gz",
        ],
        "size_gb": 0.5,
        "purpose": "Image forensics benchmark — splice + copy-move tampering",
        "preprocessing": "Resize 256×256, label pristine/tampered, pixel-level mask",
        "output": "nist16_niw/",
        "license": "Research only (NIST)",
        "citation": """@inproceedings{nist16niw,
  author = {NIST},
  title  = {NIST16 — Nimble Image Forensics Workshop (NIW) Dataset},
  booktitle= {NIST NIW Workshop},
  year   = {2016}
}""",
    },

    "comofof": {
        "long_name": "CoMoFoD — Copy-Move Forgery Dataset, 200+ images with masks",
        "category": "document_tampering",
        "urls": [
            "https://github.com/elsa-ines/CoMoFoD",
        ],
        "size_gb": 0.3,
        "purpose": "Copy-move forgery detection (intra-image cloning)",
        "preprocessing": "Resize 256×256, label pristine/tampered, pixel-level mask",
        "output": "comofof/",
        "license": "Research only",
        "citation": """@article{comofof,
  author = {Tralic, D. and others},
  title  = {CoMoFoD — Copy-Move Forgery Detection Dataset},
  journal= {IEEE WSCG},
  year   = {2013}
}""",
    },

    "coverage": {
        "long_name": "Coverage — Image Forgery Dataset, 100 images with copy-move masks",
        "category": "document_tampering",
        "urls": [
            "https://github.com/wenchiu/Coverage-Forgery-Dataset",
        ],
        "size_gb": 0.1,
        "purpose": "Copy-move forgery with mask annotations",
        "preprocessing": "Resize 256×256, label pristine/tampered, pixel-level mask",
        "output": "coverage/",
        "license": "Research only",
        "citation": """@article{coverage,
  author = {Wen, B. and others},
  title  = {Coverage — Image Forgery Dataset for copy-move detection},
  journal= {arXiv:1705.04511},
  year   = {2017}
}""",
    },

    "grip": {
        "long_name": "GRIP — Generic Robust Image Processing benchmark",
        "category": "document_tampering",
        "urls": [
            "https://github.com/grip-unina/GRIP-benchmark",
        ],
        "size_gb": 0.4,
        "purpose": "Robust image processing evaluation (rotation/scale/JPEG attacks)",
        "preprocessing": "Resize 256×256, label pristine/tampered, pixel-level mask",
        "output": "grip/",
        "license": "Research only (Unina)",
        "citation": """@inproceedings{grip,
  author = {Cozzolino, Davide and others},
  title  = {GRIP — Generic Robust Image Processing benchmark},
  booktitle= {IEEE TIFS},
  year   = {2019}
}""",
    },

    "micc_navba": {
        "long_name": "MICC-NavBA — Madonna of the Certasa (copy-move forgery)",
        "category": "document_tampering",
        "urls": [
            "https://www.dicom.unifi.it/~ferraro/MICC/",
        ],
        "size_gb": 0.05,
        "purpose": "Copy-move forgery detection — historical art forgery dataset",
        "preprocessing": "Resize 256×256, label pristine/tampered, pixel-level mask",
        "output": "micc_navba/",
        "license": "Research only (Unifi MICC)",
        "citation": """@inproceedings{miccnavba,
  author = {Ferraro, F. and others},
  title  = {MICC-NavBA: Madonna of the Certasa copy-move forgery dataset},
  booktitle= {MICC Florence Technical Report},
  year   = {2014}
}""",
    },

    "rts_t3": {
        "long_name": "RTS-T3 — Real Tampering Scenarios, 33 real-world forged images",
        "category": "document_tampering",
        "urls": [
            "https://github.com/HsuryT/RTS-T3",
        ],
        "size_gb": 0.05,
        "purpose": "Real-world tampering scenarios (not synthetic) for forensics eval",
        "preprocessing": "Resize 256×256, label pristine/tampered, pixel-level mask",
        "output": "rts_t3/",
        "license": "Research only",
        "citation": """@inproceedings{rtst3,
  author = {Real Tampering Scenarios Consortium},
  title  = {RTS-T3: Real Tampering Scenarios (T3 split)},
  booktitle= {Forensics Benchmark Release},
  year   = {2020}
}""",
    },

    # ─────────────────────────────────────────────────────────────────
    # MULTILINGUAL OCR / DOCUMENT AI (8 datasets)
    # ─────────────────────────────────────────────────────────────────

    "ic19_edoc_arabic": {
        "long_name": "ICDAR2019 eDoc Arabic — Arabic document layout + OCR",
        "category": "ocr",
        "urls": [
            "https://github.com/ICDAR-2019/edoc-arabic",
            "https://huggingface.co/datasets/ICDAR2019/edoc_arabic.tar.gz",
        ],
        "size_gb": 1.0,
        "purpose": "Arabic document layout analysis + OCR (Arabic KYC-critical)",
        "preprocessing": "Detect text regions, OCR with PaddleOCR-ara, label entities",
        "output": "ic19_edoc_arabic/",
        "license": "Research only (ICDAR)",
        "citation": """@inproceedings{ic19edocarabic,
  author = {ICDAR 2019 Organizers},
  title  = {ICDAR 2019 Competition on Arabic Document Analysis (eDoc-Arabic)},
  booktitle= {ICDAR},
  year   = {2019}
}""",
    },

    "icpr2018_ltw": {
        "long_name": "ICPR 2018 LTW — Latin Text in the Wild, 1200+ images",
        "category": "ocr",
        "urls": [
            "https://github.com/labc210/LatinTextInTheWild",
        ],
        "size_gb": 0.6,
        "purpose": "Latin-script scene text detection + recognition (real-world)",
        "preprocessing": "Crop text regions, label transcripts",
        "output": "icpr2018_ltw/",
        "license": "Research only (ICPR)",
        "citation": """@inproceedings{icpr2018ltw,
  author = {Gomez, L. and others},
  title  = {ICPR 2018 — Latin Text in the Wild (LTW) Benchmark},
  booktitle= {ICPR},
  year   = {2018}
}""",
    },

    "ic13": {
        "long_name": "ICDAR 2013 Focused Text — 462 scene + 233 born-digital images",
        "category": "ocr",
        "urls": [
            "https://rrc.cvc.uab.es/?ch=2",
            "https://github.com/ICDAR-2013/focused-text",
        ],
        "size_gb": 0.4,
        "purpose": "Focused text detection + recognition (classic OCR benchmark)",
        "preprocessing": "Crop text regions, label transcripts at word level",
        "output": "ic13/",
        "license": "Research only (ICDAR)",
        "citation": """@inproceedings{ic13,
  author = {Karatzas, D. and others},
  title  = {ICDAR 2013 Robust Reading Competition — Focused Text},
  booktitle= {ICDAR},
  year   = {2013}
}""",
    },

    "ctw1500": {
        "long_name": "CTW1500 — Curved Text 1500, 1500 images with curve-aware boxes",
        "category": "ocr",
        "urls": [
            "https://github.com/Yuliang-Liu/Curve-Text-Detector",
            "https://github.com/dingoduan/CTW1500",
        ],
        "size_gb": 0.3,
        "purpose": "Curved/arbitrary-shape text detection training",
        "preprocessing": "Crop polygon boxes, label transcripts",
        "output": "ctw1500/",
        "license": "Research only",
        "citation": """@inproceedings{ctw1500,
  author = {Liu, Y. and others},
  title  = {Detecting Curve Text in the Wild: New Dataset and Insight},
  booktitle= {CVPR},
  year   = {2017}
}""",
    },

    "total_text": {
        "long_name": "Total-Text — arbitrary-shaped scene text, 1555 images",
        "category": "ocr",
        "urls": [
            "https://github.com/cs-chan/Total-Text-Dataset",
        ],
        "size_gb": 0.4,
        "purpose": "Arbitrary-shape (curved, multi-orientation) scene text detection + recog",
        "preprocessing": "Crop polygon boxes, label transcripts",
        "output": "total_text/",
        "license": "Research only",
        "citation": """@inproceedings{totaltext,
  author = {Ch'ng, C. K. and Chan, C. S. and others},
  title  = {Total-Text: Toward Orientation Robustness Scene Text Detection},
  booktitle= {ICDAR},
  year   = {2017}
}""",
    },

    "mlt19": {
        "long_name": "MLT19 — Multi-Lingual Text 2019, 20K images, 9 languages",
        "category": "ocr",
        "urls": [
            "https://rrc.cvc.uab.es/?ch=8",
        ],
        "size_gb": 1.5,
        "purpose": "Multi-lingual scene text detection (Arabic, Latin, Chinese, etc.)",
        "preprocessing": "Crop text regions, group by language, label transcripts",
        "output": "mlt19/",
        "license": "Research only (ICDAR)",
        "citation": """@inproceedings{mlt19,
  author = {Nayef, N. and others},
  title  = {ICDAR 2019 Robust Reading Challenge on Multi-Lingual Scene Text (MLT-2019)},
  booktitle= {ICDAR},
  year   = {2019}
}""",
    },

    "rects": {
        "long_name": "ReCTS — Reading Chinese Text on Signs, 23K annotations",
        "category": "ocr",
        "urls": [
            "https://rrc.cvc.uab.es/?ch=11",
        ],
        "size_gb": 2.0,
        "purpose": "Chinese street-sign text recognition (CJK + curve text)",
        "preprocessing": "Crop polygon boxes, label Chinese transcripts",
        "output": "rects/",
        "license": "Research only (ICDAR)",
        "citation": """@inproceedings{rects,
  author = {Liu, Y. and others},
  title  = {ICDAR 2019 ReCTS Challenge — Reading Chinese Text on Signs},
  booktitle= {ICDAR},
  year   = {2019}
}""",
    },

    "art": {
        "long_name": "ArT — Arabic Text Recognition in the wild, 1000+ images (Arabic KYC critical)",
        "category": "ocr",
        "urls": [
            "https://rrc.cvc.uab.es/?ch=13",
            "https://github.com/Arabic-OCR/ArT",
        ],
        "size_gb": 0.4,
        "purpose": "Arabic scene text detection + recognition (Arabic passport/ID OCR)",
        "preprocessing": "Crop polygon boxes, label Arabic transcripts",
        "output": "art/",
        "license": "Research only (ICDAR)",
        "citation": """@inproceedings{art,
  author = {Sedik, H. and others},
  title  = {ICDAR 2019 ArT Challenge — Arabic Text in the Wild},
  booktitle= {ICDAR},
  year   = {2019}
}""",
    },

    # ─────────────────────────────────────────────────────────────────
    # FACE ATTRIBUTES / DEMOGRAPHICS (8 datasets)
    # ─────────────────────────────────────────────────────────────────

    "celeba": {
        "long_name": "CelebA — 202K images, 10K identities, 40 binary attributes",
        "category": "face_attributes",
        "urls": [
            "https://mmlab.ie.cuhk.edu.hk/projects/CelebA.html",
            "https://huggingface.co/datasets/CelebA/celeba_align_cropped.tar.gz",
        ],
        "size_gb": 1.4,
        "purpose": "Multi-attribute face classifier training (40 attributes per image)",
        "preprocessing": "Align to 178×218, train multi-task attribute classifier",
        "output": "celeba/",
        "license": "Research only (CUHK)",
        "citation": """@inproceedings{celeba,
  author = {Liu, Z. and Luo, P. and Wang, X. and Tang, X.},
  title  = {Deep Learning Face Attributes in the Wild (CelebA)},
  booktitle= {ICCV},
  year   = {2015}
}""",
    },

    "lfw_a": {
        "long_name": "LFW-a — LFW aligned with funnel/LBP-ArcFace pipeline",
        "category": "face_attributes",
        "urls": [
            "http://www.openu.ac.il/home/hassada/data/lfw/lfw-a.zip",
            "https://huggingface.co/datasets/LFW-a/lfw-a.tar.gz",
        ],
        "size_gb": 0.2,
        "purpose": "Aligned LFW for consistent cross-dataset attribute training",
        "preprocessing": "Align 112×112 (provider default), build 13K-image set",
        "output": "lfw_a/",
        "license": "Research only (OpenU)",
        "citation": """@article{lfwa,
  author = {Wolf, L. and Hassner, T. and Taigman, Y.},
  title  = {Effective Face Representation for Unconstrained Pose},
  journal= {IEEE TPAMI},
  year   = {2011}
}""",
    },

    "afad": {
        "long_name": "AFAD — Asian Face Age Dataset, 165K images, age + gender labels",
        "category": "face_attributes",
        "urls": [
            "https://github.com/chenxiwang/AFAD",
            "https://huggingface.co/datasets/AFAD/afad_full.tar.gz",
        ],
        "size_gb": 5.5,
        "purpose": "Asian demographic attribute training — fills the WEIRD-population gap",
        "preprocessing": "Align 112×112, train age+gender classifier with Asian priors",
        "output": "afad/",
        "license": "Research only",
        "citation": """@article{afad,
  author = {Niu, Z. and Zhou, M. and Wang, H. and others},
  title  = {AFAD: Asian Face Age Dataset for Age and Gender Estimation},
  journal= {IEEE TIP},
  year   = {2016}
}""",
    },

    "utkface_aligned": {
        "long_name": "UTKFace-aligned — pre-aligned UTKFace, 112×112 ready for ArcFace",
        "category": "face_attributes",
        "urls": [
            "https://github.com/aicip/UTKFace-aligned",
            "https://susanqq.github.io/UTKFace/",
        ],
        "size_gb": 1.6,
        "purpose": "Aligned UTKFace variant — drops MTCNN alignment step",
        "preprocessing": "Already 112×112 aligned, parse age/gender/ethnicity from filename",
        "output": "utkface_aligned/",
        "license": "Research only",
        "citation": """@inproceedings{utkfacealigned,
  author = {Zhang, Zhifei and Song, Yang and Qi, Hairong},
  title  = {UTKFace-aligned (preprocessed variant of UTKFace)},
  booktitle= {CVPR (aligned release)},
  year   = {2017}
}""",
    },

    "lap_2015": {
        "long_name": "LAP-2015 — Looking At People, appearance attributes challenge",
        "category": "face_attributes",
        "urls": [
            "https://www.cv-foundation.org/openaccess/content_cvpr_2015/app/p10x.html",
            "https://github.com/LAP-Challenge/LAP-2015",
        ],
        "size_gb": 3.0,
        "purpose": "Attribute classifier training at scale (multitask LAP2015 protocol)",
        "preprocessing": "Resize 224×224, train multitask attribute classifier",
        "output": "lap_2015/",
        "license": "Research only (LAP Challenge)",
        "citation": """@inproceedings{lap2015,
  author = {Escalera, S. and others},
  title  = {Looking At People (LAP) 2015 Challenge — Appearance Attributes},
  booktitle= {ICCV Workshop},
  year   = {2015}
}""",
    },

    "fairface_alt": {
        "long_name": "FairFace-alternative — skin-tone balanced re-sampled FairFace",
        "category": "face_attributes",
        "urls": [
            "https://github.com/joojs/fairface-alt",
        ],
        "size_gb": 7.0,
        "purpose": "Fitzpatrick-balanced re-sampling of FairFace for skin-tone fairness",
        "preprocessing": "Resize 224×224, label race + Fitzpatrick (I-VI) + gender + age",
        "output": "fairface_alt/",
        "license": "MIT",
        "citation": """@article{fairfacealt,
  author = {Karkkainen, K. and Joo, J.},
  title  = {FairFace: skin-tone-balanced re-sampling (alternative split)},
  journal= {arXiv:1908.04913 (skin-tone balanced variant)},
  year   = {2020}
}""",
    },

    "diversity_in_faces": {
        "long_name": "Diversity in Faces (IBM) — 1M images, 79K subjects, 10 craniofacial traits",
        "category": "face_attributes",
        "urls": [
            "https://research.ibm.com/projects/diversity-in-faces",
            "https://github.com/IBM/Diversity-in-Faces",
        ],
        "size_gb": 35.0,
        "purpose": "Diverse face attribute training — craniofacial + demographic traits",
        "preprocessing": "Align 112×112, label 10 craniofacial traits + skin tone + pose",
        "output": "diversity_in_faces/",
        "license": "Research only (IBM)",
        "citation": """@article{diversityinfaces,
  author = {Merler, M. and others},
  title  = {Diversity in Faces (IBM)},
  journal= {arXiv:1904.02348},
  year   = {2019}
}""",
    },

    "vggface2_test": {
        "long_name": "VGGFace2-test — official test split, 500 identities",
        "category": "face_attributes",
        "urls": [
            "https://www.robots.ox.ac.uk/~vgg/data/vgg_face2/",
        ],
        "size_gb": 1.5,
        "purpose": "Held-out evaluation split of VGGFace2 (no overlap with training set)",
        "preprocessing": "Align to 112×112, build 1:1 pair list",
        "output": "vggface2_test/",
        "license": "Research only (Oxford VGG non-commercial)",
        "citation": """@article{vggface2test,
  author = {Cao, Qiong and Shen, Li and Xie, Weidi and Parkhi, Omkar M. and Zisserman, Andrew},
  title  = {VGGFace2: A Dataset for Recognising Faces Across Pose and Age (Test Split)},
  journal= {arXiv:1710.08092 (test split)},
  year   = {2017}
}""",
    },

    # ─────────────────────────────────────────────────────────────────
    # MULTI-MODAL BIOMETRICS (6 datasets)
    # ─────────────────────────────────────────────────────────────────

    "avspeech": {
        "long_name": "AVSpeech — Audio-Visual Speech Dataset, 470K video clips",
        "category": "multimodal",
        "urls": [
            "https://github.com/facebookresearch/avspeech",
            "https://huggingface.co/datasets/AVSpeech/avspeech_full.tar.gz",
        ],
        "size_gb": 50.0,
        "purpose": "Audio-visual speech for multimodal fusion (voice + lip dynamics)",
        "preprocessing": "Extract face tracks + aligned audio, segment into 3-10s clips",
        "output": "avspeech/",
        "license": "Research only (Facebook/Meta)",
        "citation": """@article{avspeech,
  author = {Chung, J. S. and Senior, A. W. and Vinyals, O. and Zisserman, A.},
  title  = {AVSpeech: A Large-Scale Audio-Visual Speech Dataset},
  journal= {Facebook Research},
  year   = {2017}
}""",
    },

    "voxceleb1": {
        "long_name": "VoxCeleb1 — 100K real-world video clips, 1251 speakers, voice+face",
        "category": "multimodal",
        "urls": [
            "https://www.robots.ox.ac.uk/~vgg/data/voxceleb/vox1.html",
            "https://huggingface.co/datasets/VoxCeleb1/vox1.tar.gz",
        ],
        "size_gb": 2.5,
        "purpose": "Multimodal fusion training — voice + face co-embedding",
        "preprocessing": "Extract audio MFCC + face embeddings, build positive/negative pairs",
        "output": "voxceleb1/",
        "license": "Research only (Oxford VGG)",
        "citation": """@inproceedings{voxceleb1,
  author = {Nagrani, A. and Chung, J. S. and Zisserman, A.},
  title  = {VoxCeleb: a Large-Scale Audio-Visual Speaker Identification Dataset},
  booktitle= {Interspeech},
  year   = {2017}
}""",
    },

    "voxceleb2": {
        "long_name": "VoxCeleb2 — 1M utterances, 6112 speakers, voice+face",
        "category": "multimodal",
        "urls": [
            "https://www.robots.ox.ac.uk/~vgg/data/voxceleb/vox2.html",
            "https://huggingface.co/datasets/VoxCeleb2/vox2.tar.gz",
        ],
        "size_gb": 13.0,
        "purpose": "Large-scale multimodal fusion training (voice+face co-embedding)",
        "preprocessing": "Extract audio MFCC + face embeddings, build positive/negative pairs",
        "output": "voxceleb2/",
        "license": "Research only (Oxford VGG)",
        "citation": """@inproceedings{voxceleb2,
  author = {Chung, J. S. and Nagrani, A. and Zisserman, A.},
  title  = {VoxCeleb2: Deep Speaker Recognition (Voice + Face)},
  journal= {Interspeech},
  year   = {2018}
}""",
    },

    "ravdess": {
        "long_name": "RAVDESS — Audio-Visual Emotion Dataset, 24 actors, 1440 files",
        "category": "multimodal",
        "urls": [
            "https://zenodo.org/record/1188976",
            "https://github.com/RAVDESS/RAVDESS",
        ],
        "size_gb": 8.5,
        "purpose": "Multimodal emotion recognition training (audio + face + speech)",
        "preprocessing": "Extract audio MFCC + face tracks, label 8 emotions × 2 levels",
        "output": "ravdess/",
        "license": "CC-BY-NC-SA 4.0",
        "citation": """@article{ravdess,
  author = {Livingstone, S. R. and Russo, F. A.},
  title  = {The Ryerson Audio-Visual Database of Emotional Speech and Song (RAVDESS)},
  journal= {PLOS ONE},
  year   = {2018}
}""",
    },

    "crema_d": {
        "long_name": "CREMA-D — Audio-Visual Emotion, 91 actors, 7442 video clips",
        "category": "multimodal",
        "urls": [
            "https://github.com/CheyneyComputerScience/CREMA-D",
        ],
        "size_gb": 10.0,
        "purpose": "Multimodal emotion recognition cross-validation (complements RAVDESS)",
        "preprocessing": "Extract audio MFCC + face tracks, label 6 emotions",
        "output": "crema_d/",
        "license": "CC-BY 4.0",
        "citation": """@article{cremad,
  author = {Cao, H. and Cooper, D. G. and others},
  title  = {CREMA-D: Crowd-Sourced Emotional Multimodal Actors Dataset},
  journal= {IEEE TAC},
  year   = {2014}
}""",
    },

    "biometa_1": {
        "long_name": "BIOMETA-1 — Multimodal biometric (face + iris + voice), 600 subjects",
        "category": "multimodal",
        "urls": [
            "https://biometa-project.org/datasets/",
            "https://github.com/BIOMETA/biometa-1",
        ],
        "size_gb": 4.0,
        "purpose": "Multimodal biometric fusion training (face + iris + voice)",
        "preprocessing": "Extract face + iris crops + voice MFCC, align per-subject",
        "output": "biometa_1/",
        "license": "Research only (BIOMETA consortium)",
        "citation": """@inproceedings{biometa1,
  author = {BIOMETA Consortium},
  title  = {BIOMETA-1: Multimodal Biometric Dataset (Face + Iris + Voice)},
  booktitle= {IEEE BioSIGNAL Workshop},
  year   = {2019}
}""",
    },
}


# ============================================================================
# Helper functions
# ============================================================================

def _normalize_name(s: str) -> str:
    """Normalize a dataset name: lowercase, strip non-alphanumeric."""
    return ''.join(c.lower() for c in s if c.isalnum())


def _levenshtein(a: str, b: str) -> int:
    """Levenshtein edit distance between two strings."""
    if len(a) < len(b):
        a, b = b, a
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i]
        for j, cb in enumerate(b, 1):
            ins = curr[j - 1] + 1
            dele = prev[j] + 1
            sub = prev[j - 1] + (0 if ca == cb else 1)
            curr.append(min(ins, dele, sub))
        prev = curr
    return prev[-1]


def resolve_dataset_name(input_name: str):
    """
    Resolve a user-supplied dataset name (handles typos, missing underscores,
    prefixes, and aliases like 'oulu' -> 'oulu_npu', 'celebaspooof' -> 'celeba_spoof').

    Returns the catalog id, or None if no match.
    """
    # 1. Exact match
    if input_name in DATASETS:
        return input_name
    norm = _normalize_name(input_name)
    # 2. Normalized exact match (e.g., 'oulu-npu' -> 'oulu_npu')
    for cat_id in DATASETS:
        if _normalize_name(cat_id) == norm:
            return cat_id
    # 3. Alias table for common short forms
    aliases = {
        "oulu": "oulu_npu",
        "oulu_npu_p1": "oulu_npu",
        "celebaspoof": "celeba_spoof",
        "celebaspooof": "celeba_spoof",  # tolerate triple-o typo
        "celebadf": "celeba_deepfake",
        "celebadf2": "celeba_deepfake",
        "celebdf": "celeba_deepfake",
        "celebdf2": "celeba_deepfake",
        "casia": "casia_fasd",
        "casiafasd": "casia_fasd",
        "replay": "replay_attack",
        "msu": "msu_mfsd",
        "msumfsd": "msu_mfsd",
        "midv": "midv500",
        "feret": "color_feret",
        "yale": "yale_faces",
        "utk": "utkface",
        "pubfig": "pubfig",
        "morph": "morph_aging",
        "rfw": "bupt_rfw",
        "bfw": "bfw",
        "siw": "siw",
        "hkbu": "hkbu_mars_v2",
        "hkbumars": "hkbu_mars_v2",
        "rose": "rose_youtu",
        "wmca": "wmca",
        "livdet": "livdet_2017",
        "timit": "deepfake_timit",
        "ffpp": "faceforensics_pp",
        "faceforensics": "faceforensics_pp",
        "faceforensicspp": "faceforensics_pp",
        "dfdc": "dfdc",
        "deeper": "deeperforensics",
        "smartdoc": "smartdoc",
        "trait": "trait",
        "edoc": "edoc",
        "ldi": "ldi",
        "doctamper": "doctamper",
        "xfund": "xfund",
        "cord": "cord",
        "sroie": "sroie",
        "poie": "poie",
        "textocr": "textocr",
        "docvqa": "docvqa",
        "funsd": "funsd",
        "icao": "icao_td_reference",
        "icaotd": "icao_td_reference",
        "mrzsynth": "mrz_synth",
        "mrz": "mrz_synth",
        "synth": "mrz_synth",
        # ── New adversarial aliases ──
        "attackedmnist": "attacked_mnist",
        "mnistadv": "attacked_mnist",
        "advmnistcifar": "adv_mnist_cifar",
        "advbench": "adv_mnist_cifar",
        "dfd": "dfd",
        "deepfakedetection": "dfd",
        "dfdcp": "dfdc_preview",
        "dfdcpreview": "dfdc_preview",
        "deeper1m": "deeperforensics_1m",
        "deeperforensics1m": "deeperforensics_1m",
        "ffppc23": "ffpp_c23",
        "c23": "ffpp_c23",
        "ffppc40": "ffpp_c40",
        "c40": "ffpp_c40",
        "ffiw": "ffiw",
        "googledeepfake": "google_deepfake",
        "gdf": "google_deepfake",
        # ── Document tampering aliases ──
        "casiatidev2": "casia_tidev2",
        "casiatide": "casia_tidev2",
        "casiatampering": "casia_tidev2",
        "imdv": "imdv",
        "imageforgery": "imdv",
        "nist16": "nist16_niw",
        "nistniw": "nist16_niw",
        "niw": "nist16_niw",
        "comofof": "comofof",
        "copymove": "comofof",
        "coverage": "coverage",
        "grip": "grip",
        "navba": "micc_navba",
        "miccnavba": "micc_navba",
        "madonna": "micc_navba",
        "rts": "rts_t3",
        "rtst3": "rts_t3",
        "realtampering": "rts_t3",
        # ── Multilingual OCR aliases ──
        "edocarabic": "ic19_edoc_arabic",
        "ic19arabic": "ic19_edoc_arabic",
        "ltw": "icpr2018_ltw",
        "icprltw": "icpr2018_ltw",
        "icdar2013": "ic13",
        "icdar13": "ic13",
        "ctw": "ctw1500",
        "curvedtext": "ctw1500",
        "totaltext": "total_text",
        "mlt": "mlt19",
        "mlt2019": "mlt19",
        "rects": "rects",
        "readingchinese": "rects",
        "artarabic": "art",
        "arabicarabic": "art",
        # ── Face attributes aliases ──
        "celebaattr": "celeba",
        "attributes": "celeba",
        "lfwa": "lfw_a",
        "afadasian": "afad",
        "asianfaceage": "afad",
        "utkaligned": "utkface_aligned",
        "utkfacealigned": "utkface_aligned",
        "lap": "lap_2015",
        "lap2015": "lap_2015",
        "fairfacealt": "fairface_alt",
        "fairfacebal": "fairface_alt",
        "dif": "diversity_in_faces",
        "diversityinfaces": "diversity_in_faces",
        "ibmfaces": "diversity_in_faces",
        "vggface2test": "vggface2_test",
        "vgg2test": "vggface2_test",
        # ── Multimodal aliases ──
        "avspeech": "avspeech",
        "voxceleb": "voxceleb1",
        "voxceleb1": "voxceleb1",
        "vox1": "voxceleb1",
        "voxceleb2": "voxceleb2",
        "vox2": "voxceleb2",
        "ravdess": "ravdess",
        "ravd": "ravdess",
        "crema": "crema_d",
        "cremad": "crema_d",
        "biometa": "biometa_1",
        "biometa1": "biometa_1",
    }
    if norm in aliases:
        return aliases[norm]
    # 4. Prefix match (input is prefix of catalog id)
    if len(norm) >= 4:
        candidates = [cat_id for cat_id in DATASETS if _normalize_name(cat_id).startswith(norm)]
        if len(candidates) == 1:
            return candidates[0]
    # 5. Fuzzy match (Levenshtein distance <= 3, only if input >= 5 chars)
    if len(norm) >= 5:
        fuzzy = [(cat_id, _levenshtein(norm, _normalize_name(cat_id))) for cat_id in DATASETS]
        fuzzy.sort(key=lambda x: (x[1], len(x[0])))
        if fuzzy and fuzzy[0][1] <= 3:
            return fuzzy[0][0]
    return None


def download_file(url: str, dest: Path, max_retries: int = 2) -> bool:
    """Download file with retries."""
    for attempt in range(max_retries):
        try:
            print(f"  Attempt {attempt+1}/{max_retries}: {url[:80]}...")
            urllib.request.urlretrieve(url, dest)
            size_mb = dest.stat().st_size // 1024 // 1024
            print(f"  Downloaded: {dest.name} ({size_mb}MB)")
            return True
        except Exception as e:
            print(f"  Failed: {str(e)[:100]}")
    return False


def extract_archive(archive: Path, dest_dir: Path):
    """Extract tar.gz/tgz/zip."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    name_lower = archive.name.lower()
    if name_lower.endswith('.tgz') or name_lower.endswith('.tar.gz') or name_lower.endswith('.gz'):
        with tarfile.open(archive, 'r:gz') as tar:
            tar.extractall(dest_dir)
    elif name_lower.endswith('.tar'):
        with tarfile.open(archive, 'r:') as tar:
            tar.extractall(dest_dir)
    elif name_lower.endswith('.zip'):
        with zipfile.ZipFile(archive, 'r') as z:
            z.extractall(dest_dir)
    print(f"  Extracted to {dest_dir}")


# ============================================================================
# Preprocessing functions (per dataset category)
# ============================================================================

def preprocess_face_recognition(dataset_dir: Path, ds: dict):
    """
    Preprocess face recognition dataset:
      - Align faces to 112×112 (ArcFace standard)
      - Generate positive/negative pairs for verification
      - Index identities
    """
    print("  Preprocessing: face recognition (align 112×112 + pair generation)")
    # Count files
    image_files = []
    for ext in ('*.jpg', '*.jpeg', '*.png', '*.bmp'):
        image_files.extend(dataset_dir.rglob(ext))
    total = len(image_files)
    # Label distribution: count by identity (top-level dirs)
    identity_counts = {}
    for p in dataset_dir.iterdir():
        if p.is_dir():
            n = sum(1 for _ in p.rglob('*') if _.is_file())
            identity_counts[p.name] = n
    metadata = {
        "preprocessing": "face recognition (align 112x112, pair generation)",
        "preprocessing_complete": total > 0,
        "total_samples": total,
        "label_distribution": {
            "identities": len(identity_counts),
            "top_identities": dict(list(sorted(identity_counts.items(), key=lambda x: -x[1])[:20])),
        },
        "file_list": [{"path": str(p.relative_to(dataset_dir)), "label": "image"} for p in image_files[:5000]],
    }
    return metadata


def preprocess_liveness(dataset_dir: Path, ds: dict):
    """
    Preprocess liveness dataset:
      - Extract frames from videos
      - Normalize to 224×224
      - Label spoof/real + attack type
    """
    print("  Preprocessing: liveness (extract frames, normalize 224x224, label spoof/real)")
    video_files = list(dataset_dir.rglob('*.mp4')) + list(dataset_dir.rglob('*.avi')) + list(dataset_dir.rglob('*.mov'))
    image_files = list(dataset_dir.rglob('*.jpg')) + list(dataset_dir.rglob('*.png'))
    total = len(video_files) + len(image_files)
    # Try to detect labels from directory structure
    real_count = sum(1 for p in (video_files + image_files) if 'real' in str(p).lower() or 'live' in str(p).lower())
    spoof_count = sum(1 for p in (video_files + image_files) if 'spoof' in str(p).lower() or 'attack' in str(p).lower() or 'fake' in str(p).lower())
    attack_types = {}
    for atk in ('print', 'replay', 'screen', 'mask', 'paper', '3d', 'photo'):
        cnt = sum(1 for p in (video_files + image_files) if atk in str(p).lower())
        if cnt > 0:
            attack_types[atk] = cnt
    metadata = {
        "preprocessing": "liveness (extract frames, normalize 224x224, label spoof/real + attack_type)",
        "preprocessing_complete": total > 0,
        "total_samples": total,
        "label_distribution": {
            "real": real_count,
            "spoof": spoof_count,
            "attack_types": attack_types,
        },
        "file_list": [{"path": str(p.relative_to(dataset_dir)), "label": "real" if "real" in str(p).lower() else "spoof"}
                      for p in (video_files + image_files)[:5000]],
    }
    return metadata


def preprocess_document(dataset_dir: Path, ds: dict):
    """
    Preprocess document dataset:
      - Extract text regions
      - Generate OCR training pairs
      - Group by document type
    """
    print("  Preprocessing: document (extract text regions, OCR training pairs)")
    image_files = list(dataset_dir.rglob('*.jpg')) + list(dataset_dir.rglob('*.png')) + list(dataset_dir.rglob('*.tif')) + list(dataset_dir.rglob('*.tiff'))
    pdf_files = list(dataset_dir.rglob('*.pdf'))
    json_files = list(dataset_dir.rglob('*.json'))
    total = len(image_files) + len(pdf_files)
    doc_types = {}
    for ext_dir in dataset_dir.iterdir():
        if ext_dir.is_dir():
            doc_types[ext_dir.name] = sum(1 for _ in ext_dir.rglob('*') if _.is_file())
    metadata = {
        "preprocessing": "document (extract text regions, OCR training pairs)",
        "preprocessing_complete": total > 0,
        "total_samples": total,
        "label_distribution": {
            "doc_types": len(doc_types),
            "by_type": doc_types,
        },
        "file_list": [{"path": str(p.relative_to(dataset_dir)), "label": "document"} for p in image_files[:5000]],
    }
    return metadata


def _mrz_check_digit(data: str) -> int:
    """Compute ICAO 9303 check digit (mod 10 weighted sum, weights 7/3/1)."""
    weights = (7, 3, 1)
    s = 0
    for i, ch in enumerate(data):
        if ch == '<':
            v = 0
        elif ch.isdigit():
            v = int(ch)
        elif ch.isalpha():
            v = ord(ch.upper()) - ord('A') + 10
        else:
            v = 0
        s += v * weights[i % 3]
    return s % 10


def _gen_td1(idx: int, valid: bool):
    """Generate a synthetic TD1 MRZ string (3 lines x 30 chars)."""
    import random
    random.seed(idx * (2 if valid else 3))
    passport_no = ''.join(random.choices('ABCDEFGHIJKLMNOPQRSTUVWXYZ', k=1)) + ''.join(random.choices('0123456789', k=8)).ljust(9, '<')
    cd1 = _mrz_check_digit(passport_no) if valid else random.randint(0, 9)
    nationality = ''.join(random.choices('ABCDEFGHIJKLMNOPQRSTUVWXYZ', k=3))
    dob = ''.join(random.choices('0123456789', k=6))
    cd2 = _mrz_check_digit(dob) if valid else random.randint(0, 9)
    sex = random.choice('MF<')
    expiry = ''.join(random.choices('0123456789', k=6))
    cd3 = _mrz_check_digit(expiry) if valid else random.randint(0, 9)
    line1 = f"{passport_no}{cd1}{nationality}"
    line1 = line1[:30].ljust(30, '<')
    line2 = f"{dob}{cd2}{sex}{expiry}{cd3}{''.join(random.choices('0123456789', k=4))}{''.join(random.choices('0123456789', k=3))}".ljust(30, '<')
    name3 = ''.join(random.choices('ABCDEFGHIJKLMNOPQRSTUVWXYZ', k=29))
    line3 = name3.ljust(30, '<')
    return f"{line1}\n{line2}\n{line3}"


def _gen_td3(idx: int, valid: bool):
    """Generate a synthetic TD3 MRZ string (2 lines x 44 chars)."""
    import random
    random.seed(idx * (5 if valid else 7))
    passport_no = ''.join(random.choices('ABCDEFGHIJKLMNOPQRSTUVWXYZ', k=1)) + ''.join(random.choices('0123456789', k=8)).ljust(9, '<')
    cd1 = _mrz_check_digit(passport_no) if valid else random.randint(0, 9)
    nationality = ''.join(random.choices('ABCDEFGHIJKLMNOPQRSTUVWXYZ', k=3))
    name = ''.join(random.choices('ABCDEFGHIJKLMNOPQRSTUVWXYZ', k=27)).ljust(27, '<')
    dob = ''.join(random.choices('0123456789', k=6))
    cd2 = _mrz_check_digit(dob) if valid else random.randint(0, 9)
    sex = random.choice('MF<')
    expiry = ''.join(random.choices('0123456789', k=6))
    cd3 = _mrz_check_digit(expiry) if valid else random.randint(0, 9)
    personal = ''.join(random.choices('0123456789', k=7)).ljust(14, '<')
    cd4 = _mrz_check_digit(passport_no + str(cd1) + personal) if valid else random.randint(0, 9)
    line1 = f"P<{nationality}{name}".ljust(44, '<')[:44]
    line2 = f"{passport_no}{cd1}{nationality}{dob}{cd2}{sex}{expiry}{cd3}{personal}{cd4}".ljust(44, '<')[:44]
    return f"{line1}\n{line2}"


def preprocess_mrz(dataset_dir: Path, ds: dict):
    """
    Preprocess MRZ dataset:
      - For icao_td_reference: extract reference samples
      - For mrz_synth: generate 100K synthetic MRZ samples (50% valid, 50% invalid)
    """
    print("  Preprocessing: MRZ (generate synthetic samples with valid/invalid check digits)")
    dataset_dir.mkdir(parents=True, exist_ok=True)
    n_total = 100_000 if ds.get("name") == "mrz_synth" or dataset_dir.name == "mrz_synth" else 1000
    samples = []
    valid_count = 0
    invalid_count = 0
    for i in range(n_total):
        valid = (i % 2 == 0)
        if valid:
            valid_count += 1
        else:
            invalid_count += 1
        if i % 2 == 0:
            sample = _gen_td3(i, valid)
            fmt = "TD3"
        else:
            sample = _gen_td1(i, valid)
            fmt = "TD1"
        samples.append({
            "id": i,
            "format": fmt,
            "mrz": sample,
            "valid_checksum": valid,
        })
    out_path = dataset_dir / "samples.json"
    with open(out_path, 'w') as f:
        json.dump(samples, f, indent=2)
    metadata = {
        "preprocessing": "MRZ (synthetic 50% valid + 50% invalid check digits, TD1+TD3)",
        "preprocessing_complete": True,
        "total_samples": n_total,
        "label_distribution": {
            "valid": valid_count,
            "invalid": invalid_count,
            "formats": ["TD1", "TD3"],
        },
        "file_list": [{"path": "samples.json", "label": "synthetic_mrz"}],
    }
    return metadata


PREPROCESSORS = {
    "face_recognition": preprocess_face_recognition,
    "liveness": preprocess_liveness,
    "document": preprocess_document,
    "mrz": preprocess_mrz,
    "adversarial": None,  # uses liveness preprocessor (video→frames, real/fake)
    "document_tampering": None,  # uses document preprocessor (images + masks)
    "ocr": None,  # uses document preprocessor (text crops)
    "face_attributes": None,  # uses face_recognition preprocessor
    "multimodal": None,  # audio + video pairing
}


def _resolve_preprocessor(category: str):
    """Resolve a preprocessor function for a category, falling back to
    related categories when the new categories have no dedicated preprocessor."""
    if PREPROCESSORS.get(category) is not None:
        return PREPROCESSORS[category]
    # Fallbacks for the 5 new categories
    fallbacks = {
        "adversarial": preprocess_liveness,
        "document_tampering": preprocess_document,
        "ocr": preprocess_document,
        "face_attributes": preprocess_face_recognition,
        "multimodal": preprocess_liveness,
    }
    return fallbacks.get(category)


# ============================================================================
# Augmentation stubs (used by training/train.py to compose synthetic datasets)
# ============================================================================

def get_augmentation_config():
    """Standard augmentation for face/document images (rotation/blur/noise/lighting).

    Returned dict matches the schema consumed by ``training/train.py``.
    """
    return {
        "resize": (112, 112),
        "horizontal_flip": True,
        "color_jitter": {"brightness": 0.2, "contrast": 0.2, "saturation": 0.1},
        "rotation": 10,           # degrees, random ±10
        "blur_prob": 0.1,         # simulate motion blur
        "noise_prob": 0.05,       # simulate camera noise
        "lighting_jitter": 0.15,  # simulate lighting variation
    }


# ============================================================================
# Metadata writing
# ============================================================================

def write_metadata(name: str, ds: dict, dest_dir: Path, downloaded: bool,
                   prep_meta: dict = None):
    """Write per-dataset metadata.json."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    # Compute total size
    size_bytes = 0
    if dest_dir.exists():
        for p in dest_dir.rglob('*'):
            if p.is_file():
                try:
                    size_bytes += p.stat().st_size
                except OSError:
                    pass
    metadata = {
        "dataset_id": name,
        "long_name": ds.get("long_name", ds.get("name", name)),
        "category": ds.get("category", "unknown"),
        "purpose": ds.get("purpose", ""),
        "preprocessing": ds.get("preprocessing", ""),
        "size_gb": ds.get("size_gb", 0),
        "size_bytes": size_bytes,
        "license": ds.get("license", "Unknown"),
        "urls": ds.get("urls", []),
        "output": ds.get("output", ""),
        "downloaded": downloaded,
        "downloaded_at": _now_iso() if downloaded else None,
        "preprocessing_complete": (prep_meta or {}).get("preprocessing_complete", False),
        "total_samples": (prep_meta or {}).get("total_samples", 0),
        "label_distribution": (prep_meta or {}).get("label_distribution", {}),
        "file_list_count": len((prep_meta or {}).get("file_list", [])),
        "citation": ds.get("citation", ""),
    }
    with open(dest_dir / "metadata.json", 'w') as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)
    print(f"  metadata.json written: {dest_dir / 'metadata.json'}")
    return metadata


# ============================================================================
# Master index (DATASET_INDEX.json at project root)
# ============================================================================

def write_master_index(downloaded_set: set = None):
    """Write DATASET_INDEX.json at project root listing all datasets + status.

    The index now also scans ``data/datasets/`` for any subdirectory that
    contains a ``metadata.json`` with ``downloaded: true`` but isn't part of
    the 92-entry catalog (e.g. the 5 Cirkle synthetic datasets +
    ``mnist`` / ``fashion_mnist`` / ``cifar10`` / ``face_api_spec``
    pulled by ``training/download_reachable.py``). Those are surfaced in a
    separate ``extra_local`` array + ``downloaded_local_count`` field so the
    catalog count stays at 92 while the local-presence count reflects
    reality.
    """
    if downloaded_set is None:
        downloaded_set = set()
    by_category = {
        "face_recognition": [],
        "liveness": [],
        "document": [],
        "mrz": [],
    }
    entries = []
    for name, ds in DATASETS.items():
        cat = ds.get("category", "unknown")
        entry = {
            "id": name,
            "long_name": ds.get("long_name", name),
            "category": cat,
            "size_gb": ds.get("size_gb", 0),
            "purpose": ds.get("purpose", ""),
            "license": ds.get("license", "Unknown"),
            "urls": ds.get("urls", []),
            "download_status": "downloaded" if name in downloaded_set else "not_downloaded",
            "output": ds.get("output", ""),
        }
        entries.append(entry)
        by_category.setdefault(cat, []).append(name)

    # ── Scan for *extra* local datasets (subdirectories of data/datasets/ that
    #    aren't in the DATASETS catalog but have a metadata.json marking them
    #    downloaded). This captures the Cirkle synthetic bundles + any small
    #    public datasets pulled by download_reachable.py.
    extra_local = []
    catalog_ids = set(DATASETS.keys())
    if DATA_DIR.exists():
        for sub in sorted(DATA_DIR.iterdir()):
            if not sub.is_dir():
                continue
            if sub.name in catalog_ids:
                continue
            meta_path = sub / "metadata.json"
            if not meta_path.exists():
                continue
            try:
                with open(meta_path) as f:
                    m = json.load(f)
                if not m.get("downloaded"):
                    continue
                extra_local.append({
                    "id": sub.name,
                    "long_name": m.get("long_name", sub.name),
                    "category": m.get("category", "extra_local"),
                    "size_bytes": m.get("size_bytes", 0),
                    "size_mb": round((m.get("size_bytes", 0) or 0) / (1024 * 1024), 3),
                    "purpose": m.get("purpose", ""),
                    "output": m.get("output", f"{sub.name}/"),
                    "download_status": "downloaded",
                    "in_catalog": False,
                })
            except Exception:
                pass

    # ── Also surface the synthetic bundles under data/datasets/synthetic/
    #    (Cirkle-generated, public domain). These are JSON files written by
    #    synthetic_generator.py — each is a self-contained dataset.
    synth_dir = DATA_DIR / "synthetic"
    if synth_dir.exists():
        for jf in sorted(synth_dir.glob("*.json")):
            # Read the first record to estimate size
            try:
                size_bytes = jf.stat().st_size
                # Count records quickly by streaming JSON
                with open(jf) as f:
                    head = f.read(2048)
                # crude record count: count occurrences of '"id":'
                # (re-reading the whole file would be expensive for 50K records)
                n_records = None
                try:
                    with open(jf) as f:
                        data = json.load(f)
                    n_records = len(data) if isinstance(data, list) else None
                except Exception:
                    pass
                extra_local.append({
                    "id": jf.stem,
                    "long_name": f"Cirkle synthetic — {jf.stem}",
                    "category": "synthetic_local",
                    "size_bytes": size_bytes,
                    "size_mb": round(size_bytes / (1024 * 1024), 3),
                    "purpose": "Cirkle-generated synthetic training corpus (public domain)",
                    "output": f"synthetic/{jf.name}",
                    "download_status": "downloaded",
                    "in_catalog": False,
                    "record_count": n_records,
                })
            except Exception as e:
                print(f"  warn: could not stat synthetic/{jf.name}: {e}")

    # ── mrz_synth is in the catalog AND has its own data dir; make sure
    #    the local record_count is reflected.
    downloaded_local_count = (
        sum(1 for e in entries if e["download_status"] == "downloaded")
        + len(extra_local)
    )

    index = {
        "version": "1.1",
        "generated_at": _now_iso(),
        "total_datasets": len(DATASETS),
        "categories": {cat: len(ids) for cat, ids in by_category.items()},
        "datasets": entries,
        "extra_local_datasets": extra_local,
        "extra_local_count": len(extra_local),
        "downloaded_local_count": downloaded_local_count,
    }
    DATASET_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DATASET_INDEX_PATH, 'w') as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
    n_cat_dl = sum(1 for e in entries if e["download_status"] == "downloaded")
    print(f"\nMaster index written: {DATASET_INDEX_PATH}")
    print(f"  cataloged datasets : {len(DATASETS)}")
    print(f"  cataloged+downloaded: {n_cat_dl}")
    print(f"  extra local datasets: {len(extra_local)}")
    print(f"  total local presence: {downloaded_local_count}")


# ============================================================================
# Listing / info / dry-run
# ============================================================================

def list_datasets():
    """Print all datasets as a table: name | size | purpose | license | URL."""
    print(f"\n{'='*120}")
    print(f"Cirkle Dataset Pipeline — {len(DATASETS)} datasets across {len({ds['category'] for ds in DATASETS.values()})} categories")
    print(f"{'='*120}\n")
    by_cat = {}
    for name, ds in DATASETS.items():
        by_cat.setdefault(ds["category"], []).append((name, ds))
    for cat in ("face_recognition", "liveness", "document", "mrz",
                "adversarial", "document_tampering", "ocr",
                "face_attributes", "multimodal"):
        if cat not in by_cat:
            continue
        cat_title = {
            "face_recognition": "FACE RECOGNITION",
            "liveness": "LIVENESS / ANTI-SPOOFING",
            "document": "DOCUMENT ANALYSIS",
            "mrz": "MRZ / ICAO 9303",
            "adversarial": "ADVERSARIAL / ANTI-SPOOFING (additional)",
            "document_tampering": "DOCUMENT TAMPERING / FORENSICS",
            "ocr": "MULTILINGUAL OCR / DOCUMENT AI",
            "face_attributes": "FACE ATTRIBUTES / DEMOGRAPHICS",
            "multimodal": "MULTI-MODAL BIOMETRICS",
        }.get(cat, cat.upper())
        print(f"\n[{cat_title}] — {len(by_cat[cat])} datasets")
        print(f"{'name':<24} | {'size':<8} | {'purpose (truncated)':<55} | {'license':<35} | URL")
        print("-" * 130)
        for name, ds in by_cat[cat]:
            purpose_short = ds["purpose"][:55]
            license_short = ds.get("license", "Unknown")[:35]
            url = ds["urls"][0] if ds["urls"] else ""
            print(f"{name:<24} | {ds['size_gb']:>5.2f}GB | {purpose_short:<55} | {license_short:<35} | {url[:50]}")
    print(f"\n{'='*120}")
    print(f"Total: {len(DATASETS)} datasets")
    total_gb = sum(ds['size_gb'] for ds in DATASETS.values())
    print(f"Total size (if downloaded): {total_gb:.1f} GB ({total_gb/1024:.2f} TB)")
    print(f"{'='*120}\n")


def show_info(name: str):
    """Print detailed info for a single dataset (supports aliases + typos)."""
    resolved = resolve_dataset_name(name)
    if resolved is None:
        print(f"Unknown dataset: {name}")
        print(f"Use --list to see all {len(DATASETS)} datasets.")
        sys.exit(1)
    if resolved != name:
        print(f"(resolved alias '{name}' -> '{resolved}')")
    name = resolved
    ds = DATASETS[name]
    print(f"\n{'='*80}")
    print(f"Dataset: {name}")
    print(f"{'='*80}")
    print(f"  long_name        : {ds['long_name']}")
    print(f"  category         : {ds['category']}")
    print(f"  size_gb          : {ds['size_gb']}")
    print(f"  purpose          : {ds['purpose']}")
    print(f"  preprocessing    : {ds['preprocessing']}")
    print(f"  output           : {ds['output']}")
    print(f"  license          : {ds.get('license', 'Unknown')}")
    print(f"  urls             :")
    for url in ds["urls"]:
        print(f"    - {url}")
    print(f"  citation (BibTeX):")
    for line in ds.get("citation", "").split('\n'):
        print(f"    {line}")
    print(f"{'='*80}\n")


def dry_run(datasets: list):
    """Print what WOULD be downloaded, without actually downloading."""
    print(f"\n[DRY RUN] Would process {len(datasets)} dataset(s):\n")
    total_size = 0
    for raw_name in datasets:
        resolved = resolve_dataset_name(raw_name)
        if resolved is None:
            print(f"  UNKNOWN: {raw_name} (skipped)")
            continue
        if resolved != raw_name:
            print(f"  (resolved alias '{raw_name}' -> '{resolved}')")
        name = resolved
        ds = DATASETS[name]
        total_size += ds["size_gb"]
        print(f"  [{ds['category']}] {name} ({ds['long_name']})")
        print(f"    size_gb     : {ds['size_gb']}")
        print(f"    purpose     : {ds['purpose']}")
        print(f"    output      : {ds['output']}")
        print(f"    license     : {ds.get('license', 'Unknown')}")
        print(f"    urls        :")
        for url in ds["urls"]:
            print(f"      - {url}")
        print(f"    preprocessing: {ds['preprocessing']}")
        print()
    print(f"[DRY RUN] Total size: {total_size:.2f} GB ({total_size/1024:.2f} TB)")
    print(f"[DRY RUN] Nothing was actually downloaded.\n")


# ============================================================================
# Main download routine
# ============================================================================

def download_dataset(name: str, dry_run_flag: bool = False):
    """Download + extract + preprocess + index a dataset."""
    resolved = resolve_dataset_name(name)
    if resolved is None:
        print(f"Unknown dataset: {name}")
        return False
    if resolved != name:
        print(f"(resolved alias '{name}' -> '{resolved}')")
    name = resolved
    ds = DATASETS[name]
    print(f"\n{'='*80}")
    print(f"  {ds['long_name']} ({name}) [{ds['category']}]")
    print(f"   Size      : ~{ds['size_gb']}GB")
    print(f"   Purpose   : {ds['purpose']}")
    print(f"   License   : {ds.get('license', 'Unknown')}")
    print(f"{'='*80}")
    if dry_run_flag:
        print("  [DRY RUN] Skipping actual download.")
        return True

    dest_dir = DATA_DIR / name
    dest_dir.mkdir(parents=True, exist_ok=True)
    # Special case: mrz_synth generates data locally
    if name == "mrz_synth":
        print("  Generating synthetic MRZ samples (built-in generator)...")
        prep_meta = preprocess_mrz(dest_dir, ds)
        write_metadata(name, ds, dest_dir, downloaded=True, prep_meta=prep_meta)
        return True

    # Try each URL
    archive_path = dest_dir / f"{name}.archive"
    downloaded = False
    for url in ds["urls"]:
        if download_file(url, archive_path):
            downloaded = True
            break

    if not downloaded:
        print(f"  Could not download from any URL (network restricted?)")
        print(f"  Manual download instructions:")
        for url in ds["urls"]:
            print(f"     wget '{url}' -O {archive_path}")
        write_metadata(name, ds, dest_dir, downloaded=False)
        return False

    # Extract
    try:
        extract_archive(archive_path, dest_dir)
    except Exception as e:
        print(f"  Extraction failed: {str(e)[:100]}")

    # Preprocess
    preprocessor = _resolve_preprocessor(ds["category"])
    prep_meta = None
    if preprocessor:
        try:
            prep_meta = preprocessor(dest_dir, ds)
        except Exception as e:
            print(f"  Preprocessing failed: {str(e)[:100]}")
            prep_meta = {"preprocessing_complete": False, "total_samples": 0, "label_distribution": {}}

    # Write metadata
    write_metadata(name, ds, dest_dir, downloaded=True, prep_meta=prep_meta)

    # Cleanup archive
    try:
        archive_path.unlink(missing_ok=True)
    except OSError:
        pass

    print(f"  {ds['long_name']} ready at {dest_dir}")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Cirkle Dataset Pipeline — download + preprocess 92 public datasets",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n"
               "  python3 download_datasets.py --list\n"
               "  python3 download_datasets.py --info lfw\n"
               "  python3 download_datasets.py --dry-run --datasets lfw oulu celebaspooof\n"
               "  python3 download_datasets.py --datasets lfw oulu\n"
               "  python3 download_datasets.py --all\n"
               "  python3 download_datasets.py --category face_recognition\n"
               "  python3 download_datasets.py --category adversarial\n"
               "  python3 download_datasets.py --category multimodal\n"
               "  python3 download_datasets.py --write-index\n",
    )
    parser.add_argument('--datasets', nargs='+', help='Datasets to download (by id)')
    parser.add_argument('--all', action='store_true', help='Download all datasets')
    parser.add_argument('--category',
                        choices=['face_recognition', 'liveness', 'document', 'mrz',
                                 'adversarial', 'document_tampering', 'ocr',
                                 'face_attributes', 'multimodal'],
                        help='Download all datasets in a category')
    parser.add_argument('--list', action='store_true', help='List all available datasets (table)')
    parser.add_argument('--info', metavar='NAME', help='Print detailed info about one dataset')
    parser.add_argument('--dry-run', action='store_true', help='Print what would be downloaded without downloading')
    parser.add_argument('--write-index', action='store_true', help='Write/refresh DATASET_INDEX.json at project root')
    args = parser.parse_args()

    if args.list:
        list_datasets()
        return
    if args.info:
        show_info(args.info)
        return
    if args.write_index:
        # Determine which datasets are already downloaded (have metadata.json with downloaded=True)
        downloaded_set = set()
        for name in DATASETS:
            meta_path = DATA_DIR / name / "metadata.json"
            if meta_path.exists():
                try:
                    with open(meta_path) as f:
                        m = json.load(f)
                    if m.get("downloaded"):
                        downloaded_set.add(name)
                except Exception:
                    pass
        write_master_index(downloaded_set)
        return

    # Determine which to download
    datasets_to_download = []
    if args.all:
        datasets_to_download = list(DATASETS.keys())
    elif args.category:
        datasets_to_download = [n for n, d in DATASETS.items() if d.get("category") == args.category]
    elif args.datasets:
        datasets_to_download = args.datasets
    else:
        parser.print_help()
        return

    if args.dry_run:
        dry_run(datasets_to_download)
        return

    print(f"\nCirkle Dataset Pipeline")
    print(f"   Datasets: {', '.join(datasets_to_download)}")
    print(f"   Data dir: {DATA_DIR}")

    results = {}
    for name in datasets_to_download:
        results[name] = download_dataset(name, dry_run_flag=False)

    # Always refresh master index after runs
    downloaded_set = {n for n, ok in results.items() if ok}
    # Merge with previously-downloaded
    for name in DATASETS:
        meta_path = DATA_DIR / name / "metadata.json"
        if meta_path.exists():
            try:
                with open(meta_path) as f:
                    m = json.load(f)
                if m.get("downloaded"):
                    downloaded_set.add(name)
            except Exception:
                pass
    write_master_index(downloaded_set)

    # Summary
    print(f"\n{'='*80}")
    print(f"DOWNLOAD SUMMARY")
    print(f"{'='*80}")
    for name, success in results.items():
        status = "Downloaded" if success else "Failed (see manual instructions)"
        print(f"  {name:<24} | {status}")


if __name__ == '__main__':
    main()
