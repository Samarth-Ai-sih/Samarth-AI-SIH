import asyncio
from app.core.config import get_settings
from app.core.database import Database

async def test():
    db = Database(get_settings())
    await db.connect()
    col = db.get_collection('works')
    
    # State counts
    pipeline = [
        {"$group": {"_id": "$state_code", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}
    ]
    states = await col.aggregate(pipeline).to_list(length=50)
    print("Top states in works:")
    for s in states[:10]:
        print(f"  {s['_id']}: {s['count']}")
        
    # Check UP districts
    pipeline_dist = [
        {"$match": {"state_code": "UP"}},
        {"$group": {"_id": "$district_code", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}
    ]
    dists = await col.aggregate(pipeline_dist).to_list(length=50)
    print("\nDistricts in UP:")
    for d in dists:
        print(f"  {d['_id']}: {d['count']}")

    # Check UP constituencies
    pipeline_const = [
        {"$match": {"state_code": "UP"}},
        {"$group": {"_id": "$constituency", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}
    ]
    consts = await col.aggregate(pipeline_const).to_list(length=50)
    print("\nConstituencies in UP:")
    for c in consts:
        print(f"  {c['_id']}: {c['count']}")

    await db.disconnect()

if __name__ == '__main__':
    asyncio.run(test())
