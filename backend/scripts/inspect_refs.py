import asyncio
from app.core.config import get_settings
from app.core.database import Database

async def test():
    db = Database(get_settings())
    await db.connect()
    s = await db.get_collection('ref_states').find_one({}, {'_id': 0})
    d = await db.get_collection('ref_districts').find_one({}, {'_id': 0})
    c = await db.get_collection('ref_constituencies').find_one({}, {'_id': 0})
    print('State:', s)
    print('District:', d)
    print('Constituency:', c)
    await db.disconnect()

if __name__ == '__main__':
    asyncio.run(test())
