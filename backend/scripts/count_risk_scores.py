import asyncio
from app.core.config import get_settings
from app.core.database import Database

async def test():
    db = Database(get_settings())
    await db.connect()
    c = await db.get_collection('risk_scores').count_documents({})
    cases = await db.get_collection('cases').count_documents({})
    issues = await db.get_collection('citizen_issues').count_documents({})
    print(f"Current risk scores: {c}/1578 | Cases: {cases} | Citizen issues: {issues}")
    await db.disconnect()

if __name__ == '__main__':
    asyncio.run(test())
