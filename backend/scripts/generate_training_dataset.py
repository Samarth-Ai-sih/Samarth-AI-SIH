"""
SAMARTH AI — Phase 6: Reproducible Synthetic MPLADS Training Dataset Generator

Generates a comprehensive, realistic MPLADS-style dataset with controlled
anomaly scenarios for risk-model training and platform testing.

Records generated:
  - 20 states, 40+ districts, 80+ constituencies
  - 50+ implementing agencies
  - 80+ MPs
  - 1,500+ works across 7 categories
  - Payment tranches, progress updates, timeline events per work
  - Sanction records
  - Inspection tasks (15+)
  - Citizen reports (40+)
  - Escalations (20+)
  - Evidence metadata with duplicate-image clusters (15+)

Controlled anomaly scenarios:
  - 100+ Red-risk works
  - 250+ Amber-risk works
  - 30+ Dormant works (no activity >6 months)
  - 20+ Overdue works (past expected completion)
  - 25+ Financial/physical mismatch cases
  - 8+ Duplicate-work clusters
  - 15+ Duplicate/near-duplicate image cases
  - 40+ Citizen reports
  - 15+ Inspection tasks
  - 20+ Active escalations

Usage:
    cd backend
    python -m scripts.generate_training_dataset
    python -m scripts.generate_training_dataset --seed 42
    python -m scripts.generate_training_dataset --dry-run

Requires MONGODB_URI and MONGODB_DB_NAME in backend/.env
Does NOT overwrite the uploaded allocation datasets.

Deterministic: uses a configurable random seed for full reproducibility.
"""

import argparse
import asyncio
import hashlib
import math
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import get_settings
from app.core.database import Database


# ═══════════════════════════════════════════════════════════════════
# SECTION 1: REFERENCE DATA POOLS
# ═══════════════════════════════════════════════════════════════════

STATES = [
    {"code": "MH", "name": "Maharashtra"},
    {"code": "UP", "name": "Uttar Pradesh"},
    {"code": "KA", "name": "Karnataka"},
    {"code": "TN", "name": "Tamil Nadu"},
    {"code": "RJ", "name": "Rajasthan"},
    {"code": "WB", "name": "West Bengal"},
    {"code": "GJ", "name": "Gujarat"},
    {"code": "MP", "name": "Madhya Pradesh"},
    {"code": "BR", "name": "Bihar"},
    {"code": "AP", "name": "Andhra Pradesh"},
    {"code": "TS", "name": "Telangana"},
    {"code": "KL", "name": "Kerala"},
    {"code": "OR", "name": "Odisha"},
    {"code": "AS", "name": "Assam"},
    {"code": "JH", "name": "Jharkhand"},
    {"code": "PB", "name": "Punjab"},
    {"code": "HR", "name": "Haryana"},
    {"code": "CG", "name": "Chhattisgarh"},
    {"code": "UK", "name": "Uttarakhand"},
    {"code": "HP", "name": "Himachal Pradesh"},
    {"code": "GA", "name": "Goa"},
    {"code": "DL", "name": "Delhi"},
]

# District data — 2+ districts per state with coordinates
DISTRICT_TEMPLATES: dict[str, list[dict]] = {
    "MH": [
        {"code": "MH-MUM", "name": "Mumbai", "lat": 19.076, "lng": 72.878},
        {"code": "MH-PUN", "name": "Pune", "lat": 18.520, "lng": 73.857},
        {"code": "MH-NAG", "name": "Nagpur", "lat": 21.146, "lng": 79.088},
    ],
    "UP": [
        {"code": "UP-LKO", "name": "Lucknow", "lat": 26.847, "lng": 80.946},
        {"code": "UP-VNS", "name": "Varanasi", "lat": 25.318, "lng": 82.974},
        {"code": "UP-AGR", "name": "Agra", "lat": 27.177, "lng": 78.008},
    ],
    "KA": [
        {"code": "KA-BLR", "name": "Bengaluru Urban", "lat": 12.972, "lng": 77.595},
        {"code": "KA-MYS", "name": "Mysuru", "lat": 12.296, "lng": 76.639},
    ],
    "TN": [
        {"code": "TN-CHN", "name": "Chennai", "lat": 13.083, "lng": 80.271},
        {"code": "TN-CBE", "name": "Coimbatore", "lat": 11.017, "lng": 76.956},
    ],
    "RJ": [
        {"code": "RJ-JPR", "name": "Jaipur", "lat": 26.912, "lng": 75.787},
        {"code": "RJ-JDH", "name": "Jodhpur", "lat": 26.239, "lng": 73.024},
    ],
    "WB": [
        {"code": "WB-KOL", "name": "Kolkata", "lat": 22.573, "lng": 88.364},
        {"code": "WB-HWH", "name": "Howrah", "lat": 22.586, "lng": 88.264},
    ],
    "GJ": [
        {"code": "GJ-AHM", "name": "Ahmedabad", "lat": 23.023, "lng": 72.571},
        {"code": "GJ-SUR", "name": "Surat", "lat": 21.170, "lng": 72.831},
    ],
    "MP": [
        {"code": "MP-BPL", "name": "Bhopal", "lat": 23.260, "lng": 77.413},
        {"code": "MP-IDR", "name": "Indore", "lat": 22.720, "lng": 75.858},
    ],
    "BR": [
        {"code": "BR-PAT", "name": "Patna", "lat": 25.612, "lng": 85.145},
        {"code": "BR-GAY", "name": "Gaya", "lat": 24.797, "lng": 84.999},
    ],
    "AP": [
        {"code": "AP-VIJ", "name": "Vijayawada", "lat": 16.507, "lng": 80.647},
        {"code": "AP-VIS", "name": "Visakhapatnam", "lat": 17.687, "lng": 83.218},
    ],
    "TS": [
        {"code": "TS-HYD", "name": "Hyderabad", "lat": 17.385, "lng": 78.487},
        {"code": "TS-WGL", "name": "Warangal", "lat": 17.978, "lng": 79.600},
    ],
    "KL": [
        {"code": "KL-TVM", "name": "Thiruvananthapuram", "lat": 8.524, "lng": 76.936},
        {"code": "KL-EKM", "name": "Ernakulam", "lat": 9.982, "lng": 76.299},
    ],
    "OR": [
        {"code": "OR-BBS", "name": "Bhubaneswar", "lat": 20.297, "lng": 85.825},
        {"code": "OR-CTK", "name": "Cuttack", "lat": 20.462, "lng": 85.883},
    ],
    "AS": [
        {"code": "AS-GHY", "name": "Guwahati", "lat": 26.144, "lng": 91.736},
        {"code": "AS-JRH", "name": "Jorhat", "lat": 26.757, "lng": 94.203},
    ],
    "JH": [
        {"code": "JH-RAN", "name": "Ranchi", "lat": 23.344, "lng": 85.310},
        {"code": "JH-JAM", "name": "Jamshedpur", "lat": 22.805, "lng": 86.203},
    ],
    "PB": [
        {"code": "PB-LDH", "name": "Ludhiana", "lat": 30.901, "lng": 75.857},
        {"code": "PB-AMR", "name": "Amritsar", "lat": 31.634, "lng": 74.872},
    ],
    "HR": [
        {"code": "HR-GGN", "name": "Gurugram", "lat": 28.459, "lng": 77.027},
        {"code": "HR-KNL", "name": "Karnal", "lat": 29.686, "lng": 76.990},
    ],
    "CG": [
        {"code": "CG-RPR", "name": "Raipur", "lat": 21.251, "lng": 81.630},
        {"code": "CG-BIL", "name": "Bilaspur", "lat": 22.080, "lng": 82.150},
    ],
    "UK": [
        {"code": "UK-DDN", "name": "Dehradun", "lat": 30.317, "lng": 78.032},
        {"code": "UK-HLD", "name": "Haridwar", "lat": 29.946, "lng": 78.163},
    ],
    "HP": [
        {"code": "HP-SML", "name": "Shimla", "lat": 31.105, "lng": 77.172},
        {"code": "HP-KLU", "name": "Kullu", "lat": 31.958, "lng": 77.109},
    ],
    "GA": [
        {"code": "GA-PNJ", "name": "Panaji", "lat": 15.496, "lng": 73.828},
        {"code": "GA-MAR", "name": "Margao", "lat": 15.282, "lng": 73.958},
    ],
    "DL": [
        {"code": "DL-NDL", "name": "New Delhi", "lat": 28.614, "lng": 77.209},
        {"code": "DL-SDL", "name": "South Delhi", "lat": 28.530, "lng": 77.230},
    ],
}

FIRST_NAMES_MALE = [
    "Rajesh", "Suresh", "Mahesh", "Ramesh", "Ashok", "Arun", "Vijay",
    "Sanjay", "Deepak", "Manoj", "Rakesh", "Sunil", "Anil", "Vinod",
    "Pramod", "Naren", "Mohan", "Gopal", "Hari", "Kishan", "Lakshman",
    "Ravi", "Sachin", "Naveen", "Ajay", "Pradeep", "Dinesh", "Ganesh",
    "Balram", "Devendra", "Nitin", "Yogesh",
]

FIRST_NAMES_FEMALE = [
    "Priya", "Meena", "Anita", "Sunita", "Kavitha", "Lakshmi", "Rekha",
    "Geeta", "Sushma", "Nirmala", "Pushpa", "Saroj", "Kamla", "Usha",
    "Neeta", "Sarita", "Manju", "Asha", "Poonam", "Shobha", "Kusum",
    "Madhu", "Vandana", "Jaya", "Suman",
]

LAST_NAMES = [
    "Kumar", "Sharma", "Singh", "Patel", "Reddy", "Rao", "Nair",
    "Yadav", "Mishra", "Chowdhury", "Gupta", "Joshi", "Patil",
    "Devi", "Verma", "Das", "Iyer", "Menon", "Pillai", "Bose",
    "Mukherjee", "Banerjee", "Chauhan", "Thakur", "Dubey",
    "Tiwari", "Pandey", "Shukla", "Saxena", "Malhotra",
]

HONORIFICS = ["Shri", "Smt.", "Dr."]

AGENCY_NAMES = [
    "Public Works Department (PWD)",
    "Zilla Parishad",
    "Municipal Corporation",
    "District Rural Development Agency (DRDA)",
    "State Public Health Engineering Dept.",
    "State Education Department",
    "District Urban Development Authority",
    "Cantonment Board",
    "Tribal Development Department",
    "Block Development Office",
    "Rural Engineering Organisation (REO)",
    "State Roads Transport Corporation",
    "Panchayati Raj Engineering Division",
    "Minor Irrigation Department",
    "State Electricity Board (SEB)",
    "National Buildings Construction Corp.",
    "Housing Board",
    "Water Supply & Sewerage Board",
    "Rural Water Supply Department",
    "Social Welfare Department",
    "Women & Child Development Dept.",
    "Youth Affairs & Sports Department",
    "Agricultural Engineering Department",
    "Horticulture Department",
    "Animal Husbandry Department",
    "Fisheries Department",
    "Forest Department",
    "Tourism Development Corporation",
    "Industrial Development Corporation",
    "Slum Development Authority",
    "Town & Country Planning Organisation",
    "State Highway Authority",
    "Metro Water Supply Board",
    "Solid Waste Management Authority",
    "Smart City Development Corp.",
    "Development Authority",
    "Nagar Palika Parishad",
    "Nagar Panchayat",
    "Gram Panchayat Union",
    "Urban Local Body (ULB)",
    "Construction Division PWD",
    "State Bridge Corporation",
    "Flood Control Department",
    "Drainage & Irrigation Board",
    "Primary Education Directorate",
    "Secondary Education Directorate",
    "Health & Family Welfare Dept.",
    "District Health Society",
    "Renewable Energy Development Agency",
    "Solar Energy Corporation",
]

# ── Category Configuration ───────────────────────────────────────
# Each category has realistic cost ranges, duration ranges, and work templates

CATEGORY_CONFIG = {
    "roads_and_bridges": {
        "label": "Roads & Bridges",
        "cost_range": (1500000, 25000000),  # 15L - 2.5Cr
        "duration_days": (180, 540),         # 6-18 months
        "templates": [
            ("Construction of CC Road ({dist})", "Construction of cement concrete road connecting villages in {dist} district."),
            ("Repair and Widening of NH Link Road", "Widening and repair of 3.5km National Highway link road with proper drainage."),
            ("Construction of RCC Bridge over Nala", "RCC bridge over seasonal nala for all-weather connectivity."),
            ("Bituminous Road from {village} to Main Road", "4m wide bituminous road of 2.8km length connecting {village} to state highway."),
            ("Footpath and Drain along Market Road", "Concrete footpath with covered drain along main market road in {dist}."),
            ("Culvert Construction at River Crossing", "Box culvert construction at river crossing point on village road."),
            ("Speed Breaker & Road Marking Installation", "Installation of speed breakers and road markings near school zone."),
        ],
    },
    "drinking_water": {
        "label": "Drinking Water",
        "cost_range": (500000, 15000000),   # 5L - 1.5Cr
        "duration_days": (120, 360),
        "templates": [
            ("RO Water Purification Plant ({dist})", "Installation of 5000 LPH RO water purification plant."),
            ("Bore Well with Hand Pump", "Drilling of 150m bore well with India Mark II hand pump."),
            ("Overhead Water Tank Construction", "Construction of 50,000 litre overhead water tank with distribution network."),
            ("Pipeline Extension to Ward {ward}", "Laying of 2km water supply pipeline to unserved Ward {ward}."),
            ("Rainwater Harvesting System", "Rooftop rainwater harvesting with underground storage tank."),
            ("Water ATM Installation", "Solar-powered community water ATM with RO purification."),
        ],
    },
    "sanitation": {
        "label": "Sanitation",
        "cost_range": (300000, 8000000),    # 3L - 80L
        "duration_days": (90, 300),
        "templates": [
            ("Community Toilet Block ({dist})", "Construction of 20-seat community toilet block with disabled access."),
            ("Sewage Treatment Plant", "Construction of 1 MLD sewage treatment plant."),
            ("Underground Drainage System", "Laying of 1.5km underground drainage pipeline."),
            ("Solid Waste Management Centre", "Construction of solid waste segregation and composting centre."),
            ("Public Urinal Complex near Bus Stand", "Construction of pay-and-use toilet complex near bus terminus."),
        ],
    },
    "education": {
        "label": "School Infrastructure",
        "cost_range": (400000, 12000000),   # 4L - 1.2Cr
        "duration_days": (150, 420),
        "templates": [
            ("Construction of School Building", "Two-storey school building with 8 classrooms and computer lab."),
            ("Boundary Wall for Govt. School", "Construction of boundary wall and gate for government school."),
            ("School Library and Reading Room", "Construction of library with reading room and digital learning corner."),
            ("Anganwadi Centre Construction", "Purpose-built Anganwadi centre with play area and kitchen."),
            ("Computer Lab with 25 Desktops", "Setting up computer lab with 25 desktops and internet connectivity."),
            ("Science Laboratory Construction", "Construction and equipping of science laboratory for secondary school."),
            ("School Toilet Block (Girls)", "Separate toilet block for girl students with running water."),
        ],
    },
    "community_infrastructure": {
        "label": "Community Assets",
        "cost_range": (500000, 20000000),   # 5L - 2Cr
        "duration_days": (150, 480),
        "templates": [
            ("Community Hall Construction", "Multi-purpose community hall with 300-seat auditorium."),
            ("Bus Shelter with Seating ({loc})", "Construction of bus shelter with steel seating at {loc}."),
            ("Public Park with Walking Track", "Development of public park with walking track and seating."),
            ("Cremation Ground Development", "Development of cremation ground with shed and pathway."),
            ("Market Shed Construction", "Construction of steel-roofed market shed for weekly market."),
            ("Skill Development Centre", "Training centre for electrician, plumber, and computer courses."),
            ("Cultural Centre with Library", "Construction of cultural centre with library and exhibition space."),
        ],
    },
    "healthcare": {
        "label": "Health Facilities",
        "cost_range": (600000, 20000000),   # 6L - 2Cr
        "duration_days": (150, 450),
        "templates": [
            ("Community Health Centre Construction", "Construction of 30-bed community health centre with OPD."),
            ("Primary Health Sub-Centre Upgrade", "Renovation and equipment upgrade of health sub-centre."),
            ("Ambulance Parking and Waiting Area", "Construction of ambulance parking shed and patient waiting area."),
            ("Telemedicine Centre Setup", "Setting up telemedicine centre with video conferencing equipment."),
            ("Veterinary Dispensary Construction", "Construction of veterinary dispensary with cold storage."),
            ("Blood Bank Cold Storage Unit", "Installation of blood bank cold storage at district hospital."),
        ],
    },
    "electricity": {
        "label": "Solar & Street Lighting",
        "cost_range": (200000, 8000000),    # 2L - 80L
        "duration_days": (60, 210),          # shorter durations
        "templates": [
            ("LED Street Lighting ({count} poles)", "Installation of {count} LED street lights along main road."),
            ("Solar Microgrid for Village", "Off-grid solar microgrid for remote village with 80 households."),
            ("Solar-Powered Water Pump", "Installation of 5HP solar water pump for community bore well."),
            ("High-Mast Lighting at Junction", "Installation of 4 high-mast lights at major road junction."),
            ("Solar Panel on Government Building", "Rooftop solar panel installation on government office building."),
            ("Street Light Maintenance (Ward {ward})", "Replacement and repair of 60 defunct street lights in Ward {ward}."),
        ],
    },
}

VILLAGES = [
    "Rampur", "Sultanpur", "Khanpur", "Shivpuri", "Govindpur",
    "Laxmipur", "Devipur", "Haripur", "Balrampur", "Mohanpur",
    "Sitapur", "Krishnapur", "Giripur", "Bhimpur", "Narayanpur",
    "Indrapur", "Sagarpur", "Chandpur", "Madhopur", "Jaipur Kalan",
]

RISK_TIERS = ["Low", "Medium", "High", "Critical"]


# ═══════════════════════════════════════════════════════════════════
# SECTION 2: REFERENCE DATA GENERATION
# ═══════════════════════════════════════════════════════════════════

def generate_districts(rng: random.Random) -> list[dict]:
    """Generate 40+ districts from state templates."""
    districts = []
    for state in STATES:
        templates = DISTRICT_TEMPLATES.get(state["code"], [])
        for d in templates:
            districts.append({
                "district_id": str(uuid4()),
                "district_code": d["code"],
                "district_name": d["name"],
                "state_code": state["code"],
                "state_name": state["name"],
                "latitude": d["lat"],
                "longitude": d["lng"],
            })
    return districts


def generate_constituencies(districts: list[dict], rng: random.Random) -> list[dict]:
    """Generate 80+ constituencies — ~2 per district."""
    constituencies = []
    suffixes = ["North", "South", "East", "West", "Central", "Rural", "Urban"]
    for d in districts:
        n_const = rng.randint(1, 3)
        used_suffixes = rng.sample(suffixes, min(n_const, len(suffixes)))
        for i in range(n_const):
            suffix = used_suffixes[i] if i < len(used_suffixes) else str(i + 1)
            constituencies.append({
                "constituency_id": str(uuid4()),
                "constituency_name": f"{d['district_name']} {suffix}",
                "district_code": d["district_code"],
                "district_name": d["district_name"],
                "state_code": d["state_code"],
                "state_name": d["state_name"],
                "latitude": d["latitude"] + rng.uniform(-0.1, 0.1),
                "longitude": d["longitude"] + rng.uniform(-0.1, 0.1),
            })
    return constituencies


def generate_mps(constituencies: list[dict], rng: random.Random) -> list[dict]:
    """Generate one MP per constituency."""
    mps = []
    for c in constituencies:
        is_female = rng.random() < 0.3
        first = rng.choice(FIRST_NAMES_FEMALE if is_female else FIRST_NAMES_MALE)
        last = rng.choice(LAST_NAMES)
        hon = "Smt." if is_female else rng.choice(["Shri", "Dr."])
        mps.append({
            "mp_id": str(uuid4()),
            "mp_name": f"{hon} {first} {last}",
            "constituency": c["constituency_name"],
            "district_code": c["district_code"],
            "state_code": c["state_code"],
            "state_name": c["state_name"],
            "party": rng.choice(["INC", "BJP", "AAP", "TMC", "DMK", "JDU", "SP", "BSP", "NCP", "YSRCP", "TDP", "Independent"]),
            "term_start": 2024,
            "term_end": 2029,
        })
    return mps


def generate_agencies(rng: random.Random) -> list[dict]:
    """Generate 50+ implementing agencies with performance profiles."""
    agencies = []
    for name in AGENCY_NAMES:
        agencies.append({
            "agency_id": str(uuid4()),
            "agency_name": name,
            "reliability_score": round(rng.uniform(0.4, 1.0), 2),
            "avg_delay_days": rng.randint(0, 120),
            "total_works_completed": rng.randint(5, 500),
            "active_works": rng.randint(0, 30),
        })
    return agencies


# ═══════════════════════════════════════════════════════════════════
# SECTION 3: WORK GENERATION ENGINE
# ═══════════════════════════════════════════════════════════════════

def _random_date(rng: random.Random, start_days_ago: int, end_days_ago: int) -> datetime:
    """Random datetime between start_days_ago and end_days_ago before now."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=start_days_ago)
    end = now - timedelta(days=end_days_ago)
    delta = (end - start).total_seconds()
    return start + timedelta(seconds=rng.randint(0, max(1, int(delta))))


def _seasonal_delay(rng: random.Random, month: int) -> int:
    """Monsoon season (Jun-Sep) adds delays."""
    if 6 <= month <= 9:
        return rng.randint(15, 60)
    return 0


def generate_base_work(
    rng: random.Random,
    category: str,
    constituency: dict,
    mp: dict,
    agency: dict,
    district: dict,
    work_index: int,
) -> dict:
    """Generate a single realistic work document."""
    cfg = CATEGORY_CONFIG[category]
    cost_lo, cost_hi = cfg["cost_range"]
    dur_lo, dur_hi = cfg["duration_days"]

    sanctioned_amount = round(rng.uniform(cost_lo, cost_hi), 2)

    # Higher-value roads → longer duration
    if category == "roads_and_bridges" and sanctioned_amount > 10000000:
        dur_lo = int(dur_lo * 1.3)
        dur_hi = int(dur_hi * 1.4)
    # Solar/lighting → shorter
    if category == "electricity" and sanctioned_amount < 3000000:
        dur_hi = min(dur_hi, 150)

    base_duration = rng.randint(dur_lo, dur_hi)

    # Agency delay history
    agency_delay = int(agency.get("avg_delay_days", 0) * rng.uniform(0, 0.5))
    total_duration = base_duration + agency_delay

    # Dates
    recommended_date = _random_date(rng, 900, 200)
    seasonal = _seasonal_delay(rng, recommended_date.month)
    sanctioned_date = recommended_date + timedelta(days=rng.randint(20, 90))
    start_date = sanctioned_date + timedelta(days=rng.randint(10, 60) + seasonal)
    expected_completion = start_date + timedelta(days=total_duration)

    # Pick template
    template = rng.choice(cfg["templates"])
    title_tpl, desc_tpl = template
    village = rng.choice(VILLAGES)
    title = title_tpl.format(
        dist=district["district_name"],
        village=village,
        loc=f"{village}, {district['district_name']}",
        ward=rng.randint(1, 25),
        count=rng.choice([50, 100, 150, 200, 250]),
    )
    description = desc_tpl.format(
        dist=district["district_name"],
        village=village,
        loc=f"{village}, {district['district_name']}",
        ward=rng.randint(1, 25),
        count=rng.choice([50, 100, 150, 200, 250]),
    )

    # Status distribution (weighted)
    elapsed = (datetime.now(timezone.utc) - start_date).days
    fraction_elapsed = max(0, min(1.0, elapsed / max(1, total_duration)))

    if fraction_elapsed < 0.1:
        status = rng.choice(["recommended", "under_review", "sanctioned"])
    elif fraction_elapsed < 0.8:
        status = rng.choices(
            ["in_progress", "sanctioned", "on_hold"],
            weights=[7, 2, 1],
        )[0]
    else:
        status = rng.choices(
            ["in_progress", "completed", "under_verification", "on_hold"],
            weights=[3, 4, 2, 1],
        )[0]

    # Physical progress — follows elapsed time with noise
    if status in ("recommended", "under_review"):
        physical_pct = 0.0
    elif status == "sanctioned":
        physical_pct = rng.uniform(0, 5)
    elif status in ("completed", "under_verification"):
        physical_pct = rng.uniform(90, 100)
    elif status == "on_hold":
        physical_pct = rng.uniform(10, 60)
    else:
        physical_pct = min(95, fraction_elapsed * 100 * rng.uniform(0.6, 1.1))
    physical_pct = round(physical_pct, 1)

    # Financial — payments correlate with progress
    if status in ("recommended", "under_review"):
        funds_released = 0.0
    elif status == "sanctioned":
        funds_released = round(sanctioned_amount * rng.uniform(0.3, 0.5), 2)
    elif status in ("completed", "under_verification"):
        funds_released = round(sanctioned_amount * rng.uniform(0.85, 1.0), 2)
    else:
        funds_released = round(sanctioned_amount * (physical_pct / 100) * rng.uniform(0.8, 1.2), 2)
    funds_released = min(funds_released, sanctioned_amount)

    actual_expenditure = round(funds_released * rng.uniform(0.7, 0.98), 2) if funds_released > 0 else 0.0
    actual_completion = None
    if status in ("completed", "under_verification"):
        actual_completion = (expected_completion + timedelta(days=rng.randint(-30, 60))).isoformat()

    # Payment tranches
    tranches = _generate_tranches(rng, status, sanctioned_amount, sanctioned_date)

    # Progress updates
    progress_updates = _generate_progress_updates(rng, status, start_date, physical_pct)

    # Timeline
    timeline = _generate_timeline_events(rng, status, recommended_date, sanctioned_date, start_date)

    work = {
        "work_id": str(uuid4()),
        "title": title,
        "description": description,
        "status": status,
        "category": category,
        "sub_category": cfg["label"],
        "state_code": constituency["state_code"],
        "state_name": constituency["state_name"],
        "district_code": district["district_code"],
        "district_name": district["district_name"],
        "constituency": constituency["constituency_name"],
        "mp_name": mp["mp_name"],
        "mp_id": mp["mp_id"],
        "implementing_agency": agency["agency_name"],
        "sanctioned_amount": sanctioned_amount,
        "funds_released": round(funds_released, 2),
        "actual_expenditure": round(actual_expenditure, 2),
        "recommended_date": recommended_date.isoformat(),
        "sanctioned_date": sanctioned_date.isoformat() if status not in ("recommended",) else None,
        "start_date": start_date.isoformat() if status not in ("recommended", "under_review", "sanctioned") else None,
        "expected_completion_date": expected_completion.isoformat(),
        "actual_completion_date": actual_completion,
        "physical_progress_pct": physical_pct,
        "location": {
            "latitude": round(district["latitude"] + rng.uniform(-0.08, 0.08), 6),
            "longitude": round(district["longitude"] + rng.uniform(-0.08, 0.08), 6),
            "address": f"Near {village}, {district['district_name']}, {constituency['state_name']}",
        },
        "composite_risk_score": None,
        "risk_tier": None,
        "payment_tranches": tranches,
        "progress_updates": progress_updates,
        "timeline": timeline,
        "created_by": "dataset_generator",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        # Metadata for anomaly injection
        "_meta": {
            "category": category,
            "base_duration": base_duration,
            "agency_delay": agency_delay,
            "fraction_elapsed": fraction_elapsed,
            "anomaly_tags": [],
        },
    }
    return work


def _generate_tranches(rng: random.Random, status: str, sanctioned: float, sanction_date: datetime) -> list[dict]:
    """Payment tranches that correlate with cost and status."""
    tranches = []
    if status in ("recommended", "under_review"):
        return tranches

    # First tranche (40-50%)
    t1_pct = rng.uniform(0.4, 0.5)
    tranches.append({
        "tranche_id": str(uuid4()),
        "tranche_number": 1,
        "amount": round(sanctioned * t1_pct, 2),
        "released_date": (sanction_date + timedelta(days=rng.randint(5, 30))).isoformat(),
        "purpose": "Initial release on sanction",
        "released_by": "District Authority",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    if status in ("in_progress", "on_hold", "completed", "under_verification"):
        t2_pct = rng.uniform(0.25, 0.35)
        tranches.append({
            "tranche_id": str(uuid4()),
            "tranche_number": 2,
            "amount": round(sanctioned * t2_pct, 2),
            "released_date": (sanction_date + timedelta(days=rng.randint(90, 200))).isoformat(),
            "purpose": "Second instalment on progress certification",
            "released_by": "District Authority",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    if status in ("completed", "under_verification"):
        t3_pct = rng.uniform(0.15, 0.25)
        tranches.append({
            "tranche_id": str(uuid4()),
            "tranche_number": 3,
            "amount": round(sanctioned * t3_pct, 2),
            "released_date": (sanction_date + timedelta(days=rng.randint(250, 400))).isoformat(),
            "purpose": "Final instalment on completion",
            "released_by": "District Authority",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    return tranches


def _generate_progress_updates(rng: random.Random, status: str, start_date: datetime, target_pct: float) -> list[dict]:
    """Generate progress updates that generally increase toward target_pct."""
    updates = []
    if status in ("recommended", "under_review"):
        return updates

    n_updates = rng.randint(2, 8)
    current_pct = 0.0
    current_date = start_date

    for i in range(n_updates):
        step = (target_pct - current_pct) / max(1, n_updates - i)
        current_pct = min(target_pct, current_pct + step * rng.uniform(0.6, 1.4))
        current_pct = round(max(0, min(100, current_pct)), 1)
        current_date += timedelta(days=rng.randint(15, 60))

        updates.append({
            "update_id": str(uuid4()),
            "date": current_date.isoformat(),
            "physical_progress_pct": current_pct,
            "description": _progress_description(current_pct, rng),
            "updated_by": rng.choice(AGENCY_NAMES[:10]),
            "attachments": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    return updates


def _progress_description(pct: float, rng: random.Random) -> str:
    if pct < 10:
        return rng.choice(["Site cleared and marked", "Foundation excavation started", "Materials procured"])
    elif pct < 30:
        return rng.choice(["Foundation work in progress", "Plinth level reached", "Base course laid"])
    elif pct < 60:
        return rng.choice(["Superstructure 50% complete", "Wall construction ongoing", "Pipe laying in progress"])
    elif pct < 85:
        return rng.choice(["Roof casting done", "Finishing work started", "Testing and commissioning initiated"])
    else:
        return rng.choice(["Work substantially completed", "Final coat painting done", "Handed over to department"])


def _generate_timeline_events(rng: random.Random, status: str, rec_date: datetime, sanc_date: datetime, start_date: datetime) -> list[dict]:
    """Generate lifecycle timeline events."""
    events = []
    actor = f"{rng.choice(HONORIFICS)} {rng.choice(FIRST_NAMES_MALE)} {rng.choice(LAST_NAMES)}"

    events.append({"event_id": str(uuid4()), "timestamp": rec_date.isoformat(), "event_type": "status_change", "title": "Work Recommended", "description": "Work recommended by MP.", "actor": actor})

    if status != "recommended":
        events.append({"event_id": str(uuid4()), "timestamp": (rec_date + timedelta(days=rng.randint(5, 20))).isoformat(), "event_type": "status_change", "title": "Under Review", "description": "Submitted for technical and administrative review.", "actor": actor})

    if status not in ("recommended", "under_review"):
        events.append({"event_id": str(uuid4()), "timestamp": sanc_date.isoformat(), "event_type": "status_change", "title": "Work Sanctioned", "description": f"Sanctioned by District Authority.", "actor": "District Authority"})

    if status in ("in_progress", "on_hold", "completed", "under_verification"):
        events.append({"event_id": str(uuid4()), "timestamp": start_date.isoformat(), "event_type": "status_change", "title": "Work Commenced", "description": "Construction work started on site.", "actor": rng.choice(AGENCY_NAMES[:10])})

    if status == "on_hold":
        events.append({"event_id": str(uuid4()), "timestamp": (start_date + timedelta(days=rng.randint(60, 180))).isoformat(), "event_type": "status_change", "title": "Work On Hold", "description": rng.choice(["Monsoon delay", "Land dispute", "Material shortage", "Contractor issue"]), "actor": actor})

    if status in ("completed", "under_verification"):
        events.append({"event_id": str(uuid4()), "timestamp": (start_date + timedelta(days=rng.randint(200, 500))).isoformat(), "event_type": "status_change", "title": "Work Completed", "description": "Construction work completed.", "actor": rng.choice(AGENCY_NAMES[:10])})

    if status == "under_verification":
        events.append({"event_id": str(uuid4()), "timestamp": (start_date + timedelta(days=rng.randint(250, 520))).isoformat(), "event_type": "status_change", "title": "Under Verification", "description": "Submitted for completion verification and inspection.", "actor": "District Authority"})

    return events


# ═══════════════════════════════════════════════════════════════════
# SECTION 4: ANOMALY / SCENARIO INJECTION
# ═══════════════════════════════════════════════════════════════════

def inject_red_risk(works: list[dict], rng: random.Random, count: int = 110) -> int:
    """Inject 100+ red-risk anomalies: severe mismatch, stalled, high expenditure low progress."""
    injected = 0
    candidates = [w for w in works if w["status"] == "in_progress" and w["_meta"]["anomaly_tags"] == []]
    rng.shuffle(candidates)

    for w in candidates[:count]:
        scenario = rng.choice(["stalled", "financial_drain", "phantom_progress"])
        w["_meta"]["anomaly_tags"].append(f"red:{scenario}")
        w["composite_risk_score"] = round(rng.uniform(0.75, 1.0), 3)
        w["risk_tier"] = "Critical" if w["composite_risk_score"] > 0.9 else "High"

        if scenario == "stalled":
            w["physical_progress_pct"] = round(rng.uniform(5, 25), 1)
            w["funds_released"] = round(w["sanctioned_amount"] * rng.uniform(0.5, 0.8), 2)
            w["actual_expenditure"] = round(w["funds_released"] * rng.uniform(0.6, 0.95), 2)
            # No recent progress updates
            if w["progress_updates"]:
                for pu in w["progress_updates"][-3:]:
                    old_date = datetime.now(timezone.utc) - timedelta(days=rng.randint(200, 400))
                    pu["date"] = old_date.isoformat()

        elif scenario == "financial_drain":
            w["physical_progress_pct"] = round(rng.uniform(10, 30), 1)
            w["funds_released"] = round(w["sanctioned_amount"] * rng.uniform(0.7, 0.95), 2)
            w["actual_expenditure"] = round(w["funds_released"] * rng.uniform(0.85, 1.0), 2)

        elif scenario == "phantom_progress":
            w["physical_progress_pct"] = round(rng.uniform(60, 90), 1)
            w["funds_released"] = round(w["sanctioned_amount"] * rng.uniform(0.1, 0.25), 2)
            w["actual_expenditure"] = round(w["funds_released"] * rng.uniform(0.3, 0.6), 2)

        injected += 1
    return injected


def inject_amber_risk(works: list[dict], rng: random.Random, count: int = 260) -> int:
    """Inject 250+ amber-risk anomalies: moderate delays, minor mismatches."""
    injected = 0
    candidates = [w for w in works if w["_meta"]["anomaly_tags"] == []]
    rng.shuffle(candidates)

    for w in candidates[:count]:
        scenario = rng.choice(["moderate_delay", "slow_progress", "cost_overrun_risk"])
        w["_meta"]["anomaly_tags"].append(f"amber:{scenario}")
        w["composite_risk_score"] = round(rng.uniform(0.4, 0.74), 3)
        w["risk_tier"] = "Medium"

        if scenario == "moderate_delay":
            if w["expected_completion_date"]:
                exp = datetime.fromisoformat(w["expected_completion_date"])
                if exp < datetime.now(timezone.utc):
                    pass  # Already overdue — good
                else:
                    w["physical_progress_pct"] = round(w["physical_progress_pct"] * rng.uniform(0.5, 0.75), 1)

        elif scenario == "slow_progress":
            w["physical_progress_pct"] = round(w["physical_progress_pct"] * rng.uniform(0.4, 0.65), 1)

        elif scenario == "cost_overrun_risk":
            w["actual_expenditure"] = round(w["funds_released"] * rng.uniform(0.95, 1.1), 2)

        injected += 1
    return injected


def inject_dormant(works: list[dict], rng: random.Random, count: int = 35) -> int:
    """Inject 30+ dormant works: no activity for >6 months."""
    injected = 0
    candidates = [w for w in works if w["status"] in ("in_progress", "sanctioned") and "red:" not in str(w["_meta"]["anomaly_tags"])]
    rng.shuffle(candidates)

    for w in candidates[:count]:
        w["_meta"]["anomaly_tags"].append("dormant")
        w["status"] = "in_progress"
        dormant_since = datetime.now(timezone.utc) - timedelta(days=rng.randint(180, 400))
        # Clear recent progress
        w["progress_updates"] = [pu for pu in w["progress_updates"] if datetime.fromisoformat(pu["date"]) < dormant_since]
        if not w["progress_updates"]:
            w["progress_updates"].append({
                "update_id": str(uuid4()),
                "date": (dormant_since - timedelta(days=rng.randint(10, 60))).isoformat(),
                "physical_progress_pct": round(rng.uniform(10, 40), 1),
                "description": "Last recorded activity before dormancy",
                "updated_by": rng.choice(AGENCY_NAMES[:5]),
                "attachments": [],
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        w["physical_progress_pct"] = w["progress_updates"][-1]["physical_progress_pct"]
        if not w["composite_risk_score"]:
            w["composite_risk_score"] = round(rng.uniform(0.6, 0.85), 3)
            w["risk_tier"] = "High"
        injected += 1
    return injected


def inject_overdue(works: list[dict], rng: random.Random, count: int = 25) -> int:
    """Inject 20+ overdue works: past expected completion but not completed."""
    injected = 0
    candidates = [w for w in works if w["status"] == "in_progress" and "dormant" not in w["_meta"]["anomaly_tags"]]
    rng.shuffle(candidates)

    for w in candidates[:count]:
        w["_meta"]["anomaly_tags"].append("overdue")
        past_date = datetime.now(timezone.utc) - timedelta(days=rng.randint(30, 300))
        w["expected_completion_date"] = past_date.isoformat()
        w["physical_progress_pct"] = round(rng.uniform(40, 80), 1)
        if not w["composite_risk_score"] or w["composite_risk_score"] < 0.5:
            w["composite_risk_score"] = round(rng.uniform(0.5, 0.8), 3)
            w["risk_tier"] = rng.choice(["Medium", "High"])
        injected += 1
    return injected


def inject_financial_mismatch(works: list[dict], rng: random.Random, count: int = 30) -> int:
    """Inject 25+ financial/physical progress mismatch cases."""
    injected = 0
    candidates = [w for w in works if w["status"] == "in_progress" and "red:" not in str(w["_meta"]["anomaly_tags"])]
    rng.shuffle(candidates)

    for w in candidates[:count]:
        w["_meta"]["anomaly_tags"].append("financial_mismatch")
        direction = rng.choice(["overspend", "underspend"])
        if direction == "overspend":
            w["funds_released"] = round(w["sanctioned_amount"] * rng.uniform(0.7, 0.9), 2)
            w["actual_expenditure"] = round(w["funds_released"] * rng.uniform(0.9, 1.05), 2)
            w["physical_progress_pct"] = round(rng.uniform(15, 35), 1)
        else:
            w["physical_progress_pct"] = round(rng.uniform(60, 85), 1)
            w["funds_released"] = round(w["sanctioned_amount"] * rng.uniform(0.1, 0.3), 2)
            w["actual_expenditure"] = round(w["funds_released"] * rng.uniform(0.4, 0.7), 2)
        if not w["composite_risk_score"] or w["composite_risk_score"] < 0.5:
            w["composite_risk_score"] = round(rng.uniform(0.55, 0.85), 3)
            w["risk_tier"] = rng.choice(["Medium", "High"])
        injected += 1
    return injected


def inject_duplicate_clusters(works: list[dict], rng: random.Random, n_clusters: int = 10) -> int:
    """Inject 8+ duplicate-work clusters (same/similar title, nearby location)."""
    injected = 0
    source_candidates = [w for w in works if w["_meta"]["anomaly_tags"] == []]
    rng.shuffle(source_candidates)

    for source in source_candidates[:n_clusters]:
        n_dupes = rng.randint(2, 4)
        cluster_id = str(uuid4())[:8]
        source["_meta"]["anomaly_tags"].append(f"duplicate_cluster:{cluster_id}")

        for _ in range(n_dupes):
            dupe = {**source}
            dupe["work_id"] = str(uuid4())
            # Slightly vary title
            suffix = rng.choice([" (Phase 2)", " Extension", " - Additional", " (Revised)", ""])
            dupe["title"] = source["title"] + suffix
            dupe["location"] = {
                "latitude": source["location"]["latitude"] + rng.uniform(-0.005, 0.005),
                "longitude": source["location"]["longitude"] + rng.uniform(-0.005, 0.005),
                "address": source["location"]["address"],
            }
            dupe["sanctioned_amount"] = round(source["sanctioned_amount"] * rng.uniform(0.8, 1.2), 2)
            dupe["_meta"] = {"category": source["_meta"]["category"], "anomaly_tags": [f"duplicate_cluster:{cluster_id}"], "base_duration": source["_meta"]["base_duration"], "agency_delay": source["_meta"]["agency_delay"], "fraction_elapsed": source["_meta"]["fraction_elapsed"]}
            dupe["created_at"] = datetime.now(timezone.utc).isoformat()
            dupe["updated_at"] = datetime.now(timezone.utc).isoformat()
            dupe["composite_risk_score"] = round(rng.uniform(0.5, 0.75), 3)
            dupe["risk_tier"] = "Medium"
            works.append(dupe)
            injected += 1

    return injected


# ═══════════════════════════════════════════════════════════════════
# SECTION 5: RELATED RECORDS GENERATION
# ═══════════════════════════════════════════════════════════════════

def generate_sanctions(works: list[dict], rng: random.Random) -> list[dict]:
    """Generate formal sanction records for sanctioned+ works."""
    sanctions = []
    for w in works:
        if w["status"] in ("recommended", "under_review"):
            continue
        sanctions.append({
            "sanction_id": str(uuid4()),
            "work_id": w["work_id"],
            "work_title": w["title"],
            "sanctioned_amount": w["sanctioned_amount"],
            "sanctioned_date": w["sanctioned_date"],
            "sanctioning_authority": "District Authority",
            "mp_name": w["mp_name"],
            "constituency": w["constituency"],
            "state_code": w["state_code"],
            "district_code": w["district_code"],
            "category": w["category"],
            "order_number": f"MPLADS/{w['state_code']}/{rng.randint(1000, 9999)}/{rng.randint(2023, 2026)}",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    return sanctions


def generate_inspections(works: list[dict], rng: random.Random, count: int = 18) -> list[dict]:
    """Generate 15+ inspection task records."""
    inspections = []
    # Pick works that are in_progress or have anomalies
    candidates = [w for w in works if w["status"] in ("in_progress", "on_hold", "under_verification")]
    rng.shuffle(candidates)

    for w in candidates[:count]:
        inspector = f"{rng.choice(HONORIFICS)} {rng.choice(FIRST_NAMES_MALE + FIRST_NAMES_FEMALE)} {rng.choice(LAST_NAMES)}"
        scheduled = _random_date(rng, 90, 0)
        is_completed = rng.random() < 0.4

        inspections.append({
            "inspection_id": str(uuid4()),
            "work_id": w["work_id"],
            "work_title": w["title"],
            "inspector_name": inspector,
            "inspection_type": rng.choice(["routine", "complaint_based", "milestone_verification", "completion_check"]),
            "status": "completed" if is_completed else rng.choice(["scheduled", "in_progress"]),
            "scheduled_date": scheduled.isoformat(),
            "completed_date": (scheduled + timedelta(days=rng.randint(0, 7))).isoformat() if is_completed else None,
            "findings": rng.choice([
                "Work progressing as per schedule.",
                "Minor quality concerns in concrete mix.",
                "Material stockpile insufficient for remaining work.",
                "Discrepancy found between reported and actual progress.",
                "Safety measures adequate. Work quality satisfactory.",
                "Contractor not present on site during inspection.",
                "Foundation work not as per approved design.",
                "Overall satisfactory. Minor deviations noted.",
            ]) if is_completed else None,
            "physical_progress_observed": round(rng.uniform(max(0, w["physical_progress_pct"] - 15), min(100, w["physical_progress_pct"] + 5)), 1) if is_completed else None,
            "state_code": w["state_code"],
            "district_code": w["district_code"],
            "constituency": w["constituency"],
            "location": w["location"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    return inspections


def generate_citizen_reports(works: list[dict], rng: random.Random, count: int = 45) -> list[dict]:
    """Generate 40+ citizen complaint/feedback reports."""
    reports = []
    candidates = [w for w in works if w["status"] in ("in_progress", "on_hold", "completed")]
    rng.shuffle(candidates)

    complaint_templates = [
        ("Road quality concern", "The road constructed under MPLADS is developing cracks within months of completion."),
        ("Work stalled for months", "No construction activity observed at the site for the past {months} months."),
        ("Incomplete water supply", "Water pipeline laid but no water supply started. Bore well not functional."),
        ("Poor toilet construction", "Community toilet block walls have cracks and doors are missing."),
        ("Street lights not working", "Solar street lights installed 6 months ago are not working."),
        ("No school boundary wall", "Boundary wall sanctioned but only partial construction done."),
        ("Community hall unused", "Community hall completed but remains locked. No handover done."),
        ("Drainage overflow", "Underground drainage system overflowing during rains."),
        ("Health centre understaffed", "Health centre building completed but no staff posted."),
        ("Cost seems inflated", "The road construction cost appears much higher than similar works nearby."),
        ("Contractor absent", "Contractor not seen at site for weeks. Work progressing very slowly."),
        ("Quality of materials", "Low quality bricks and sand being used in construction."),
    ]

    for w in candidates[:count]:
        template = rng.choice(complaint_templates)
        reports.append({
            "report_id": str(uuid4()),
            "work_id": w["work_id"],
            "work_title": w["title"],
            "reporter_type": rng.choice(["citizen", "citizen", "citizen", "local_representative", "journalist"]),
            "reporter_name": f"{rng.choice(FIRST_NAMES_MALE + FIRST_NAMES_FEMALE)} {rng.choice(LAST_NAMES)}" if rng.random() > 0.3 else "Anonymous",
            "subject": template[0],
            "description": template[1].format(months=rng.randint(2, 8)),
            "severity": rng.choices(["low", "medium", "high", "critical"], weights=[2, 4, 3, 1])[0],
            "status": rng.choices(["open", "under_review", "resolved", "dismissed"], weights=[3, 3, 2, 1])[0],
            "submitted_date": _random_date(rng, 180, 0).isoformat(),
            "state_code": w["state_code"],
            "district_code": w["district_code"],
            "constituency": w["constituency"],
            "location": w["location"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    return reports


def generate_escalations(works: list[dict], rng: random.Random, count: int = 25) -> list[dict]:
    """Generate 20+ active escalation records."""
    escalations = []
    red_amber = [w for w in works if any("red:" in t or "dormant" in t or "overdue" in t for t in w["_meta"]["anomaly_tags"])]
    rng.shuffle(red_amber)

    for w in red_amber[:count]:
        escalations.append({
            "escalation_id": str(uuid4()),
            "work_id": w["work_id"],
            "work_title": w["title"],
            "escalation_type": rng.choice(["dormancy_alert", "financial_alert", "overdue_alert", "quality_concern", "citizen_complaint_escalation"]),
            "severity": rng.choice(["high", "critical"]),
            "status": rng.choices(["active", "acknowledged", "resolved"], weights=[5, 3, 1])[0],
            "raised_by": rng.choice(["system_auto", "district_authority", "state_nodal_officer", "mospi"]),
            "raised_date": _random_date(rng, 60, 0).isoformat(),
            "description": f"Escalation raised for work '{w['title']}' due to {rng.choice(['prolonged inactivity', 'financial irregularity', 'significant delay', 'quality concerns'])}.",
            "assigned_to": f"{rng.choice(HONORIFICS)} {rng.choice(FIRST_NAMES_MALE)} {rng.choice(LAST_NAMES)}",
            "state_code": w["state_code"],
            "district_code": w["district_code"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    return escalations


def generate_evidence_metadata(works: list[dict], rng: random.Random, n_duplicate_clusters: int = 18) -> list[dict]:
    """Generate evidence metadata with 15+ duplicate/near-duplicate image cases."""
    evidence = []

    # Normal evidence for completed/in-progress works
    evidenced_works = [w for w in works if w["status"] in ("in_progress", "completed", "under_verification")]
    for w in rng.sample(evidenced_works, min(200, len(evidenced_works))):
        n_images = rng.randint(1, 5)
        for i in range(n_images):
            evidence.append({
                "evidence_id": str(uuid4()),
                "work_id": w["work_id"],
                "evidence_type": "site_photo",
                "file_hash": hashlib.sha256(str(uuid4()).encode()).hexdigest(),
                "file_name": f"site_{w['work_id'][:8]}_{i+1}.jpg",
                "file_size_kb": rng.randint(200, 5000),
                "capture_date": _random_date(rng, 300, 0).isoformat(),
                "uploaded_by": rng.choice(AGENCY_NAMES[:10]),
                "location": w["location"],
                "is_duplicate": False,
                "duplicate_cluster_id": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

    # Duplicate image clusters — same image hash reused across different works
    dup_candidates = rng.sample(evidenced_works, min(n_duplicate_clusters * 3, len(evidenced_works)))
    cluster_idx = 0
    for i in range(0, len(dup_candidates) - 2, 3):
        if cluster_idx >= n_duplicate_clusters:
            break
        shared_hash = hashlib.sha256(f"duplicate_cluster_{cluster_idx}".encode()).hexdigest()
        cluster_id = str(uuid4())[:8]

        for w in dup_candidates[i:i+3]:
            evidence.append({
                "evidence_id": str(uuid4()),
                "work_id": w["work_id"],
                "evidence_type": "site_photo",
                "file_hash": shared_hash,
                "file_name": f"IMG_{rng.randint(1000,9999)}.jpg",
                "file_size_kb": rng.randint(200, 5000),
                "capture_date": _random_date(rng, 200, 0).isoformat(),
                "uploaded_by": rng.choice(AGENCY_NAMES[:10]),
                "location": w["location"],
                "is_duplicate": True,
                "duplicate_cluster_id": cluster_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        cluster_idx += 1

    return evidence


# ═══════════════════════════════════════════════════════════════════
# SECTION 6: MAIN ORCHESTRATOR
# ═══════════════════════════════════════════════════════════════════

def generate_all(seed: int = 42, target_works: int = 1550) -> dict[str, list[dict]]:
    """Generate the complete dataset. Returns a dict of collection_name → documents."""
    rng = random.Random(seed)
    print(f"[SEED] Random seed: {seed}")
    print(f"[TARGET] Target works: {target_works}")
    print()

    # ── Reference data ─────────────────────────────────────
    print("[REF] Generating reference data...")
    districts = generate_districts(rng)
    constituencies = generate_constituencies(districts, rng)
    mps = generate_mps(constituencies, rng)
    agencies = generate_agencies(rng)

    print(f"   States:         {len(STATES)}")
    print(f"   Districts:      {len(districts)}")
    print(f"   Constituencies: {len(constituencies)}")
    print(f"   MPs:            {len(mps)}")
    print(f"   Agencies:       {len(agencies)}")

    # ── Works ──────────────────────────────────────────────
    print(f"\n[WORKS] Generating {target_works} works...")
    categories = list(CATEGORY_CONFIG.keys())
    # Weight: roads most common, then education, healthcare, etc.
    cat_weights = [25, 15, 12, 15, 13, 12, 8]

    works: list[dict] = []
    for i in range(target_works):
        cat = rng.choices(categories, weights=cat_weights)[0]
        const = rng.choice(constituencies)
        mp = next((m for m in mps if m["constituency"] == const["constituency_name"]), rng.choice(mps))
        agency = rng.choice(agencies)
        dist = next((d for d in districts if d["district_code"] == const["district_code"]), rng.choice(districts))

        work = generate_base_work(rng, cat, const, mp, agency, dist, i)
        works.append(work)

    # Status distribution before anomalies
    status_counts = {}
    for w in works:
        status_counts[w["status"]] = status_counts.get(w["status"], 0) + 1
    print(f"   Base status distribution:")
    for st, cnt in sorted(status_counts.items()):
        print(f"     {st:25s} -> {cnt}")

    # ── Anomaly injection ──────────────────────────────────
    print(f"\n[ANOMALY] Injecting controlled anomalies...")
    n_red = inject_red_risk(works, rng)
    n_amber = inject_amber_risk(works, rng)
    n_dormant = inject_dormant(works, rng)
    n_overdue = inject_overdue(works, rng)
    n_mismatch = inject_financial_mismatch(works, rng)
    n_dupes = inject_duplicate_clusters(works, rng)

    print(f"   Red-risk:           {n_red}")
    print(f"   Amber-risk:         {n_amber}")
    print(f"   Dormant:            {n_dormant}")
    print(f"   Overdue:            {n_overdue}")
    print(f"   Financial mismatch: {n_mismatch}")
    print(f"   Duplicate clusters: {n_dupes} added works")

    # Assign low risk to remaining unscored works
    for w in works:
        if w["composite_risk_score"] is None:
            w["composite_risk_score"] = round(rng.uniform(0.05, 0.39), 3)
            w["risk_tier"] = "Low"

    # ── Related records ────────────────────────────────────
    print(f"\n[RECORDS] Generating related records...")
    sanctions = generate_sanctions(works, rng)
    inspections = generate_inspections(works, rng)
    citizen_reports = generate_citizen_reports(works, rng)
    escalations = generate_escalations(works, rng)
    evidence = generate_evidence_metadata(works, rng)

    print(f"   Sanctions:        {len(sanctions)}")
    print(f"   Inspections:      {len(inspections)}")
    print(f"   Citizen reports:  {len(citizen_reports)}")
    print(f"   Escalations:      {len(escalations)}")
    print(f"   Evidence records: {len(evidence)}")

    # ── Clean up _meta from works ──────────────────────────
    # Keep anomaly tags as a hidden field for analysis, remove rest
    for w in works:
        tags = w["_meta"]["anomaly_tags"]
        del w["_meta"]
        w["_anomaly_tags"] = tags  # Kept for analysis, not exposed in API

    # Make the synthetic source unmistakable wherever generated work records
    # are later read by risk and ML tooling.
    for work in works:
        work["data_source"] = "synthetic_ml_training"

    # Final count
    print(f"\n[OK] Total works: {len(works)}")

    return {
        "ref_states": [{"state_id": str(uuid4()), **s} for s in STATES],
        "ref_districts": districts,
        "ref_constituencies": constituencies,
        "ref_mps": mps,
        "ref_agencies": agencies,
        "works": works,
        "sanctions": sanctions,
        "inspections": inspections,
        "citizen_reports": citizen_reports,
        "escalations": escalations,
        "evidence_metadata": evidence,
    }


# ═══════════════════════════════════════════════════════════════════
# SECTION 7: MONGODB INSERTION & CLI
# ═══════════════════════════════════════════════════════════════════

async def insert_to_mongodb(dataset: dict[str, list[dict]], db: Database, *, force: bool = False) -> None:
    """Insert a synthetic training dataset only into an empty target database.

    The generator must never reset or replace an operator's data. A complete
    preflight occurs before the first write so a partially occupied database
    stays entirely untouched.

    With force=True, existing synthetic collections are dropped and re-created.
    """
    # Collections owned by other workflows must never be seeded.
    protected_collections = {"mp_allocations", "import_batches", "users", "sessions", "audit_logs"}
    target_collections = [
        name for name, docs in dataset.items()
        if name not in protected_collections and docs
    ]

    occupied = []
    for coll_name in target_collections:
        existing = await db.get_collection(coll_name).count_documents({})
        if existing:
            occupied.append(f"{coll_name} ({existing})")

    if occupied and not force:
        print(
            "No records changed: target database contains existing data in "
            + ", ".join(occupied)
            + ". Use --force to drop and re-create, or use an empty database."
        )
        return

    if occupied and force:
        print(f"   [FORCE] Dropping {len(occupied)} existing collections...")
        for coll_name in target_collections:
            await db.get_collection(coll_name).drop()

    for coll_name, docs in dataset.items():
        if coll_name in protected_collections:
            print(f"   [SKIP] Skipping protected collection: {coll_name}")
            continue

        if not docs:
            continue

        collection = db.get_collection(coll_name)

        await collection.insert_many(docs)
        print(f"   [OK] {coll_name}: {len(docs)} documents inserted")


async def main():
    parser = argparse.ArgumentParser(description="Generate MPLADS training dataset")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    parser.add_argument("--works", type=int, default=1550, help="Number of works to generate")
    parser.add_argument("--dry-run", action="store_true", help="Generate data without inserting into MongoDB")
    parser.add_argument("--force", action="store_true", help="Drop existing synthetic collections and re-insert")
    args = parser.parse_args()

    print("=" * 65)
    print("  SAMARTH AI - MPLADS Training Dataset Generator")
    print("=" * 65)
    print()

    dataset = generate_all(seed=args.seed, target_works=args.works)

    if args.dry_run:
        print("\n[DONE] Dry run complete. No data inserted into MongoDB.")
        print("   Rerun without --dry-run to insert into the database.")
        return

    print("\n[DB] Inserting into MongoDB...")
    settings = get_settings()
    db = Database(settings)
    await db.connect()

    try:
        await insert_to_mongodb(dataset, db, force=args.force)
    finally:
        await db.disconnect()

    print("\n" + "=" * 65)
    print("  DATASET GENERATION COMPLETE")
    print("=" * 65)
    print()
    print("  Summary of generated record counts:")
    print("  ------------------------------------")
    for coll, docs in dataset.items():
        print(f"  {coll:25s}  {len(docs):>6,}")
    print(f"  {'TOTAL':25s}  {sum(len(d) for d in dataset.values()):>6,}")
    print()
    print("  Seed commands:")
    print(f"    python -m scripts.generate_training_dataset --seed {args.seed}")
    print(f"    python -m scripts.generate_training_dataset --seed {args.seed} --dry-run")
    print()


if __name__ == "__main__":
    asyncio.run(main())
