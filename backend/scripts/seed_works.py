"""
SAMARTH AI — Seed Works Script

Seeds ~20 realistic MPLADS work documents into MongoDB with:
- Real categories, states, districts, constituencies, and MP names
- Various statuses across the 8-stage lifecycle
- Payment tranches with dates and amounts
- Progress updates at various completion levels
- Timeline events tracking lifecycle
- Descriptive locations only (never fabricated project coordinates)

Usage:
    cd backend
    python -m scripts.seed_works

Requires MONGODB_URI and MONGODB_DB_NAME in backend/.env
"""

import asyncio
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

# Ensure the backend app package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import get_settings
from app.core.database import Database


# ── Realistic data pools ─────────────────────────────────────────

STATES = [
    {"code": "MH", "name": "Maharashtra", "districts": [
        {"code": "MH-MUM", "name": "Mumbai", "lat": 19.076, "lng": 72.8777},
        {"code": "MH-PUN", "name": "Pune", "lat": 18.5204, "lng": 73.8567},
        {"code": "MH-NAG", "name": "Nagpur", "lat": 21.1458, "lng": 79.0882},
    ]},
    {"code": "UP", "name": "Uttar Pradesh", "districts": [
        {"code": "UP-LKO", "name": "Lucknow", "lat": 26.8467, "lng": 80.9462},
        {"code": "UP-VNS", "name": "Varanasi", "lat": 25.3176, "lng": 82.9739},
        {"code": "UP-AGR", "name": "Agra", "lat": 27.1767, "lng": 78.0081},
    ]},
    {"code": "KA", "name": "Karnataka", "districts": [
        {"code": "KA-BLR", "name": "Bengaluru Urban", "lat": 12.9716, "lng": 77.5946},
        {"code": "KA-MYS", "name": "Mysuru", "lat": 12.2958, "lng": 76.6394},
    ]},
    {"code": "TN", "name": "Tamil Nadu", "districts": [
        {"code": "TN-CHN", "name": "Chennai", "lat": 13.0827, "lng": 80.2707},
        {"code": "TN-CBE", "name": "Coimbatore", "lat": 11.0168, "lng": 76.9558},
    ]},
    {"code": "RJ", "name": "Rajasthan", "districts": [
        {"code": "RJ-JPR", "name": "Jaipur", "lat": 26.9124, "lng": 75.7873},
        {"code": "RJ-JDH", "name": "Jodhpur", "lat": 26.2389, "lng": 73.0243},
    ]},
    {"code": "WB", "name": "West Bengal", "districts": [
        {"code": "WB-KOL", "name": "Kolkata", "lat": 22.5726, "lng": 88.3639},
    ]},
    {"code": "GJ", "name": "Gujarat", "districts": [
        {"code": "GJ-AHM", "name": "Ahmedabad", "lat": 23.0225, "lng": 72.5714},
        {"code": "GJ-SUR", "name": "Surat", "lat": 21.1702, "lng": 72.8311},
    ]},
]

CONSTITUENCIES = [
    "Mumbai North", "Mumbai South", "Pune", "Nagpur", "Lucknow",
    "Varanasi", "Agra", "Bengaluru South", "Bengaluru North", "Mysuru",
    "Chennai South", "Chennai Central", "Coimbatore", "Jaipur",
    "Jodhpur", "Kolkata North", "Ahmedabad East", "Surat",
]

MP_NAMES = [
    "Shri Rajesh Kumar", "Smt. Priya Sharma", "Dr. Arun Patel",
    "Shri Vikram Singh", "Smt. Meena Devi", "Shri Suresh Reddy",
    "Dr. Kavitha Nair", "Shri Mahesh Yadav", "Smt. Anita Mishra",
    "Shri Deepak Chowdhury", "Smt. Lakshmi Rao", "Shri Ramesh Gupta",
    "Dr. Sunita Kumari", "Shri Ashok Joshi", "Smt. Rekha Patil",
]

AGENCIES = [
    "Public Works Department (PWD)",
    "Zilla Parishad",
    "Municipal Corporation",
    "District Rural Development Agency (DRDA)",
    "State Public Health Engineering Department",
    "State Education Department",
    "District Urban Development Authority",
    "Cantonment Board",
    "Tribal Development Department",
    "Block Development Office",
]

WORKS_DATA = [
    {
        "title": "Construction of Community Health Centre",
        "description": "Construction of a 30-bed community health centre with OPD, emergency ward, pharmacy, and diagnostic laboratory to serve 5 surrounding villages.",
        "category": "healthcare",
        "sub_category": "Primary Health Centre",
    },
    {
        "title": "Construction of School Building with Computer Lab",
        "description": "Two-storey school building with 12 classrooms, a computer lab with 30 desktops, library, and sports equipment room for Government Senior Secondary School.",
        "category": "education",
        "sub_category": "School Infrastructure",
    },
    {
        "title": "Installation of Solar-Powered Water Purification Plant",
        "description": "Installation of a 5000-litre/hour RO water purification plant powered by solar panels to provide clean drinking water to 3 wards.",
        "category": "drinking_water",
        "sub_category": "Water Treatment",
    },
    {
        "title": "Repair and Widening of Arterial Road",
        "description": "Widening of the 4.5 km arterial road from 12m to 18m width with proper drainage, footpaths, street lighting, and road markings.",
        "category": "roads_and_bridges",
        "sub_category": "Road Widening",
    },
    {
        "title": "Construction of Sports Complex with Indoor Stadium",
        "description": "Multi-sport complex with indoor badminton courts, gymnasium, swimming pool, and an outdoor 400m athletics track.",
        "category": "sports",
        "sub_category": "Sports Complex",
    },
    {
        "title": "Community Toilet and Sanitation Block",
        "description": "Construction of 20-seat community sanitation block with separate facilities for men and women, including disabled-accessible stalls.",
        "category": "sanitation",
        "sub_category": "Community Sanitation",
    },
    {
        "title": "Construction of Community Hall and Library",
        "description": "Multi-purpose community hall with 500-seat auditorium, public library with reading room, and conference facilities.",
        "category": "community_infrastructure",
        "sub_category": "Community Centre",
    },
    {
        "title": "Installation of LED Street Lighting System",
        "description": "Installation of 250 smart LED street lights with solar panels along main roads and residential areas in 4 wards.",
        "category": "electricity",
        "sub_category": "Street Lighting",
    },
    {
        "title": "Construction of Check Dam for Irrigation",
        "description": "Masonry check dam across seasonal river to create 15 hectare-metre water storage for irrigation of 200 acres of farmland.",
        "category": "irrigation",
        "sub_category": "Check Dam",
    },
    {
        "title": "Upgradation of Primary Health Sub-Centre",
        "description": "Renovation and equipment upgrade of existing health sub-centre with telemedicine facility, cold storage, and ambulance parking.",
        "category": "healthcare",
        "sub_category": "Health Sub-Centre",
    },
    {
        "title": "Construction of Pedestrian Bridge over Railway Crossing",
        "description": "Steel and concrete foot-over bridge at an unmanned railway crossing used by 2000+ pedestrians daily.",
        "category": "roads_and_bridges",
        "sub_category": "Pedestrian Bridge",
    },
    {
        "title": "Construction of Anganwadi Centre",
        "description": "Purpose-built Anganwadi centre with play area, kitchen, storage, and separate immunization room for children aged 0-6.",
        "category": "education",
        "sub_category": "Anganwadi",
    },
    {
        "title": "Rainwater Harvesting System for Government School",
        "description": "Rooftop rainwater harvesting system with 50,000 litre underground storage tank for the government school campus.",
        "category": "drinking_water",
        "sub_category": "Rainwater Harvesting",
    },
    {
        "title": "Construction of Open Gymnasium in Park",
        "description": "Installation of open-air gymnasium equipment, walking track, and seating area in the municipal park.",
        "category": "sports",
        "sub_category": "Open Gymnasium",
    },
    {
        "title": "Drainage Improvement and Sewage Treatment",
        "description": "Laying of 3 km underground drainage pipeline and construction of a 2 MLD sewage treatment plant.",
        "category": "sanitation",
        "sub_category": "Drainage & Sewage",
    },
    {
        "title": "Construction of Skill Development Training Centre",
        "description": "Training centre with workshops for electrician, plumber, carpenter, and computer courses with capacity for 100 trainees.",
        "category": "community_infrastructure",
        "sub_category": "Skill Development",
    },
    {
        "title": "Installation of Solar Microgrids for Tribal Hamlets",
        "description": "Off-grid solar microgrids providing 24/7 electricity to 5 remote tribal hamlets with 150 households.",
        "category": "electricity",
        "sub_category": "Solar Microgrid",
    },
    {
        "title": "Canal Lining for Irrigation Efficiency",
        "description": "Concrete lining of 2.5 km irrigation canal to reduce seepage loss and improve water delivery to 500 acres.",
        "category": "irrigation",
        "sub_category": "Canal Lining",
    },
    {
        "title": "Construction of Bus Shelter and Waiting Area",
        "description": "Construction of 10 bus shelters with seating, information displays, and rain protection along state highway.",
        "category": "community_infrastructure",
        "sub_category": "Bus Shelter",
    },
    {
        "title": "Boundary Wall and Renovation of Government Hospital",
        "description": "Construction of boundary wall, internal road, parking area, and renovation of ward blocks at district government hospital.",
        "category": "healthcare",
        "sub_category": "Hospital Renovation",
    },
]

STATUSES_WITH_WEIGHTS = [
    ("recommended", 2),
    ("under_review", 2),
    ("sanctioned", 2),
    ("in_progress", 5),
    ("on_hold", 1),
    ("completed", 4),
    ("under_verification", 2),
    ("cancelled", 1),
]


def _random_date(start_days_ago: int, end_days_ago: int) -> datetime:
    """Generate a random datetime between start_days_ago and end_days_ago before now."""
    start = datetime.now(timezone.utc) - timedelta(days=start_days_ago)
    end = datetime.now(timezone.utc) - timedelta(days=end_days_ago)
    delta = end - start
    random_seconds = random.randint(0, max(1, int(delta.total_seconds())))
    return start + timedelta(seconds=random_seconds)


def _generate_timeline(status: str, recommended_date: datetime) -> list[dict]:
    """Generate realistic timeline events based on current status."""
    status_sequence = [
        "recommended", "under_review", "sanctioned",
        "in_progress", "on_hold", "completed",
        "under_verification", "cancelled",
    ]

    # Determine which statuses this work has been through
    if status == "cancelled":
        progress_statuses = ["recommended", "under_review", "cancelled"]
    elif status == "on_hold":
        progress_statuses = ["recommended", "under_review", "sanctioned", "in_progress", "on_hold"]
    else:
        idx = status_sequence.index(status)
        progress_statuses = status_sequence[:idx + 1]
        # Remove on_hold from progression unless the status is on_hold
        progress_statuses = [s for s in progress_statuses if s != "on_hold"]

    events = []
    current_date = recommended_date

    status_titles = {
        "recommended": "Work Recommended",
        "under_review": "Work Submitted for Review",
        "sanctioned": "Work Sanctioned",
        "in_progress": "Work Commenced",
        "on_hold": "Work Put On Hold",
        "completed": "Work Completed",
        "under_verification": "Submitted for Verification",
        "cancelled": "Work Cancelled",
    }

    for s in progress_statuses:
        events.append({
            "event_id": str(uuid4()),
            "timestamp": current_date.isoformat(),
            "event_type": "status_change",
            "title": status_titles.get(s, f"Status: {s}"),
            "description": f"Work status changed to {s}.",
            "actor": random.choice(MP_NAMES),
        })
        current_date += timedelta(days=random.randint(7, 60))

    return events


def _generate_tranches(status: str, sanctioned_amount: float) -> tuple[list[dict], float]:
    """Generate payment tranches based on status and sanctioned amount."""
    tranches = []
    total_released = 0.0

    if status in ("recommended", "under_review"):
        return tranches, total_released

    # First tranche on sanction (typically 50%)
    if status in ("sanctioned", "in_progress", "on_hold", "completed", "under_verification"):
        first_amount = round(sanctioned_amount * 0.5, 2)
        tranches.append({
            "tranche_id": str(uuid4()),
            "tranche_number": 1,
            "amount": first_amount,
            "released_date": _random_date(300, 180).isoformat(),
            "purpose": "Initial sanction — 50% of estimated cost",
            "released_by": "District Authority",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        total_released += first_amount

    # Second tranche for in-progress or later
    if status in ("in_progress", "on_hold", "completed", "under_verification"):
        second_amount = round(sanctioned_amount * 0.3, 2)
        tranches.append({
            "tranche_id": str(uuid4()),
            "tranche_number": 2,
            "amount": second_amount,
            "released_date": _random_date(180, 90).isoformat(),
            "purpose": "Second instalment — 30% on progress certification",
            "released_by": "District Authority",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        total_released += second_amount

    # Final tranche for completed works
    if status in ("completed", "under_verification"):
        third_amount = round(sanctioned_amount * 0.2, 2)
        tranches.append({
            "tranche_id": str(uuid4()),
            "tranche_number": 3,
            "amount": third_amount,
            "released_date": _random_date(60, 10).isoformat(),
            "purpose": "Final instalment — 20% on completion certificate",
            "released_by": "District Authority",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        total_released += third_amount

    return tranches, total_released


def _generate_progress_updates(status: str) -> tuple[list[dict], float]:
    """Generate progress updates based on status."""
    updates = []
    pct = 0.0

    progress_map = {
        "recommended": [],
        "under_review": [],
        "sanctioned": [(5, "Site survey completed")],
        "in_progress": [
            (10, "Foundation work initiated"),
            (25, "Foundation completed, superstructure started"),
            (45, "Superstructure 50% complete"),
            (60, "Roof casting completed"),
        ],
        "on_hold": [
            (10, "Foundation work initiated"),
            (30, "Foundation completed, work halted due to monsoon"),
        ],
        "completed": [
            (10, "Foundation work initiated"),
            (30, "Foundation and plinth completed"),
            (55, "Superstructure completed"),
            (75, "Finishing work in progress"),
            (90, "Painting and electrical work completed"),
            (100, "Work completed and handed over"),
        ],
        "under_verification": [
            (10, "Foundation work initiated"),
            (40, "Superstructure completed"),
            (70, "Finishing work completed"),
            (95, "Work substantially completed"),
            (100, "Work completed, submitted for verification"),
        ],
        "cancelled": [
            (5, "Site survey completed"),
        ],
    }

    entries = progress_map.get(status, [])
    base_date = _random_date(400, 300)

    for progress_pct, desc in entries:
        base_date += timedelta(days=random.randint(15, 45))
        updates.append({
            "update_id": str(uuid4()),
            "date": base_date.isoformat(),
            "physical_progress_pct": progress_pct,
            "description": desc,
            "updated_by": random.choice(AGENCIES),
            "attachments": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        pct = progress_pct

    return updates, pct


def generate_works() -> list[dict]:
    """Generate ~20 realistic work documents."""
    works = []
    statuses_pool = []
    for status, weight in STATUSES_WITH_WEIGHTS:
        statuses_pool.extend([status] * weight)

    for i, work_data in enumerate(WORKS_DATA):
        status = statuses_pool[i % len(statuses_pool)]
        # Reserve one predictable jurisdiction so the documented local demo
        # can always pair its District Authority and Inspector accounts with a
        # seeded work. Remaining records retain varied synthetic coverage.
        if i == 0:
            state = next(item for item in STATES if item["code"] == "UP")
            district = next(item for item in state["districts"] if item["code"] == "UP-LKO")
        else:
            state = random.choice(STATES)
            district = random.choice(state["districts"])
        constituency = random.choice(CONSTITUENCIES)
        mp_name = random.choice(MP_NAMES)
        agency = random.choice(AGENCIES)

        sanctioned_amount = round(random.uniform(500000, 25000000), 2)
        recommended_date = _random_date(500, 350)

        tranches, funds_released = _generate_tranches(status, sanctioned_amount)
        progress_updates, physical_progress_pct = _generate_progress_updates(status)
        timeline = _generate_timeline(status, recommended_date)

        # Calculate expenditure (slightly less than released)
        if funds_released > 0:
            actual_expenditure = round(funds_released * random.uniform(0.7, 0.98), 2)
        else:
            actual_expenditure = 0.0

        # Dates based on status
        sanctioned_date = None
        start_date = None
        expected_completion = None
        actual_completion = None

        if status not in ("recommended", "under_review"):
            sanctioned_date = (recommended_date + timedelta(days=random.randint(30, 90))).isoformat()
        if status in ("in_progress", "on_hold", "completed", "under_verification"):
            start_date = (recommended_date + timedelta(days=random.randint(60, 150))).isoformat()
            expected_completion = (recommended_date + timedelta(days=random.randint(300, 600))).isoformat()
        if status in ("completed", "under_verification"):
            actual_completion = (recommended_date + timedelta(days=random.randint(350, 550))).isoformat()

        work = {
            "work_id": str(uuid4()),
            "title": work_data["title"],
            "description": work_data["description"],
            "status": status,
            "category": work_data["category"],
            "sub_category": work_data.get("sub_category", ""),
            "state_code": state["code"],
            "state_name": state["name"],
            "district_code": district["code"],
            "district_name": district["name"],
            "constituency": constituency,
            "mp_name": mp_name,
            "mp_id": None,
            "implementing_agency": agency,
            "sanctioned_amount": sanctioned_amount,
            "funds_released": funds_released,
            "actual_expenditure": actual_expenditure,
            "recommended_date": recommended_date.isoformat(),
            "sanctioned_date": sanctioned_date,
            "start_date": start_date,
            "expected_completion_date": expected_completion,
            "actual_completion_date": actual_completion,
            "physical_progress_pct": physical_progress_pct,
            # District-centre jitter would look like a precise work-site pin.
            # Keep the synthetic demo useful for workflow tests without
            # manufacturing coordinates for the primary project map.
            "location": {
                "latitude": None,
                "longitude": None,
                "address": f"{district['name']} district (synthetic demo location)",
            },
            "composite_risk_score": None,
            "risk_tier": None,
            "payment_tranches": tranches,
            "progress_updates": progress_updates,
            "timeline": timeline,
            "data_source": "synthetic_demo",
            "created_by": "seed_script",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        works.append(work)

    return works


async def main():
    settings = get_settings()
    db = Database(settings)
    await db.connect()

    collection = db.get_collection("works")

    # This script is deliberately non-destructive.  It creates controlled
    # synthetic demo records only in an empty collection; it never drops,
    # resets, or mixes with an operator's existing work records.
    existing = await collection.count_documents({})
    if existing > 0:
        print(
            f"No records changed: found {existing} existing works. "
            "Seed only an empty demo database."
        )
        await db.disconnect()
        return

    works = generate_works()
    await collection.insert_many(works)

    print(f"✓  Seeded {len(works)} MPLADS works into '{settings.MONGODB_DB_NAME}.works'")

    # Show summary by status
    pipeline = [
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    async for doc in collection.aggregate(pipeline):
        print(f"   {doc['_id']:25s} → {doc['count']}")

    await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
