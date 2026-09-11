import asyncio
from app.core.config import get_settings
from app.core.database import Database
from app.core.security import hash_password

async def main():
    settings = get_settings()
    db = Database(settings)
    await db.connect()
    
    # Compute one hash for "Password@123"
    target_pw = "Password@123"
    hp = hash_password(target_pw)
    print(f"Generated hash for '{target_pw}': {hp[:20]}...")
    
    res = await db.get_collection("users").update_many(
        {},
        {"$set": {
            "hashed_password": hp,
            "is_active": True,
            "must_change_password": False,
        }}
    )
    print(f"Updated {res.modified_count} users to password: '{target_pw}'")
    
    # Verify by listing all users
    users = await db.get_collection("users").find({}, {"_id": 0, "email": 1, "role": 1}).to_list(length=20)
    for u in users:
        print(f"  {u['email']:35s} | role: {u['role']:20s} | password: '{target_pw}'")
        
    await db.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
