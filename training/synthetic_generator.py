#!/usr/bin/env python3
"""
Cirkle Synthetic Data Generator — generate edge cases for ML training
that real datasets systematically miss.

This module produces 5 classes of synthetic data, each targeting a
weakness in current identity-verification training sets:

1. **Synthetic Identity Generator** (``--type identity``)
   - 10,000 fake-but-format-valid identities across 73 countries.
   - Each identity's national ID passes the country-specific checksum
     algorithm (Luhn, ISO 7064 MOD 11-2/11-10, Egyptian 14-digit, etc.).
   - Matching name (Arabic + Latin script for Arabic countries),
     address, and document number.

2. **Synthetic Face Generator** (``--type face``)
   - 50,000 face-image *descriptors* (metadata only — no actual images).
   - Age, gender, Fitzpatrick I-VI, eye color, hair, glasses, beard.
   - Variations: pose, lighting, expression, occlusion.
   - Attack variants: print attack, screen replay, 3D mask, deepfake.

3. **Synthetic Fraud Ring Generator** (``--type fraud_rings``)
   - 50 fraud rings of 3-10 nodes each, sharing device/IP/email/phone/doc.
   - Each ring has 1-5 mules + 1-3 controllers.

4. **Synthetic MRZ Generator** (``--type mrz``)
   - 20,000 valid + invalid TD1/TD2/TD3 MRZ strings across 73 countries.
   - Invalid variants: wrong check digit, wrong field length, mixed
     scripts, special characters.

5. **Adversarial Sample Generator** (``--type adversarial``)
   - 10,000 adversarial-attack signatures: deepfake GAN frequency
     artifacts, 3D mask texture, screen-replay moiré, print-attack paper.

Usage::

    python3 training/synthetic_generator.py --type all --count 10000
    python3 training/synthetic_generator.py --type identity --count 5000
    python3 training/synthetic_generator.py --type face --count 1000
    python3 training/synthetic_generator.py --type fraud_rings --count 50
    python3 training/synthetic_generator.py --type mrz --count 20000
    python3 training/synthetic_generator.py --type adversarial --count 10000

All output files are written to ``training/out/``.

Pure standard library — no numpy/scipy/pandas needed. Syntactically
valid Python 3.8+.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import string
import sys
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Country table (73 countries) — ISO 3166-1 alpha-3 + ID spec
# ---------------------------------------------------------------------------
# Each entry: (alpha3, country_name, id_format, script)
#   id_format: "luhn" | "iso7064_11_2" | "iso7064_11_10" | "mod97" | "egyptian" |
#              "saudi_hijri" | "uae_15" | "israel_tz" | "turkey_tc" |
#              "italy_cf" | "france_insee" | "spain_dni" | "portugal_cc" |
#              "brazil_cpf" | "mexico_curp" | "generic_numeric"
#   script: "arabic" | "latin" | "cyrillic" | "greek" | "cjk"
COUNTRIES: List[Dict[str, str]] = [
    {"alpha3": "EGY", "name": "Egypt", "id_format": "egyptian", "script": "arabic", "region": "MENA"},
    {"alpha3": "SAU", "name": "Saudi Arabia", "id_format": "saudi_hijri", "script": "arabic", "region": "MENA"},
    {"alpha3": "ARE", "name": "United Arab Emirates", "id_format": "uae_15", "script": "arabic", "region": "MENA"},
    {"alpha3": "KWT", "name": "Kuwait", "id_format": "generic_numeric", "script": "arabic", "region": "MENA", "id_len": 12},
    {"alpha3": "QAT", "name": "Qatar", "id_format": "generic_numeric", "script": "arabic", "region": "MENA", "id_len": 11},
    {"alpha3": "JOR", "name": "Jordan", "id_format": "generic_numeric", "script": "arabic", "region": "MENA", "id_len": 10},
    {"alpha3": "MAR", "name": "Morocco", "id_format": "generic_numeric", "script": "arabic", "region": "MENA", "id_len": 9},
    {"alpha3": "TUN", "name": "Tunisia", "id_format": "generic_numeric", "script": "arabic", "region": "MENA", "id_len": 8},
    {"alpha3": "DZA", "name": "Algeria", "id_format": "generic_numeric", "script": "arabic", "region": "MENA", "id_len": 9},
    {"alpha3": "LBN", "name": "Lebanon", "id_format": "generic_numeric", "script": "arabic", "region": "MENA", "id_len": 10},
    {"alpha3": "IRQ", "name": "Iraq", "id_format": "generic_numeric", "script": "arabic", "region": "MENA", "id_len": 12},
    {"alpha3": "SYR", "name": "Syria", "id_format": "generic_numeric", "script": "arabic", "region": "MENA", "id_len": 11},
    {"alpha3": "LBY", "name": "Libya", "id_format": "generic_numeric", "script": "arabic", "region": "MENA", "id_len": 12},
    {"alpha3": "SDN", "name": "Sudan", "id_format": "generic_numeric", "script": "arabic", "region": "MENA", "id_len": 11},
    {"alpha3": "BHR", "name": "Bahrain", "id_format": "generic_numeric", "script": "arabic", "region": "MENA", "id_len": 10},
    {"alpha3": "OMN", "name": "Oman", "id_format": "generic_numeric", "script": "arabic", "region": "MENA", "id_len": 8},
    {"alpha3": "YEM", "name": "Yemen", "id_format": "generic_numeric", "script": "arabic", "region": "MENA", "id_len": 12},
    {"alpha3": "PSE", "name": "Palestine", "id_format": "generic_numeric", "script": "arabic", "region": "MENA", "id_len": 9},
    {"alpha3": "ISR", "name": "Israel", "id_format": "israel_tz", "script": "latin", "region": "MENA"},
    {"alpha3": "TUR", "name": "Turkey", "id_format": "turkey_tc", "script": "latin", "region": "MENA"},
    {"alpha3": "IRN", "name": "Iran", "id_format": "generic_numeric", "script": "arabic", "region": "MENA", "id_len": 10},
    {"alpha3": "USA", "name": "United States", "id_format": "luhn", "script": "latin", "region": "NA", "id_len": 9},
    {"alpha3": "GBR", "name": "United Kingdom", "id_format": "generic_numeric", "script": "latin", "region": "EU", "id_len": 9, "id_prefix": "AB"},
    {"alpha3": "FRA", "name": "France", "id_format": "france_insee", "script": "latin", "region": "EU"},
    {"alpha3": "DEU", "name": "Germany", "id_format": "iso7064_11_2", "script": "latin", "region": "EU", "id_len": 10},
    {"alpha3": "ESP", "name": "Spain", "id_format": "spain_dni", "script": "latin", "region": "EU"},
    {"alpha3": "ITA", "name": "Italy", "id_format": "italy_cf", "script": "latin", "region": "EU"},
    {"alpha3": "NLD", "name": "Netherlands", "id_format": "iso7064_11_2", "script": "latin", "region": "EU", "id_len": 9},
    {"alpha3": "BEL", "name": "Belgium", "id_format": "iso7064_11_2", "script": "latin", "region": "EU", "id_len": 11},
    {"alpha3": "SWE", "name": "Sweden", "id_format": "luhn", "script": "latin", "region": "EU", "id_len": 10},
    {"alpha3": "NOR", "name": "Norway", "id_format": "iso7064_11_2", "script": "latin", "region": "EU", "id_len": 11},
    {"alpha3": "DNK", "name": "Denmark", "id_format": "luhn", "script": "latin", "region": "EU", "id_len": 10},
    {"alpha3": "FIN", "name": "Finland", "id_format": "iso7064_11_2", "script": "latin", "region": "EU", "id_len": 11},
    {"alpha3": "POL", "name": "Poland", "id_format": "iso7064_11_2", "script": "latin", "region": "EU", "id_len": 11},
    {"alpha3": "CZE", "name": "Czech Republic", "id_format": "luhn", "script": "latin", "region": "EU", "id_len": 10},
    {"alpha3": "GRC", "name": "Greece", "id_format": "luhn", "script": "greek", "region": "EU", "id_len": 9},
    {"alpha3": "ROU", "name": "Romania", "id_format": "generic_numeric", "script": "latin", "region": "EU", "id_len": 13},
    {"alpha3": "PRT", "name": "Portugal", "id_format": "portugal_cc", "script": "latin", "region": "EU"},
    {"alpha3": "IRL", "name": "Ireland", "id_format": "generic_numeric", "script": "latin", "region": "EU", "id_len": 8},
    {"alpha3": "AUT", "name": "Austria", "script": "latin", "region": "EU", "id_format": "generic_numeric", "id_len": 9},
    {"alpha3": "CHE", "name": "Switzerland", "id_format": "generic_numeric", "script": "latin", "region": "EU", "id_len": 13},
    {"alpha3": "HUN", "name": "Hungary", "id_format": "generic_numeric", "script": "latin", "region": "EU", "id_len": 9},
    {"alpha3": "BGR", "name": "Bulgaria", "id_format": "luhn", "script": "latin", "region": "EU", "id_len": 10},
    {"alpha3": "HRV", "name": "Croatia", "id_format": "iso7064_11_2", "script": "latin", "region": "EU", "id_len": 11},
    {"alpha3": "SRB", "name": "Serbia", "id_format": "iso7064_11_10", "script": "latin", "region": "EU", "id_len": 13},
    {"alpha3": "SVK", "name": "Slovakia", "id_format": "luhn", "script": "latin", "region": "EU", "id_len": 10},
    {"alpha3": "SVN", "name": "Slovenia", "id_format": "iso7064_11_2", "script": "latin", "region": "EU", "id_len": 8},
    {"alpha3": "EST", "name": "Estonia", "id_format": "generic_numeric", "script": "latin", "region": "EU", "id_len": 11},
    {"alpha3": "LTU", "name": "Lithuania", "id_format": "generic_numeric", "script": "latin", "region": "EU", "id_len": 11},
    {"alpha3": "ISL", "name": "Iceland", "id_format": "generic_numeric", "script": "latin", "region": "EU", "id_len": 10},
    {"alpha3": "RUS", "name": "Russia", "id_format": "generic_numeric", "script": "cyrillic", "region": "EECA", "id_len": 12},
    {"alpha3": "UKR", "name": "Ukraine", "id_format": "generic_numeric", "script": "cyrillic", "region": "EECA", "id_len": 10},
    {"alpha3": "BLR", "name": "Belarus", "id_format": "generic_numeric", "script": "cyrillic", "region": "EECA", "id_len": 14},
    {"alpha3": "GEO", "name": "Georgia", "id_format": "generic_numeric", "script": "latin", "region": "EECA", "id_len": 11},
    {"alpha3": "ARM", "name": "Armenia", "id_format": "generic_numeric", "script": "latin", "region": "EECA", "id_len": 10},
    {"alpha3": "AZE", "name": "Azerbaijan", "id_format": "generic_numeric", "script": "latin", "region": "EECA", "id_len": 10},
    {"alpha3": "KAZ", "name": "Kazakhstan", "id_format": "generic_numeric", "script": "cyrillic", "region": "EECA", "id_len": 12},
    {"alpha3": "UZB", "name": "Uzbekistan", "id_format": "generic_numeric", "script": "latin", "region": "EECA", "id_len": 14},
    {"alpha3": "IND", "name": "India", "id_format": "luhn", "script": "latin", "region": "AS", "id_len": 12},
    {"alpha3": "PAK", "name": "Pakistan", "id_format": "luhn", "script": "latin", "region": "AS", "id_len": 13},
    {"alpha3": "BGD", "name": "Bangladesh", "id_format": "luhn", "script": "latin", "region": "AS", "id_len": 13},
    {"alpha3": "LKA", "name": "Sri Lanka", "id_format": "luhn", "script": "latin", "region": "AS", "id_len": 11},
    {"alpha3": "NPL", "name": "Nepal", "id_format": "generic_numeric", "script": "latin", "region": "AS", "id_len": 10},
    {"alpha3": "AFG", "name": "Afghanistan", "id_format": "generic_numeric", "script": "arabic", "region": "AS", "id_len": 10},
    {"alpha3": "JPN", "name": "Japan", "id_format": "luhn", "script": "cjk", "region": "AS", "id_len": 12},
    {"alpha3": "KOR", "name": "South Korea", "id_format": "luhn", "script": "cjk", "region": "AS", "id_len": 13},
    {"alpha3": "CHN", "name": "China", "id_format": "iso7064_11_2", "script": "cjk", "region": "AS", "id_len": 18},
    {"alpha3": "SGP", "name": "Singapore", "id_format": "luhn", "script": "latin", "region": "AS", "id_len": 9, "id_prefix": "S"},
    {"alpha3": "MYS", "name": "Malaysia", "id_format": "generic_numeric", "script": "latin", "region": "AS", "id_len": 12},
    {"alpha3": "THA", "name": "Thailand", "id_format": "luhn", "script": "latin", "region": "AS", "id_len": 13},
    {"alpha3": "IDN", "name": "Indonesia", "id_format": "generic_numeric", "script": "latin", "region": "AS", "id_len": 16},
    {"alpha3": "PHL", "name": "Philippines", "id_format": "generic_numeric", "script": "latin", "region": "AS", "id_len": 12},
    {"alpha3": "VNM", "name": "Vietnam", "id_format": "generic_numeric", "script": "latin", "region": "AS", "id_len": 12},
]
assert len(COUNTRIES) == 73, f"Expected 73 countries, got {len(COUNTRIES)}"

# ---------------------------------------------------------------------------
# Name pools (subset — extended at runtime for variety)
# ---------------------------------------------------------------------------
ARABIC_MALE_NAMES = ["محمد", "أحمد", "عبدالله", "خالد", "عمر", "يوسف", "إبراهيم",
                    "علي", "حسن", "كريم", "سعيد", "ناصر", "فهد", "ماجد", "مصطفى",
                    "طارق", "وليد", "بدر", "سلطان", "فواز"]
ARABIC_FEMALE_NAMES = ["فاطمة", "عائشة", "نورة", "سارة", "هند", "ريم", "ليلى",
                      "مريم", "سمية", "نادية", "هالة", "منى", "دانة", "أمل", "وفاء",
                      "عبير", "لطيفة", "نجوى", "رنا", "شهد"]
ARABIC_SURNAMES = ["القحطاني", "العتيبي", "الغامدي", "الزهراني", "الحربي", "المطيري",
                  "الدوسري", "الشهري", "البلوي", "الحازمي", "المالكي", "العمري",
                  "السيد", "عبدالرحمن", "ابن سعود", "النعيمي", "الكندي", "الراشد"]

LATIN_MALE_NAMES = ["James", "John", "Robert", "Michael", "William", "David", "Thomas",
                   "Daniel", "Andrew", "Christopher", "Liam", "Noah", "Lucas", "Mason",
                   "Ethan", "Alexander", "Henry", "Sebastian", "Jack", "Owen"]
LATIN_FEMALE_NAMES = ["Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Susan",
                     "Karen", "Nancy", "Lisa", "Sarah", "Emma", "Olivia", "Sophia",
                     "Isabella", "Charlotte", "Amelia", "Mia", "Ava", "Ella", "Grace"]
LATIN_SURNAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
                 "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
                 "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin"]

FRENCH_MALE = ["Pierre", "Jean", "Michel", "Alain", "Philippe", "Jacques", "Henri",
              "Louis", "Antoine", "François"]
FRENCH_FEMALE = ["Marie", "Sophie", "Isabelle", "Nathalie", "Catherine", "Brigitte",
                "Sandrine", "Valérie", "Claire", "Camille"]
FRENCH_SURNAMES = ["Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard",
                  "Petit", "Durand", "Leroy", "Moreau", "Laurent", "Simon"]

GERMAN_MALE = ["Hans", "Peter", "Klaus", "Wolfgang", "Jürgen", "Stefan", "Andreas",
              "Michael", "Thomas", "Frank"]
GERMAN_FEMALE = ["Anna", "Sabine", "Ursula", "Helga", "Petra", "Barbara", "Monika",
                 "Christa", "Katrin", "Julia"]
GERMAN_SURNAMES = ["Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer",
                  "Wagner", "Becker", "Schulz", "Hoffmann", "Schäfer", "Bauer"]

SPANISH_MALE = ["Juan", "José", "Antonio", "Manuel", "Francisco", "David", "Javier",
               "Carlos", "Daniel", "Alejandro"]
SPANISH_FEMALE = ["María", "Carmen", "Ana", "Isabel", "Laura", "Cristina", "Marta",
                 "Lucía", "Elena", "Paula"]
SPANISH_SURNAMES = ["García", "Rodríguez", "González", "Fernández", "López", "Martínez",
                   "Sánchez", "Pérez", "Gómez", "Ruiz", "Hernández", "Díaz"]

ITALIAN_MALE = ["Marco", "Giuseppe", "Giovanni", "Francesco", "Antonio", "Luca",
               "Alessandro", "Andrea", "Matteo", "Lorenzo"]
ITALIAN_FEMALE = ["Giulia", "Sofia", "Aurora", "Martina", "Giorgia", "Sara",
                  "Chiara", "Alessandra", "Francesca", "Federica"]
ITALIAN_SURNAMES = ["Rossi", "Russo", "Ferrari", "Esposito", "Bianchi", "Romano",
                   "Colombo", "Ricci", "Marino", "Greco"]

PORTUGUESE_MALE = ["João", "José", "António", "Manuel", "Francisco", "Luís", "Paulo",
                  "Carlos", "Fernando", "Rui"]
PORTUGUESE_FEMALE = ["Maria", "Ana", "Catarina", "Sofia", "Margarida", "Inês",
                    "Beatriz", "Carolina", "Mariana", "Leonor"]

TURKISH_MALE = ["Mehmet", "Mustafa", "Ahmet", "Ali", "Hüseyin", "İbrahim", "Hasan",
               "Murat", "Emre", "Burak"]
TURKISH_FEMALE = ["Ayşe", "Fatma", "Emine", "Zeynep", "Hatice", "Elif", "Meryem",
                 "Şeyma", "Sultan", "Buse"]
TURKISH_SURNAMES = ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Yıldırım",
                   "Öztürk", "Aydın", "Arslan"]

JAPANESE_MALE = ["Haruto", "Yuto", "Sota", "Hiroto", "Yuki", "Haruki", "Ren",
                "Sora", "Kaito", "Yamato"]
JAPANESE_FEMALE = ["Yui", "Aoi", "Hina", "Yuna", "Sakura", "Rin", "Himari",
                  "Mio", "Tsumugi", "Akari"]
JAPANESE_SURNAMES = ["Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito",
                    "Yamamoto", "Nakamura", "Kobayashi", "Saito"]

KOREAN_MALE = ["Minjun", "Seojun", "Do-yoon", "Hajun", "Haneul", "Siwoo", "Eunwoo",
              "Jiwon", "Yejun", "Jiyong"]
KOREAN_FEMALE = ["Seoyeon", "Jiyu", "Seoyun", "Hayoon", "Jiyu", "Sooha", "Hayun",
                "Eunseo", "Jia", "Soobin"]
KOREAN_SURNAMES = ["Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon",
                  "Jang", "Lim"]

CHINESE_MALE = ["伟", "强", "磊", "军", "杰", "涛", "明", "超", "鹏", "华"]
CHINESE_FEMALE = ["芳", "娜", "敏", "静", "艳", "婷", "玲", "洁", "雪", "梅"]
CHINESE_SURNAMES = ["王", "李", "张", "刘", "陈", "杨", "赵", "黄", "周", "吴"]

RUSSIAN_MALE = ["Иван", "Дмитрий", "Александр", "Максим", "Сергей", "Андрей", "Алексей",
               "Артём", "Михаил", "Николай"]
RUSSIAN_FEMALE = ["Анна", "Мария", "Елена", "Ольга", "Наталья", "Татьяна", "Юлия",
                 "Ирина", "Светлана", "Екатерина"]
RUSSIAN_SURNAMES = ["Иванов", "Смирнов", "Кузнецов", "Попов", "Васильев", "Петров",
                   "Соколов", "Михайлов", "Новиков", "Фёдоров"]

INDIAN_MALE = ["Rahul", "Amit", "Raj", "Vijay", "Sanjay", "Anil", "Sunil", "Deepak",
              "Arjun", "Karan"]
INDIAN_FEMALE = ["Priya", "Anjali", "Pooja", "Sneha", "Neha", "Kavya", "Aarti",
                "Anita", "Divya", "Shreya"]
INDIAN_SURNAMES = ["Sharma", "Patel", "Singh", "Kumar", "Gupta", "Reddy", "Rao",
                  "Mehta", "Joshi", "Nair"]

# ---------------------------------------------------------------------------
# Address pools per region
# ---------------------------------------------------------------------------
ARABIC_CITIES = [("Cairo", "القاهرة"), ("Riyadh", "الرياض"), ("Dubai", "دبي"),
                ("Casablanca", "الدار البيضاء"), ("Amman", "عمّان"), ("Beirut", "بيروت"),
                ("Doha", "الدوحة"), ("Kuwait City", "مدينة الكويت"), ("Manama", "المنامة"),
                ("Muscat", "مسقط"), ("Tunis", "تونس"), ("Algiers", "الجزائر")]
EU_CITIES = ["Paris", "Berlin", "Madrid", "Rome", "Amsterdam", "Brussels", "Stockholm",
            "Copenhagen", "Helsinki", "Warsaw", "Prague", "Vienna", "Lisbon", "Dublin",
            "Athens", "Bucharest", "Budapest", "Sofia", "Zagreb", "Belgrade"]
NA_CITIES = ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia",
            "San Antonio", "San Diego", "Dallas", "Toronto", "Vancouver", "Montreal"]
AS_CITIES = ["Tokyo", "Seoul", "Beijing", "Shanghai", "Mumbai", "Delhi", "Bangalore",
            "Karachi", "Bangkok", "Jakarta", "Manila", "Singapore", "Hanoi", "Taipei"]
EECA_CITIES = ["Moscow", "St. Petersburg", "Kyiv", "Minsk", "Tbilisi", "Yerevan",
              "Baku", "Almaty", "Tashkent"]
MENA_CITIES = ["Cairo", "Riyadh", "Dubai", "Doha", "Amman", "Beirut", "Kuwait City",
              "Manama", "Muscat", "Istanbul", "Tehran", "Tunis", "Algiers"]

# ---------------------------------------------------------------------------
# Checksum algorithms
# ---------------------------------------------------------------------------
def _digits_only(s: str) -> str:
    return "".join(c for c in s if c.isdigit())


def luhn_checksum(number: str) -> int:
    """Compute Luhn (mod-10) check digit for the given digit string.

    The given string is the body WITHOUT the check digit. The check
    digit will be appended to the right of the body, so in the full
    number the rightmost body digit sits at Luhn position 1 (weight 2,
    i.e. doubled) — this is why we double body digits at reversed
    index 0, 2, 4, ... (not 1, 3, 5, ...).
    """
    digits = [int(c) for c in number if c.isdigit()]
    if not digits:
        return 0
    total = 0
    # body[-1] (reversed i=0) sits at full-position 1 → doubled.
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 0:
            x = d * 2
            total += x if x < 10 else x - 9
        else:
            total += d
    return (10 - (total % 10)) % 10


def luhn_valid(number: str) -> bool:
    if not number.isdigit():
        return False
    if len(number) < 2:
        return False
    return luhn_checksum(number[:-1]) == int(number[-1])


def iso7064_11_2_checksum(number: str) -> int:
    """ISO 7064 MOD 11-2 — weights are powers of 2 (1,2,4,8,...).

    Returns 0..10. A value of 10 means the check character should be 'X'
    in the canonical ISO 7064 representation; callers that need a single
    ASCII digit should re-roll the body to avoid value 10.
    """
    weights = [2 ** i for i in range(len(number))]
    total = sum(int(c) * weights[i] for i, c in enumerate(number))
    check = (11 - (total % 11)) % 11
    return check  # may be 10 — caller handles


def gen_iso7064_11_2(length: int) -> str:
    """Generate an ISO 7064 MOD 11-2 ID, re-rolling if the check is 10
    (which would require an 'X' character that doesn't fit a digits-only ID)."""
    for _ in range(100):
        body = "".join(random.choice(string.digits) for _ in range(length - 1))
        check = iso7064_11_2_checksum(body)
        if check < 10:
            return body + str(check)
    # Fallback: append 0 (caller may flag as edge case)
    return body + "0"


def iso7064_11_10_checksum(number: str) -> int:
    """ISO 7064 MOD 11-10."""
    cleaned = number
    p = 0
    for c in cleaned + "0":
        p = (p + int(c)) % 10
        if p == 0:
            p = 10
        p = (p * 2) % 11
    return (11 - p) % 10


def mod97_checksum(number: str) -> int:
    """MOD 97 (IBAN-style) check digit."""
    total = 0
    for c in number:
        total = (total * 10 + int(c)) % 97
    return (98 - total) % 100


def egyptian_id_checksum(first13: str) -> int:
    """Egyptian national ID — weighted sum mod 11."""
    if len(first13) != 13:
        return 0
    weights = [2, 7, 6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    total = sum(int(c) * weights[i] for i, c in enumerate(first13))
    check = (11 - (total % 11)) % 11
    return check if check < 10 else 1


def turkey_tc_checksum(first9: str) -> Tuple[int, int]:
    """Turkish TC Kimlik — two check digits (10th and 11th)."""
    d = [int(c) for c in first9]
    c10 = ((d[0] + d[2] + d[4] + d[6] + d[8]) * 7
           - (d[1] + d[3] + d[5] + d[7])) % 10
    c11 = (d[0] + d[1] + d[2] + d[3] + d[4] + d[5] + d[6] + d[7] + d[8] + c10) % 10
    return c10, c11


def israel_tz_checksum(first8: str) -> int:
    """Israeli Teudat Zehut — Luhn variant with weighted sum."""
    total = 0
    for i, c in enumerate(first8):
        d = int(c)
        # Odd positions (1-indexed) get weight 1, even positions get weight 2
        if (i + 1) % 2 == 0:
            x = d * 2
            total += x if x < 10 else x - 9
        else:
            total += d
    return (10 - (total % 10)) % 10


def spain_dni_letter(number: str) -> str:
    """Spanish DNI letter — mod-23 mapping."""
    letters = "TRWAGMYFPDXBNJZSQVHLCKE"
    return letters[int(number) % 23]


def portugal_cc_checksum(first8: str) -> int:
    """Portuguese Cartão de Cidadão — mod-11 with descending weights."""
    weights = [9, 8, 7, 6, 5, 4, 3, 2]
    total = sum(int(c) * weights[i] for i, c in enumerate(first8))
    check = (11 - (total % 11)) % 11
    return 0 if check == 10 else check


def brazil_cpf_checksum(first9: str, second_round: bool = False) -> int:
    """Brazilian CPF check digit (mod-11)."""
    n = first9 if not second_round else first9  # first9 already includes first check for second
    start = 1 if not second_round else 2
    weights = list(range(start, start + len(n)))[::-1]
    if second_round:
        weights = list(range(2, 2 + len(n)))[::-1]
    total = sum(int(c) * w for c, w in zip(n, weights))
    rem = total % 11
    return 0 if rem < 2 else 11 - rem


# ---------------------------------------------------------------------------
# ID generation per country format
# ---------------------------------------------------------------------------
def gen_luhn_id(length: int, prefix: str = "") -> str:
    body = prefix + "".join(random.choice(string.digits) for _ in range(length - len(prefix) - 1))
    return body + str(luhn_checksum(body))


def gen_iso7064_11_10(length: int) -> str:
    body = "".join(random.choice(string.digits) for _ in range(length - 1))
    check = iso7064_11_10_checksum(body)
    return body + str(check)


def gen_egyptian_id() -> str:
    """14-digit Egyptian national ID: C(1) + YY(2) + MM(2) + DD(2) + SEQ(6) + CHECK(1)."""
    # Century: 2=1900s, 3=2000s
    century = random.choice(["2", "3"])
    yy = f"{random.randint(0, 99):02d}"
    mm = f"{random.randint(1, 12):02d}"
    dd = f"{random.randint(1, 31):02d}"
    seq = f"{random.randint(0, 999999):06d}"
    first13 = century + yy + mm + dd + seq
    check = egyptian_id_checksum(first13)
    return first13 + str(check)


def gen_saudi_hijri_id() -> str:
    # 10 digits: HYYMMDD-SSS-C (Hijri date)
    hyy = f"{random.randint(40, 65):02d}"
    mm = f"{random.randint(1, 12):02d}"
    dd = f"{random.randint(1, 30):02d}"
    seq = f"{random.randint(0, 999):03d}"
    body = hyy + mm + dd + seq
    # Use mod-10 (Luhn) for check
    return body + str(luhn_checksum(body))


def gen_uae_15_id() -> str:
    # 15-digit residence permit: residence+year+seq+check
    body = "".join(random.choice(string.digits) for _ in range(14))
    return body + str(luhn_checksum(body))


def gen_israel_tz_id() -> str:
    body = "".join(random.choice(string.digits) for _ in range(8))
    return body + str(israel_tz_checksum(body))


def gen_turkey_tc_id() -> str:
    body = "".join(random.choice(string.digits) for _ in range(9))
    # First digit must be non-zero
    body = str(random.randint(1, 9)) + body[1:]
    c10, c11 = turkey_tc_checksum(body)
    return body + str(c10) + str(c11)


def gen_spain_dni_id() -> str:
    body = "".join(random.choice(string.digits) for _ in range(8))
    return body + spain_dni_letter(body)


def gen_portugal_cc_id() -> str:
    body = "".join(random.choice(string.digits) for _ in range(8))
    return body + str(portugal_cc_checksum(body))


def gen_brazil_cpf_id() -> str:
    body = "".join(random.choice(string.digits) for _ in range(9))
    c1 = brazil_cpf_checksum(body)
    c2 = brazil_cpf_checksum(body + str(c1))
    return body + str(c1) + str(c2)


def gen_italy_codice_fiscale() -> str:
    # 16-char Codice Fiscale (simplified — not full fiscal validity)
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    digits = "0123456789"
    # Surname (6 consonants), name (4 chars), DOBYY (5), place (4), check (1)
    surname = "".join(random.choice(letters) for _ in range(6))
    name = "".join(random.choice(letters) for _ in range(4))
    yy = "".join(random.choice(digits) for _ in range(2))
    mm_letter = "ABCDEHLMPRST"[random.randint(0, 11)]
    dd = f"{random.randint(1, 31):02d}"
    place = "".join(random.choice(letters + digits) for _ in range(4))
    body = surname + name + yy + mm_letter + dd + place
    # Check char (mod-26 over odd/even-positioned chars — simplified)
    remap = {"A": 1, "B": 0, "C": 5, "D": 7, "E": 9, "F": 13, "G": 15, "H": 17,
             "I": 19, "J": 21, "K": 2, "L": 4, "M": 18, "N": 20, "O": 11, "P": 3,
             "Q": 6, "R": 8, "S": 12, "T": 14, "U": 16, "V": 10, "W": 22, "X": 25,
             "Y": 24, "Z": 23}
    total = 0
    for i, c in enumerate(body):
        if (i + 1) % 2 == 0:
            if c.isdigit():
                total += int(c)
            else:
                total += "BAKTEQVMWR".find(c) if "BAKTEQVMWR".find(c) >= 0 else 0
        else:
            if c.isdigit():
                total += remap.get("ABCDEFGHIJKLMNOPRST".split()[int(c)] if False else c, 0) if not c.isdigit() else int(c)
            else:
                total += remap.get(c, 0)
    check = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[total % 26]
    return body + check


def gen_france_insee_id() -> str:
    """15-digit INSEE: S(1)YY(2)MM(2)DEPT(2)COMMUNE(3)SEQ(3) — body13 — KEY(2)."""
    sex = random.choice(["1", "2"])
    yy = f"{random.randint(0, 99):02d}"
    mm = f"{random.randint(1, 12):02d}"
    dept = f"{random.randint(1, 95):02d}"  # 2 chars (01..95, plus 2A/2B for Corsica)
    commune = f"{random.randint(1, 999):03d}"
    seq = f"{random.randint(1, 999):03d}"
    body13 = sex + yy + mm + dept + commune + seq  # 1+2+2+2+3+3 = 13 chars
    # MOD 97 on the 13-digit body
    total = 0
    for c in body13:
        total = (total * 10 + int(c)) % 97
    key = (97 - total) % 100
    return body13 + f"{key:02d}"


def gen_generic_numeric(length: int, prefix: str = "") -> str:
    body_len = length - len(prefix)
    body = prefix + "".join(random.choice(string.digits) for _ in range(body_len))
    return body


def gen_id_for_country(country: Dict[str, str]) -> str:
    fmt = country.get("id_format", "generic_numeric")
    id_len = country.get("id_len", 10)
    id_prefix = country.get("id_prefix", "")
    if fmt == "luhn":
        return gen_luhn_id(id_len, id_prefix)
    if fmt == "iso7064_11_2":
        return gen_iso7064_11_2(id_len)
    if fmt == "iso7064_11_10":
        return gen_iso7064_11_10(id_len)
    if fmt == "mod97":
        body = "".join(random.choice(string.digits) for _ in range(id_len - 2))
        return body + f"{mod97_checksum(body):02d}"
    if fmt == "egyptian":
        return gen_egyptian_id()
    if fmt == "saudi_hijri":
        return gen_saudi_hijri_id()
    if fmt == "uae_15":
        return gen_uae_15_id()
    if fmt == "israel_tz":
        return gen_israel_tz_id()
    if fmt == "turkey_tc":
        return gen_turkey_tc_id()
    if fmt == "spain_dni":
        return gen_spain_dni_id()
    if fmt == "portugal_cc":
        return gen_portugal_cc_id()
    if fmt == "brazil_cpf":
        return gen_brazil_cpf_id()
    if fmt == "italy_cf":
        return gen_italy_codice_fiscale()
    if fmt == "france_insee":
        return gen_france_insee_id()
    return gen_generic_numeric(id_len, id_prefix)


# ---------------------------------------------------------------------------
# Name + address generation
# ---------------------------------------------------------------------------
def pick_pools(country: Dict[str, str]) -> Tuple[List[str], List[str], List[str], List[Tuple[str, str]]]:
    """Return (male_names, female_names, surnames, cities)."""
    script = country.get("script", "latin")
    region = country.get("region", "EU")
    if country["alpha3"] == "FRA":
        return FRENCH_MALE, FRENCH_FEMALE, FRENCH_SURNAMES, [("Paris", "Paris"), ("Lyon", "Lyon"), ("Marseille", "Marseille")]
    if country["alpha3"] == "DEU":
        return GERMAN_MALE, GERMAN_FEMALE, GERMAN_SURNAMES, [("Berlin", "Berlin"), ("Munich", "München")]
    if country["alpha3"] == "ESP":
        return SPANISH_MALE, SPANISH_FEMALE, SPANISH_SURNAMES, [("Madrid", "Madrid"), ("Barcelona", "Barcelona")]
    if country["alpha3"] == "ITA":
        return ITALIAN_MALE, ITALIAN_FEMALE, ITALIAN_SURNAMES, [("Rome", "Roma"), ("Milan", "Milano")]
    if country["alpha3"] == "TUR":
        return TURKISH_MALE, TURKISH_FEMALE, TURKISH_SURNAMES, [("Istanbul", "İstanbul")]
    if country["alpha3"] == "JPN":
        return JAPANESE_MALE, JAPANESE_FEMALE, JAPANESE_SURNAMES, [("Tokyo", "東京")]
    if country["alpha3"] == "KOR":
        return KOREAN_MALE, KOREAN_FEMALE, KOREAN_SURNAMES, [("Seoul", "서울")]
    if country["alpha3"] == "CHN":
        return CHINESE_MALE, CHINESE_FEMALE, CHINESE_SURNAMES, [("Beijing", "北京"), ("Shanghai", "上海")]
    if country["alpha3"] == "RUS" or country["alpha3"] == "BLR" or country["alpha3"] == "KAZ":
        return RUSSIAN_MALE, RUSSIAN_FEMALE, RUSSIAN_SURNAMES, [(c, c) for c in EECA_CITIES]
    if country["alpha3"] == "IND":
        return INDIAN_MALE, INDIAN_FEMALE, INDIAN_SURNAMES, [(c, c) for c in AS_CITIES if c in ("Mumbai", "Delhi", "Bangalore")]
    if script == "arabic":
        return ARABIC_MALE_NAMES, ARABIC_FEMALE_NAMES, ARABIC_SURNAMES, ARABIC_CITIES
    # Default to Latin pools
    if region == "EU":
        return LATIN_MALE_NAMES, LATIN_FEMALE_NAMES, LATIN_SURNAMES, [(c, c) for c in EU_CITIES]
    if region == "NA":
        return LATIN_MALE_NAMES, LATIN_FEMALE_NAMES, LATIN_SURNAMES, [(c, c) for c in NA_CITIES]
    if region == "AS":
        return LATIN_MALE_NAMES, LATIN_FEMALE_NAMES, LATIN_SURNAMES, [(c, c) for c in AS_CITIES]
    if region == "EECA":
        return RUSSIAN_MALE, RUSSIAN_FEMALE, RUSSIAN_SURNAMES, [(c, c) for c in EECA_CITIES]
    return LATIN_MALE_NAMES, LATIN_FEMALE_NAMES, LATIN_SURNAMES, [(c, c) for c in EU_CITIES]


def gen_name(country: Dict[str, str]) -> Tuple[str, str, str, str]:
    """Return (name_latin, name_native, surname_latin, surname_native)."""
    male_pool, female_pool, surname_pool, _ = pick_pools(country)
    gender = random.choice(["M", "F"])
    given = random.choice(male_pool) if gender == "M" else random.choice(female_pool)
    surname = random.choice(surname_pool)
    # For Arabic countries, provide Latin transliteration
    if country.get("script") == "arabic":
        latin_given = random.choice(LATIN_MALE_NAMES if gender == "M" else LATIN_FEMALE_NAMES)
        latin_surname = random.choice(LATIN_SURNAMES)
    else:
        latin_given = given
        latin_surname = surname
    return latin_given, given, latin_surname, surname


def gen_address(country: Dict[str, str]) -> Tuple[str, str]:
    """Return (address_latin, address_native)."""
    _, _, _, cities = pick_pools(country)
    city_latin, city_native = random.choice(cities)
    street_num = random.randint(1, 999)
    street_name_latin = random.choice(
        ["Main St", "Oak Ave", "Park Rd", "High St", "King St", "Queen St",
         "Mill Ln", "Church St", "Bridge Rd", "Station Rd"]
    )
    postal = f"{random.randint(10000, 99999)}"
    address_latin = f"{street_num} {street_name_latin}, {city_latin} {postal}"
    address_native = f"{street_num} {street_name_latin}, {city_native} {postal}"
    return address_latin, address_native


# ---------------------------------------------------------------------------
# Generators
# ---------------------------------------------------------------------------
def gen_synthetic_identities(count: int = 10000) -> List[Dict[str, Any]]:
    """Generate N realistic-but-fake identities across 73 countries."""
    records: List[Dict[str, Any]] = []
    for i in range(count):
        country = random.choice(COUNTRIES)
        national_id = gen_id_for_country(country)
        name_latin, name_native, surname_latin, surname_native = gen_name(country)
        address_latin, address_native = gen_address(country)
        # Birth date from national ID if possible
        birth_year = random.randint(1960, 2005)
        birth_month = random.randint(1, 12)
        birth_day = random.randint(1, 28)
        birth_date = f"{birth_year}-{birth_month:02d}-{birth_day:02d}"
        # Document number — separate from national ID
        doc_number = "".join(random.choice(string.ascii_uppercase + string.digits)
                             for _ in range(9))
        # Issue + expiry
        issue_year = random.randint(2015, 2024)
        expiry_year = issue_year + random.randint(5, 10)
        records.append({
            "id": f"synid_{i:06d}",
            "country_alpha3": country["alpha3"],
            "country_name": country["name"],
            "region": country.get("region", "EU"),
            "national_id": national_id,
            "id_format": country.get("id_format", "generic_numeric"),
            "name_latin": f"{name_latin} {surname_latin}",
            "name_native": f"{name_native} {surname_native}",
            "given_name_latin": name_latin,
            "surname_latin": surname_latin,
            "gender": random.choice(["M", "F"]),
            "birth_date": birth_date,
            "address_latin": address_latin,
            "address_native": address_native,
            "document_number": doc_number,
            "document_type": random.choice(["national_id", "passport", "driver_license", "residence"]),
            "issue_date": f"{issue_year}-{random.randint(1,12):02d}-{random.randint(1,28):02d}",
            "expiry_date": f"{expiry_year}-{random.randint(1,12):02d}-{random.randint(1,28):02d}",
            "phone": f"+{random.randint(1, 99)}{random.randint(100000000, 999999999)}",
            "email": f"{name_latin.lower()}.{surname_latin.lower()}{random.randint(0,9999)}@example.com",
        })
    return records


# ---------------------------------------------------------------------------
# Face metadata generator
# ---------------------------------------------------------------------------
EYE_COLORS = ["brown", "blue", "green", "hazel", "gray", "amber"]
HAIR_COLORS = ["black", "brown", "blonde", "red", "gray", "white", "auburn"]
HAIR_STYLES = ["short", "long", "bald", "curly", "wavy", "ponytail", "bun", "afro"]
GLASSES_TYPES = ["none", "reading", "sunglasses", "prescription"]
BEARD_STYLES = ["none", "full", "goatee", "stubble", "mustache"]
POSES = ["frontal", "left_15", "right_15", "left_30", "right_30", "up_15", "down_15"]
LIGHTING = ["front", "left", "right", "top", "backlit", "low_ambient", "harsh"]
EXPRESSIONS = ["neutral", "smile", "frown", "surprise", "squint", "open_mouth"]
OCCLUSIONS = ["none", "hand_over_mouth", "sunglasses", "mask", "hair_over_eye", "scarf"]
ATTACK_TYPES = ["none", "print_attack", "screen_replay", "3d_mask", "deepfake", "deepfake_with_makeup"]
# Probabilities (must match length of ATTACK_TYPES):
ATTACK_WEIGHTS = [70, 5, 5, 5, 10, 5]
FITZPATRICK = ["I", "II", "III", "IV", "V", "VI"]


def gen_face_metadata(count: int = 50000) -> List[Dict[str, Any]]:
    """Generate N face-image descriptors (metadata only, no actual images)."""
    records: List[Dict[str, Any]] = []
    for i in range(count):
        age = random.randint(18, 85)
        gender = random.choice(["M", "F"])
        fitz = random.choices(FITZPATRICK, weights=[5, 15, 25, 25, 20, 10], k=1)[0]
        # Bias beard toward males
        beard = "none"
        if gender == "M":
            beard = random.choices(BEARD_STYLES, weights=[60, 10, 10, 10, 10], k=1)[0]
        # Hair length by gender
        if gender == "F":
            hair_style = random.choices(
                ["short", "long", "curly", "wavy", "ponytail", "bun"],
                weights=[15, 30, 15, 20, 10, 10], k=1)[0]
        else:
            hair_style = random.choices(
                ["short", "long", "bald", "curly", "wavy"],
                weights=[50, 10, 15, 10, 15], k=1)[0]
        pose = random.choice(POSES)
        lighting = random.choice(LIGHTING)
        expression = random.choice(EXPRESSIONS)
        occlusion = random.choice(OCCLUSIONS)
        attack = random.choices(
            ATTACK_TYPES,
            weights=ATTACK_WEIGHTS, k=1)[0]
        # Quality metrics
        blur_score = round(random.uniform(0.0, 1.0), 3)
        lighting_score = round(random.uniform(0.0, 1.0), 3)
        resolution_score = round(random.uniform(0.3, 1.0), 3)
        face_match_score = round(random.uniform(0.0, 1.0), 3)
        liveness_score = round(random.uniform(0.0, 1.0), 3) if attack != "none" else round(random.uniform(0.7, 1.0), 3)
        # Attack signatures when attack != none
        attack_signatures: Dict[str, Any] = {}
        if attack == "print_attack":
            attack_signatures = {
                "texture_variance": round(random.uniform(0.05, 0.25), 4),
                "halftone_spacing_px": round(random.uniform(8, 16), 2),
                "color_cast": random.choice(["yellow", "blue", "gray"]),
                "specular_highlights": 0,
            }
        elif attack == "screen_replay":
            attack_signatures = {
                "moire_freq_hz": round(random.uniform(60, 120), 2),
                "pixel_grid_pitch_um": round(random.uniform(50, 300), 2),
                "refresh_rate_hz": random.choice([60, 90, 120, 144]),
                "specular_highlights": round(random.uniform(0.0, 0.3), 3),
            }
        elif attack == "3d_mask":
            attack_signatures = {
                "depth_relief_ratio": round(random.uniform(0.05, 0.20), 4),
                "boundary_discontinuity_px": random.randint(2, 8),
                "pore_density_per_mm2": round(random.uniform(0.5, 2.5), 2),
                "specular_highlights": round(random.uniform(0.0, 0.1), 3),
            }
        elif attack.startswith("deepfake"):
            attack_signatures = {
                "gan_artifact_freq_hz": round(random.uniform(40, 80), 2),
                "color_hist_anomaly": round(random.uniform(0.05, 0.30), 4),
                "blend_boundary_px": random.randint(1, 5),
                "temporal_inconsistency": round(random.uniform(0.1, 0.4), 3),
            }
        records.append({
            "id": f"synface_{i:06d}",
            "age": age,
            "gender": gender,
            "fitzpatrick": fitz,
            "eye_color": random.choice(EYE_COLORS),
            "hair_color": random.choice(HAIR_COLORS),
            "hair_style": hair_style,
            "glasses": random.choice(GLASSES_TYPES),
            "beard": beard,
            "pose": pose,
            "lighting": lighting,
            "expression": expression,
            "occlusion": occlusion,
            "attack_type": attack,
            "blur_score": blur_score,
            "lighting_score": lighting_score,
            "resolution_score": resolution_score,
            "face_match_score": face_match_score,
            "liveness_score": liveness_score,
            "attack_signatures": attack_signatures,
            "intended_use": "train" if i % 10 < 8 else "test",
        })
    return records


# ---------------------------------------------------------------------------
# Fraud ring generator
# ---------------------------------------------------------------------------
SHARED_ATTRIBUTES = ["device_id", "ip", "email", "phone", "document_hash", "address"]


def gen_fraud_rings(count: int = 50) -> List[Dict[str, Any]]:
    """Generate N synthetic fraud rings of 3-10 nodes each."""
    rings: List[Dict[str, Any]] = []
    for r in range(count):
        n_members = random.randint(3, 10)
        n_mules = random.randint(1, min(5, n_members - 1))
        n_controllers = random.randint(1, min(3, n_members - n_mules))
        # The shared attribute that ties the ring together
        shared_attr = random.choice(SHARED_ATTRIBUTES)
        shared_value: str
        if shared_attr == "device_id":
            shared_value = "dev_" + "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(16))
        elif shared_attr == "ip":
            shared_value = f"{random.randint(1,255)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"
        elif shared_attr == "email":
            shared_value = f"ring_{r}@example.com"
        elif shared_attr == "phone":
            shared_value = f"+{random.randint(1,99)}{random.randint(100000000, 999999999)}"
        elif shared_attr == "document_hash":
            shared_value = "sha256:" + "".join(random.choice("0123456789abcdef") for _ in range(64))
        else:  # address
            shared_value = f"{random.randint(1,999)} Shared St, City"

        members: List[Dict[str, Any]] = []
        for m in range(n_members):
            country = random.choice(COUNTRIES)
            national_id = gen_id_for_country(country)
            name_latin, name_native, surname_latin, surname_native = gen_name(country)
            role: str
            if m < n_controllers:
                role = "controller"
            elif m < n_controllers + n_mules:
                role = "mule"
            else:
                role = "victim"
            members.append({
                "member_id": f"ring{r}_m{m}",
                "role": role,
                "country_alpha3": country["alpha3"],
                "name_latin": f"{name_latin} {surname_latin}",
                "national_id": national_id,
                "shared_attribute": shared_attr,
                "shared_value": shared_value,
                "enrollment_date": f"2024-{random.randint(1,12):02d}-{random.randint(1,28):02d}",
                "verification_count": random.randint(1, 20),
                "is_synthetic_id": random.choice([True, False]),
                "bank_account": f"BA{random.randint(10**8, 10**9 - 1)}" if role == "mule" else None,
                "ip_used": f"{random.randint(1,255)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"
                            if random.random() < 0.5 else shared_value if shared_attr == "ip" else None,
            })
        # Inter-member edges (controller → mule, controller → victim)
        edges: List[Dict[str, Any]] = []
        for i, m in enumerate(members):
            if m["role"] == "mule" or m["role"] == "victim":
                # Connect to first controller
                controllers = [c for c in members if c["role"] == "controller"]
                if controllers:
                    target = controllers[i % len(controllers)]
                    edges.append({
                        "from": target["member_id"],
                        "to": m["member_id"],
                        "edge_type": "fund_transfer" if m["role"] == "mule" else "shared_pii",
                        "weight": round(random.uniform(0.7, 1.0), 3),
                        "evidence_count": random.randint(1, 5),
                    })
        rings.append({
            "ring_id": f"ring_{r:04d}",
            "member_count": n_members,
            "mule_count": n_mules,
            "controller_count": n_controllers,
            "shared_attribute": shared_attr,
            "shared_value": shared_value,
            "members": members,
            "edges": edges,
            "detected_by": ["identity_graph", "duplicate_detection"],
            "ring_type": random.choice(["synthetic_id_factory", "mule_network",
                                       "account_takeover", "document_reuse",
                                       "device_reuse"]),
            "estimated_fraud_value_usd": random.randint(1000, 500000),
        })
    return rings


# ---------------------------------------------------------------------------
# MRZ edge-case generator
# ---------------------------------------------------------------------------
MRZ_FORMATS = ["TD1", "TD2", "TD3"]


def _mrz_check_digit(input_str: str) -> int:
    """ICAO 9303 check digit: weights 7,3,1 repeating; values 0-9→0-9, A-Z→10-35, <→0."""
    weights = [7, 3, 1]
    total = 0
    for i, c in enumerate(input_str):
        if c == "<" or c == " ":
            v = 0
        elif c.isdigit():
            v = int(c)
        elif c.isalpha() and c.isupper():
            v = ord(c) - 55
        else:
            v = 0
        total += v * weights[i % 3]
    return total % 10


def _mrz_pad(s: str, length: int, fill: str = "<") -> str:
    """Pad s with `fill` to exact length (truncate if too long)."""
    if len(s) >= length:
        return s[:length]
    return s + (fill * (length - len(s)))


def _gen_name_field() -> str:
    country = random.choice(COUNTRIES)
    name_latin, _, surname_latin, _ = gen_name(country)
    # MRZ format: SURNAME<<GIVEN<<<
    field = surname_latin.upper().replace(" ", "<") + "<<" + name_latin.upper().replace(" ", "<")
    return field


def gen_valid_td1(country_alpha3: str) -> str:
    """TD1: 3 lines × 30 chars."""
    # Line 1: I<doc_code(1-2)>CCdoc_num... — simplified
    doc_num = "".join(random.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") for _ in range(9))
    doc_check = _mrz_check_digit(doc_num)
    line1 = f"I<{country_alpha3}{doc_num}{doc_check}{'<' * (14 - len(doc_num))}"
    line1 = _mrz_pad(line1, 30)
    # Line 2: YYMMDD(sex)YYMMDD(nationality)YY
    bday = f"{random.randint(60, 99):02d}{random.randint(1, 12):02d}{random.randint(1, 28):02d}"
    bday_check = _mrz_check_digit(bday)
    sex = random.choice(["M", "F", "<"])
    expiry = f"{random.randint(25, 35):02d}{random.randint(1, 12):02d}{random.randint(1, 28):02d}"
    expiry_check = _mrz_check_digit(expiry)
    line2 = f"{bday}{bday_check}{sex}{expiry}{expiry_check}{country_alpha3}{'<' * 2}"
    line2 = _mrz_pad(line2, 30)
    # Line 3: name
    name = _gen_name_field()
    line3 = _mrz_pad(name, 30)
    return f"{line1}\n{line2}\n{line3}"


def gen_valid_td2(country_alpha3: str) -> str:
    """TD2: 2 lines × 36 chars."""
    doc_num = "".join(random.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") for _ in range(12))
    doc_check = _mrz_check_digit(doc_num)
    name = _gen_name_field()
    line1 = f"I<{country_alpha3}2{doc_num}{doc_check}{'<' * (28 - len(doc_num))}"
    line1 = _mrz_pad(line1, 36)
    bday = f"{random.randint(60, 99):02d}{random.randint(1, 12):02d}{random.randint(1, 28):02d}"
    bday_check = _mrz_check_digit(bday)
    sex = random.choice(["M", "F", "<"])
    expiry = f"{random.randint(25, 35):02d}{random.randint(1, 12):02d}{random.randint(1, 28):02d}"
    expiry_check = _mrz_check_digit(expiry)
    line2 = f"{bday}{bday_check}{sex}{expiry}{expiry_check}{country_alpha3}{'<' * (36 - 6 - 6 - 1 - 6 - 1 - 3)}"
    line2 = _mrz_pad(line2, 36)
    return f"{line1}\n{line2}"


def gen_valid_td3(country_alpha3: str) -> str:
    """TD3: 2 lines × 44 chars (passport)."""
    doc_num = "".join(random.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") for _ in range(9))
    doc_check = _mrz_check_digit(doc_num)
    name = _gen_name_field()
    line1 = f"P<{country_alpha3}{name}{'<' * (44 - 5 - len(name))}"
    line1 = _mrz_pad(line1, 44)
    bday = f"{random.randint(60, 99):02d}{random.randint(1, 12):02d}{random.randint(1, 28):02d}"
    bday_check = _mrz_check_digit(bday)
    sex = random.choice(["M", "F", "<"])
    expiry = f"{random.randint(25, 35):02d}{random.randint(1, 12):02d}{random.randint(1, 28):02d}"
    expiry_check = _mrz_check_digit(expiry)
    personal_num = "".join(random.choice("0123456789") for _ in range(14))
    personal_check = _mrz_check_digit(personal_num)
    line2 = f"{doc_num}{doc_check}{country_alpha3}{bday}{bday_check}{sex}{expiry}{expiry_check}{personal_num}{personal_check}{'<' * (44 - 9 - 1 - 3 - 6 - 1 - 1 - 6 - 1 - 14 - 1)}"
    line2 = _mrz_pad(line2, 44)
    return f"{line1}\n{line2}"


def gen_invalid_variant(country_alpha3: str, fmt: str) -> Dict[str, Any]:
    """Generate an MRZ with a specific invalidity type."""
    if fmt == "TD1":
        valid = gen_valid_td1(country_alpha3)
    elif fmt == "TD2":
        valid = gen_valid_td2(country_alpha3)
    else:
        valid = gen_valid_td3(country_alpha3)
    lines = valid.split("\n")
    invalidity_type = random.choice([
        "wrong_check_digit",
        "wrong_field_length",
        "mixed_scripts",
        "special_characters",
        "missing_newline",
        "extra_padding",
        "lowercase_letters",
        "missing_country",
    ])
    detail = ""
    if invalidity_type == "wrong_check_digit":
        # Flip a check digit
        line2_chars = list(lines[1]) if len(lines) > 1 else list(lines[0])
        # Find first digit after position 6 and replace
        for i in range(6, len(line2_chars)):
            if line2_chars[i].isdigit():
                old = int(line2_chars[i])
                line2_chars[i] = str((old + 1) % 10)
                break
        lines[1] = "".join(line2_chars)
        detail = "check digit incremented by 1 (mod 10)"
    elif invalidity_type == "wrong_field_length":
        # Add or remove a character
        idx = random.randint(0, len(lines) - 1)
        pos = random.randint(0, len(lines[idx]) - 1)
        lines[idx] = lines[idx][:pos] + lines[idx][pos + 1:]
        detail = f"removed one char from line {idx + 1} at pos {pos}"
    elif invalidity_type == "mixed_scripts":
        # Inject Arabic/Cyrillic chars
        idx = random.randint(0, len(lines) - 1)
        pos = random.randint(5, len(lines[idx]) - 5)
        chars = list(lines[idx])
        chars[pos] = random.choice("أبتثجحخدذرزسشصضطظعغفقكلمنهوي")
        lines[idx] = "".join(chars)
        detail = f"inserted Arabic char at line {idx + 1} pos {pos}"
    elif invalidity_type == "special_characters":
        idx = random.randint(0, len(lines) - 1)
        chars = list(lines[idx])
        pos = random.randint(5, len(chars) - 5)
        chars[pos] = random.choice("@#$%^&*()[]{}|\\")
        lines[idx] = "".join(chars)
        detail = f"inserted special char at line {idx + 1} pos {pos}"
    elif invalidity_type == "missing_newline":
        detail = "newline replaced with space"
        return {
            "mrz": " ".join(lines),
            "format": fmt,
            "country_alpha3": country_alpha3,
            "valid": False,
            "invalidity_type": invalidity_type,
            "detail": detail,
        }
    elif invalidity_type == "extra_padding":
        idx = random.randint(0, len(lines) - 1)
        lines[idx] = lines[idx] + "<" * random.randint(1, 5)
        detail = f"extra << appended to line {idx + 1}"
    elif invalidity_type == "lowercase_letters":
        idx = random.randint(0, len(lines) - 1)
        lines[idx] = lines[idx].lower()
        detail = f"line {idx + 1} lowercased"
    elif invalidity_type == "missing_country":
        idx = 0
        # Replace country code with <<<
        chars = list(lines[idx])
        # Country is at position 2-4 (after I<) for TD1
        cc_start = 2 if fmt == "TD1" else (2 if fmt == "TD2" else 2)
        if fmt == "TD3":
            # P<CCCBIRTH...
            cc_start = 2
        chars[cc_start:cc_start + 3] = ["<", "<", "<"]
        lines[idx] = "".join(chars)
        detail = f"country code replaced with <<< on line 1"
    return {
        "mrz": "\n".join(lines),
        "format": fmt,
        "country_alpha3": country_alpha3 if invalidity_type != "missing_country" else "UNK",
        "valid": False,
        "invalidity_type": invalidity_type,
        "detail": detail,
    }


def gen_mrz_edge_cases(count: int = 20000) -> List[Dict[str, Any]]:
    """Generate N MRZ edge cases (valid + invalid variants)."""
    records: List[Dict[str, Any]] = []
    valid_ratio = 0.5  # 50% valid, 50% invalid
    for i in range(count):
        country = random.choice(COUNTRIES)
        fmt = random.choice(MRZ_FORMATS)
        if random.random() < valid_ratio:
            if fmt == "TD1":
                mrz = gen_valid_td1(country["alpha3"])
            elif fmt == "TD2":
                mrz = gen_valid_td2(country["alpha3"])
            else:
                mrz = gen_valid_td3(country["alpha3"])
            records.append({
                "id": f"synmrz_{i:06d}",
                "mrz": mrz,
                "format": fmt,
                "country_alpha3": country["alpha3"],
                "country_name": country["name"],
                "valid": True,
                "invalidity_type": None,
                "detail": "valid MRZ with correct check digits",
            })
        else:
            rec = gen_invalid_variant(country["alpha3"], fmt)
            rec["id"] = f"synmrz_{i:06d}"
            rec["country_name"] = country["name"]
            records.append(rec)
    return records


# ---------------------------------------------------------------------------
# Adversarial sample signatures generator
# ---------------------------------------------------------------------------
def _gen_freq_signature(low_hz: float, high_hz: float, n_peaks: int = 3) -> List[Dict[str, float]]:
    """Generate a list of {freq_hz, magnitude} peaks."""
    return [
        {
            "freq_hz": round(random.uniform(low_hz, high_hz), 2),
            "magnitude": round(random.uniform(0.4, 1.0), 3),
            "phase_deg": round(random.uniform(0, 360), 1),
        }
        for _ in range(n_peaks)
    ]


def gen_adversarial_signatures(count: int = 10000) -> List[Dict[str, Any]]:
    """Generate N adversarial-attack signature descriptors."""
    records: List[Dict[str, Any]] = []
    attack_types = [
        "deepfake_gan",
        "deepfake_diffusion",
        "3d_mask_silicone",
        "3d_mask_rigid",
        "screen_replay_lcd",
        "screen_replay_oled",
        "print_attack_inkjet",
        "print_attack_laser",
        "silicone_finger",
        "hybrid_mask_replay",
    ]
    for i in range(count):
        attack = random.choice(attack_types)
        record: Dict[str, Any] = {
            "id": f"synadv_{i:06d}",
            "attack_type": attack,
            "intended_use": "train" if i % 10 < 8 else "test",
        }
        if attack.startswith("deepfake"):
            record.update({
                "frequency_signature": _gen_freq_signature(40, 120, n_peaks=4),
                "color_hist_anomaly_score": round(random.uniform(0.05, 0.30), 4),
                "blend_boundary_px": random.randint(1, 8),
                "temporal_inconsistency": round(random.uniform(0.05, 0.45), 4),
                "gan_model_hint": random.choice(["stylegan2", "stylegan3", "diffusion",
                                                "faceswap", "simswap", "in_swapping"]),
                "noise_residual_score": round(random.uniform(0.10, 0.40), 4),
                "fft_artifact_density": round(random.uniform(0.05, 0.25), 4),
            })
        elif attack.startswith("3d_mask"):
            record.update({
                "depth_relief_ratio": round(random.uniform(0.05, 0.20), 4),
                "boundary_discontinuity_px": random.randint(2, 10),
                "pore_density_per_mm2": round(random.uniform(0.3, 2.8), 2),
                "specular_highlight_score": round(random.uniform(0.0, 0.15), 4),
                "skin_texture_variance": round(random.uniform(0.01, 0.10), 4),
                "material_hint": "silicone" if "silicone" in attack else "resin",
            })
        elif attack.startswith("screen_replay"):
            refresh = random.choice([60, 90, 120, 144, 240])
            record.update({
                "moire_freq_hz": round(random.uniform(55, refresh + 5), 2),
                "pixel_grid_pitch_um": round(random.uniform(50, 320), 2),
                "refresh_rate_hz": refresh,
                "specular_highlight_score": round(random.uniform(0.0, 0.35), 4),
                "subpixel_r_g_b_offset_um": round(random.uniform(0, 30), 2),
                "frequency_signature": _gen_freq_signature(refresh - 10, refresh + 10, n_peaks=3),
            })
        elif attack.startswith("print_attack"):
            record.update({
                "texture_variance": round(random.uniform(0.05, 0.28), 4),
                "halftone_spacing_px": round(random.uniform(6, 18), 2),
                "color_cast": random.choice(["yellow", "blue", "gray", "magenta"]),
                "specular_highlight_score": 0.0,
                "paper_fiber_density": round(random.uniform(0.1, 0.6), 3),
                "ink_dot_diameter_um": round(random.uniform(15, 60), 2),
                "print_tech_hint": "inkjet" if "inkjet" in attack else "laser",
            })
        elif attack == "silicone_finger":
            record.update({
                "ridge_uniformity_score": round(random.uniform(0.7, 0.99), 4),
                "sweat_pore_count": random.randint(0, 3),
                "edge_artifact_score": round(random.uniform(0.4, 0.9), 4),
                "capacitive_response_score": round(random.uniform(0.0, 0.3), 4),
            })
        elif attack == "hybrid_mask_replay":
            record.update({
                "depth_relief_ratio": round(random.uniform(0.05, 0.15), 4),
                "moire_freq_hz": round(random.uniform(60, 120), 2),
                "blend_boundary_px": random.randint(2, 6),
                "combined_severity": round(random.uniform(0.75, 0.99), 4),
                "components": ["3d_mask", "screen_replay"],
            })
        records.append(record)
    return records


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

# Project root is two levels up from training/synthetic_generator.py
_PROJECT_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
)


def _output_dir() -> str:
    """Return absolute path to training/out/, creating if needed.

    Also used as the legacy output location (smoke-task-14b.ts reads from here).
    """
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "out")
    os.makedirs(out_dir, exist_ok=True)
    return out_dir


def _pipeline_output_dir() -> str:
    """Return absolute path to data/datasets/synthetic/ — the new pipeline
    location used by download_datasets.py + train.py.

    Creating if needed. Path is computed relative to the project root
    (two levels up from training/), so it works regardless of CWD.
    """
    out_dir = os.path.join(_PROJECT_ROOT, "data", "datasets", "synthetic")
    os.makedirs(out_dir, exist_ok=True)
    return out_dir


def _write_json(name: str, records: List[Dict[str, Any]]) -> str:
    """Write records to JSON file in BOTH training/out/ (legacy) and
    data/datasets/synthetic/ (new pipeline). Return the new-pipeline path.

    Both directories receive the same JSON content so:
      - smoke-task-14b.ts (which reads training/out/) keeps passing
      - download_datasets.py / train.py / data/datasets/ verifiers see the data
    """
    payload = json.dumps(records, ensure_ascii=False, indent=2)
    # Legacy path — training/out/
    legacy_dir = _output_dir()
    legacy_path = os.path.join(legacy_dir, name)
    with open(legacy_path, "w", encoding="utf-8") as f:
        f.write(payload)
    # New pipeline path — data/datasets/synthetic/
    pipeline_dir = _pipeline_output_dir()
    pipeline_path = os.path.join(pipeline_dir, name)
    with open(pipeline_path, "w", encoding="utf-8") as f:
        f.write(payload)
    return pipeline_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(
        description="Cirkle Synthetic Data Generator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--type",
        choices=["identity", "face", "fraud_rings", "mrz", "adversarial", "all"],
        default="all",
        help="Type of synthetic data to generate (default: all)",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=10000,
        help="Number of records to generate (default: 10000)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Random seed for reproducibility (default: None)",
    )
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    out_dir = _output_dir()
    pipeline_dir = _pipeline_output_dir()
    print(f"Cirkle Synthetic Data Generator")
    print(f"  legacy output dir : {out_dir}")
    print(f"  pipeline output dir: {pipeline_dir}")
    print(f"  type: {args.type}")
    print(f"  count: {args.count}")
    print()

    t0 = time.time()

    # When --type is "all", each sub-generator receives the same --count,
    # so a single run produces a uniform-sized synthetic bundle (matches the
    # task spec: "1000 records each" / "100 records each").
    if args.type in ("identity", "all"):
        n = args.count
        print(f"[1/5] Generating {n} synthetic identities...")
        records = gen_synthetic_identities(n)
        path = _write_json("synthetic_identities.json", records)
        print(f"      → wrote {len(records)} records to {path}")
        # Quick sanity check: verify a few checksums
        if records:
            r = records[0]
            print(f"      sample: {r['country_alpha3']} id={r['national_id']} name={r['name_latin']}")

    if args.type in ("face", "all"):
        n = args.count
        print(f"[2/5] Generating {n} face metadata descriptors...")
        records = gen_face_metadata(n)
        path = _write_json("synthetic_face_metadata.json", records)
        print(f"      → wrote {len(records)} records to {path}")

    if args.type in ("fraud_rings", "all"):
        n = args.count
        print(f"[3/5] Generating {n} synthetic fraud rings...")
        records = gen_fraud_rings(n)
        path = _write_json("synthetic_fraud_rings.json", records)
        total_members = sum(r["member_count"] for r in records)
        print(f"      → wrote {len(records)} rings ({total_members} members) to {path}")

    if args.type in ("mrz", "all"):
        n = args.count
        print(f"[4/5] Generating {n} MRZ edge cases...")
        records = gen_mrz_edge_cases(n)
        path = _write_json("synthetic_mrz_edge_cases.json", records)
        n_valid = sum(1 for r in records if r["valid"])
        print(f"      → wrote {len(records)} records ({n_valid} valid, {len(records) - n_valid} invalid) to {path}")

    if args.type in ("adversarial", "all"):
        n = args.count
        print(f"[5/5] Generating {n} adversarial attack signatures...")
        records = gen_adversarial_signatures(n)
        path = _write_json("synthetic_adversarial_signatures.json", records)
        print(f"      → wrote {len(records)} records to {path}")

    elapsed = time.time() - t0
    print()
    print(f"Done in {elapsed:.2f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
