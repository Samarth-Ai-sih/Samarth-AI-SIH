import asyncio
from app.core.config import get_settings
from app.core.database import Database

async def check():
    db = Database(get_settings())
    await db.connect()

    # List all collections with counts
    mongo_db = db._db
    collections = await mongo_db.list_collection_names()
    collections.sort()
    print("=" * 60)
    print("  MONGODB COLLECTIONS")
    print("=" * 60)
    total = 0
    for name in collections:
        count = await mongo_db[name].count_documents({})
        total += count
        print(f"  {name:35s}  {count:>6,}")
    print(f"  {'TOTAL':35s}  {total:>6,}")
    print()

    # Check users
    users_coll = db.get_collection("users")
    users = await users_coll.find({}, {"_id": 0, "email": 1, "role": 1, "full_name": 1, "is_active": 1, "jurisdiction": 1}).to_list(length=100)
    print("=" * 60)
    print("  USERS")
    print("=" * 60)
    for u in users:
        j = u.get("jurisdiction", {})
        scope = str(j.get("scope") or "n/a") if j else "n/a"
        state = str(j.get("state_code") or "") if j else ""
        dist = str(j.get("district_code") or "") if j else ""
        print(f"  {str(u.get('email','?')):30s}  role={str(u.get('role','?')):20s}  scope={scope:12s}  state={state:4s}  dist={dist}")
    if not users:
        print("  (no users found)")
    print()

    # Check works sample
    works_coll = db.get_collection("works")
    sample = await works_coll.find_one({}, {"_id": 0, "work_id": 1, "title": 1, "status": 1, "state_code": 1, "district_code": 1, "constituency": 1})
    print("=" * 60)
    print("  SAMPLE WORK RECORD")
    print("=" * 60)
    if sample:
        for k, v in sample.items():
            print(f"  {k}: {v}")
    else:
        print("  (no works found)")

    await db.disconnect()

asyncio.run(check())
