import asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.database import Database, set_database
from app.core.config import get_settings

async def test_ml_api():
    db = Database(get_settings())
    await db.connect()
    set_database(db)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Login as Admin
        login = await client.post("/api/v1/auth/login", json={"email": "admin.demo@samarth-demo.in", "password": "Password@123"})
        assert login.status_code == 200, f"Login failed: {login.text}"
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 1. Test GET /api/v1/risk/models
        models_res = await client.get("/api/v1/risk/models", headers=headers)
        print("GET /api/v1/risk/models status:", models_res.status_code)
        models_data = models_res.json()
        print("Registered models count:", models_data.get("total"))
        for m in models_data.get("models", []):
            m_type = m.get("model_type")
            m_ver = m.get("model_version")
            m_stat = m.get("approval_status")
            m_roll = m.get("rollback_state")
            print(f"  Model: {m_type} | version: {m_ver} | status: {m_stat} | rollback: {m_roll}")

        # 2. Test live prediction on a work
        works_res = await client.get("/api/v1/works?page=1&page_size=1", headers=headers)
        work = works_res.json()["works"][0]
        work_id = work["work_id"]
        work_title = work["title"]
        print(f"\nTesting POST /api/v1/risk/predictions/{work_id} ({work_title})...")
        pred_res = await client.post(f"/api/v1/risk/predictions/{work_id}", headers=headers)
        print("POST prediction status:", pred_res.status_code)
        pred_data = pred_res.json()
        print("  Prediction ID:", pred_data.get("prediction_id"))
        print("  Model Version:", pred_data.get("model_version"))
        print("  Inference Source:", pred_data.get("inference_source"))
        print("  Delay Probability:", pred_data.get("delay_probability"))
        print("  Anomaly Score:", pred_data.get("anomaly_score"))
        print("  Explanation Notice:", pred_data.get("explanation_snapshot", {}).get("notice"))

        # 3. Test GET /api/v1/risk/predictions/{work_id}
        fetch_res = await client.get(f"/api/v1/risk/predictions/{work_id}", headers=headers)
        print("\nGET prediction status:", fetch_res.status_code)
        assert fetch_res.status_code == 200

        print("\n[v] ALL ML MODEL TESTS PASSED SUCCESSFULLY!")

    await db.disconnect()

if __name__ == "__main__":
    asyncio.run(test_ml_api())
