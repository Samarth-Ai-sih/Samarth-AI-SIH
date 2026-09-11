import asyncio
from app.core.config import get_settings
from app.core.database import Database
from app.core.security import verify_password, hash_password

async def test():
    db = Database(get_settings())
    await db.connect()
    users = await db.get_collection('users').find({}).to_list(length=20)
    passwords_to_try = [
        "Admin@1234dev",
        "Password@123",
        "Password123!",
        "admin123",
        "Samarth@123",
        "Samarth@2026",
        "demo1234",
    ]
    for u in users:
        print(f"\nUser: {u['email']} ({u['role']})")
        matched = False
        for p in passwords_to_try:
            if verify_password(p, u['hashed_password']):
                print(f"  MATCH: '{p}'")
                matched = True
                break
        if not matched:
            print("  NO MATCH in test list. Resetting password to 'Password@123'...")
            await db.get_collection('users').update_one(
                {"email": u["email"]},
                {"$set": {"hashed_password": hash_password("Password@123"), "is_active": True}}
            )
            print("  Reset to 'Password@123' successfully.")

    await db.disconnect()

if __name__ == '__main__':
    asyncio.run(test())
