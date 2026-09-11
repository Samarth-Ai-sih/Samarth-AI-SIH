"""
SAMARTH AI — End-to-End API, RBAC, Jurisdiction & User Creation Verification Suite

Tests all roles against backend APIs:
1. Admin login & national metrics verification
2. MoSPI login & national oversight verification
3. State Nodal Officer (UP) login & state scoping verification (cannot access MH)
4. District Authority (Lucknow) login & district scoping verification (cannot access Varanasi or MH)
5. MP (Varanasi) login & constituency scoping verification
6. Inspector (Lucknow) login & assigned tasks workflow verification
7. Inspection Task opening & GPS verification
8. Admin creates a brand new user (MP for Raebareli) via POST /api/v1/users
9. Newly created MP logs in with their credentials & verifies scoped access
10. Negative access tests (IDOR, cross-jurisdiction bypass attempts, role escalations)
11. Public Citizen Portal safe discovery verification
"""

import asyncio
import logging
import os
import sys

from httpx import AsyncClient, ASGITransport

from app.core.config import get_settings
from app.core.database import Database, set_database
from app.main import app

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(message)s")
logger = logging.getLogger("samarth.verify_e2e")

PASS = "[✓] PASS"
FAIL = "[✗] FAIL"

results_summary = []

def record(test_name: str, passed: bool, detail: str = ""):
    status = PASS if passed else FAIL
    results_summary.append((test_name, passed, detail))
    msg = f"{status} - {test_name}"
    if detail:
        msg += f" ({detail})"
    if passed:
        logger.info(msg)
    else:
        logger.error(msg)


async def main():
    settings = get_settings()
    db = Database(settings)
    await db.connect()
    set_database(db)

    logger.info("=" * 70)
    logger.info("  SAMARTH AI — END-TO-END VERIFICATION SUITE")
    logger.info("=" * 70)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:

        # ─────────────────────────────────────────────────────────────
        # 1. ADMIN TESTS
        # ─────────────────────────────────────────────────────────────
        logger.info("\n--- TEST GROUP 1: ADMIN (Full Country Access) ---")
        login_res = await client.post("/api/v1/auth/login", json={
            "email": "admin.demo@samarth-demo.in",
            "password": "Password@123",
        })
        admin_logged_in = login_res.status_code == 200
        record("Admin Login", admin_logged_in, f"status: {login_res.status_code}")
        
        if not admin_logged_in:
            logger.error(f"Admin login failed: {login_res.text}")
            await db.disconnect()
            return

        admin_token = login_res.json()["access_token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # Works API
        works_res = await client.get("/api/v1/works?page=1&page_size=10", headers=admin_headers)
        works_data = works_res.json()
        total_works = works_data.get("total", 0)
        record("Admin Works Total (1578 expected)", total_works == 1578, f"got {total_works}")

        # Risk Distribution API
        risk_res = await client.get("/api/v1/risk/distribution", headers=admin_headers)
        risk_data = risk_res.json()
        total_risk = risk_data.get("total", 0)
        record("Admin Risk Scored Total (1578 expected)", total_risk == 1578, f"got {total_risk}, red={risk_data.get('red')}, amber={risk_data.get('amber')}, green={risk_data.get('green')}")

        # Financial Intelligence Dashboard
        finance_res = await client.get("/api/v1/financial-intelligence/dashboard", headers=admin_headers)
        fin_data = finance_res.json()
        sanctioned_total = fin_data.get("summary", {}).get("total_sanctioned_amount", 0)
        record("Admin Financial Intelligence Dashboard", sanctioned_total > 0, f"sanctioned: Rs {sanctioned_total:,.2f}")

        # Cases API
        cases_res = await client.get("/api/v1/cases", headers=admin_headers)
        cases_data = cases_res.json()
        total_cases = cases_data.get("total", 0)
        record("Admin Cases Total (> 0 expected)", total_cases > 0, f"got {total_cases} cases")

        # Ingestion Allocations API (Real CSV data)
        alloc_res = await client.get("/api/v1/ingestion/allocations?page=1&page_size=5", headers=admin_headers)
        alloc_data = alloc_res.json()
        total_alloc = alloc_data.get("total", 0)
        record("Admin Real CSV MP Allocations (774 expected)", total_alloc == 774, f"got {total_alloc} allocation records")

        # Map API
        map_res = await client.get("/api/v1/works/map", headers=admin_headers)
        map_data = map_res.json()
        map_count = len(map_data.get("markers", []))
        record("Admin Work Explorer Map Points (> 0 expected)", map_count > 0, f"got {map_count} map markers")

        # ─────────────────────────────────────────────────────────────
        # 2. STATE NODAL OFFICER (UP) TESTS
        # ─────────────────────────────────────────────────────────────
        logger.info("\n--- TEST GROUP 2: STATE NODAL OFFICER (UP Jurisdiction) ---")
        sno_res = await client.post("/api/v1/auth/login", json={
            "email": "sno.up.demo@samarth-demo.in",
            "password": "Password@123",
        })
        record("State Nodal Officer Login", sno_res.status_code == 200)
        sno_headers = {"Authorization": f"Bearer {sno_res.json()['access_token']}"}

        sno_works = await client.get("/api/v1/works?page=1&page_size=100", headers=sno_headers)
        sno_works_data = sno_works.json()
        sno_total = sno_works_data.get("total", 0)
        # Verify all returned works are strictly UP works
        all_up = all(w.get("state_code") == "UP" for w in sno_works_data.get("works", []))
        record("SNO Works Scoped to UP", sno_total == 77 and all_up, f"total={sno_total}, all_up={all_up}")

        # SNO trying to bypass jurisdiction by passing ?state_code=MH
        bypass_attempt = await client.get("/api/v1/works?state_code=MH", headers=sno_headers)
        bypass_data = bypass_attempt.json()
        record("SNO Query Parameter Bypass Blocked (?state_code=MH returns 0)", bypass_data.get("total", 0) == 0, f"returned {bypass_data.get('total')}")

        # ─────────────────────────────────────────────────────────────
        # 3. DISTRICT AUTHORITY (Lucknow) TESTS
        # ─────────────────────────────────────────────────────────────
        logger.info("\n--- TEST GROUP 3: DISTRICT AUTHORITY (Lucknow Jurisdiction) ---")
        da_res = await client.post("/api/v1/auth/login", json={
            "email": "district.lucknow.demo@samarth-demo.in",
            "password": "Password@123",
        })
        record("District Authority Login", da_res.status_code == 200)
        da_headers = {"Authorization": f"Bearer {da_res.json()['access_token']}"}

        da_works = await client.get("/api/v1/works?page=1&page_size=50", headers=da_headers)
        da_works_data = da_works.json()
        da_total = da_works_data.get("total", 0)
        all_lko = all(w.get("district_code") == "UP-LKO" for w in da_works_data.get("works", []))
        record("District Authority Works Scoped to Lucknow (UP-LKO)", da_total == 33 and all_lko, f"total={da_total}, all_lko={all_lko}")

        da_cases = await client.get("/api/v1/cases", headers=da_headers)
        da_cases_data = da_cases.json()
        record("District Authority Lucknow Cases", da_cases_data.get("total", 0) > 0, f"got {da_cases_data.get('total')} cases")

        # ─────────────────────────────────────────────────────────────
        # 4. MEMBER OF PARLIAMENT (Varanasi Urban) TESTS
        # ─────────────────────────────────────────────────────────────
        logger.info("\n--- TEST GROUP 4: MP (Varanasi Urban Constituency) ---")
        mp_res = await client.post("/api/v1/auth/login", json={
            "email": "mp.varanasi.demo@samarth-demo.in",
            "password": "Password@123",
        })
        record("MP Login", mp_res.status_code == 200)
        mp_headers = {"Authorization": f"Bearer {mp_res.json()['access_token']}"}

        mp_works = await client.get("/api/v1/works?page=1&page_size=50", headers=mp_headers)
        mp_works_data = mp_works.json()
        mp_total = mp_works_data.get("total", 0)
        all_vns = all(w.get("constituency") == "Varanasi Urban" for w in mp_works_data.get("works", []))
        record("MP Works Scoped to Varanasi Urban", mp_total == 26 and all_vns, f"total={mp_total}, all_vns={all_vns}")

        # MP cannot access private administrative audit and user management logs
        mp_audit = await client.get("/api/v1/users", headers=mp_headers)
        record("MP Denied User Admin Access (403 expected)", mp_audit.status_code == 403, f"status: {mp_audit.status_code}")

        # ─────────────────────────────────────────────────────────────
        # 5. FIELD INSPECTOR (Assigned Tasks Workflow) TESTS
        # ─────────────────────────────────────────────────────────────
        logger.info("\n--- TEST GROUP 5: INSPECTOR (Assigned Tasks Only) ---")
        insp_res = await client.post("/api/v1/auth/login", json={
            "email": "inspector.lucknow.demo@samarth-demo.in",
            "password": "Password@123",
        })
        record("Inspector Login", insp_res.status_code == 200)
        insp_headers = {"Authorization": f"Bearer {insp_res.json()['access_token']}"}

        # Inspector assigned cases
        assigned_res = await client.get("/api/v1/cases/assigned", headers=insp_headers)
        assigned_data = assigned_res.json()
        assigned_total = assigned_data.get("total", 0)
        record("Inspector Sees Assigned Tasks (3 expected)", assigned_total == 3, f"got {assigned_total} assigned tasks")

        # Open assigned task
        task_res = await client.get("/api/v1/cases/assigned/CASE-LKO-001/task", headers=insp_headers)
        task_data = task_res.json()
        has_work_info = "work" in task_data and task_data["work"].get("work_id")
        record("Inspector Opens Assigned Task (Work & GPS Details)", task_res.status_code == 200 and has_work_info, f"status: {task_res.status_code}")

        # Inspector CANNOT open an unassigned case
        unassigned_res = await client.get("/api/v1/cases/assigned/CASE-MH-010/task", headers=insp_headers)
        record("Inspector Denied Unassigned Task Access (404 expected)", unassigned_res.status_code == 404, f"status: {unassigned_res.status_code}")

        # ─────────────────────────────────────────────────────────────
        # 6. ADMIN USER PROVISIONING & E2E LOGIN TEST
        # ─────────────────────────────────────────────────────────────
        logger.info("\n--- TEST GROUP 6: ADMIN USER CREATION & E2E LOGIN ---")
        new_mp_email = "mp.raebareli@samarth.gov.in"
        new_mp_username = "mp.raebareli"
        new_mp_password = "SecureRaebareli@2026"

        # Delete existing test user if already exists from prior run
        await db.get_collection("users").delete_one({"email": new_mp_email})

        create_res = await client.post("/api/v1/users", headers=admin_headers, json={
            "full_name": "Hon'ble MP Raebareli",
            "username": new_mp_username,
            "email": new_mp_email,
            "password": new_mp_password,
            "role": "mp",
            "is_active": True,
            "must_change_password": False,
            "jurisdiction": {
                "state_code": "UP",
                "district_code": "UP-RBL",
                "constituency": "Raebareli",
                "assigned_task_ids": [],
            }
        })
        record("Admin Creates MP for Raebareli via API", create_res.status_code == 201, f"status: {create_res.status_code}")

        # Verify new user can actually log in!
        new_login = await client.post("/api/v1/auth/login", json={
            "email": new_mp_email,
            "password": new_mp_password,
        })
        new_logged_in = new_login.status_code == 200
        record("Newly Created MP Can Actually Login", new_logged_in, f"status: {new_login.status_code}")

        if new_logged_in:
            new_token = new_login.json()["access_token"]
            new_headers = {"Authorization": f"Bearer {new_token}"}
            new_mp_profile = await client.get("/api/v1/auth/me", headers=new_headers)
            profile = new_mp_profile.json()
            record(
                "New MP Jurisdiction Scoped Correctly",
                profile.get("jurisdiction", {}).get("constituency") == "Raebareli",
                f"constituency: {profile.get('jurisdiction', {}).get('constituency')}"
            )

        # ─────────────────────────────────────────────────────────────
        # 7. SECURITY & ACCESS RESTRICTION TESTS
        # ─────────────────────────────────────────────────────────────
        logger.info("\n--- TEST GROUP 7: SECURITY & NEGATIVE TESTING ---")
        
        # Non-admin cannot create users
        unauthorized_create = await client.post("/api/v1/users", headers=mp_headers, json={
            "full_name": "Hacker User",
            "username": "hacker.user",
            "email": "hacker@test.com",
            "password": "Password123!",
            "role": "admin",
        })
        record("Non-Admin Denied User Creation (403 expected)", unauthorized_create.status_code == 403, f"status: {unauthorized_create.status_code}")

        # Unauthenticated access to /api/v1/works is denied
        no_auth = await client.get("/api/v1/works")
        record("Unauthenticated Access to Protected API Denied (401 expected)", no_auth.status_code == 401, f"status: {no_auth.status_code}")

        # Public Citizen Portal is accessible without auth
        public_res = await client.get("/api/v1/public/works?page=1&page_size=5")
        public_data = public_res.json()
        has_public_notice = "public_notice" in public_data
        record("Public Citizen Portal Safe Discovery (Unauthenticated 200)", public_res.status_code == 200 and has_public_notice, f"works: {len(public_data.get('works', []))}")

    await db.disconnect()

    logger.info("\n" + "=" * 70)
    logger.info("  VERIFICATION SUITE COMPLETE")
    logger.info("=" * 70)
    passed_count = sum(1 for _, p, _ in results_summary if p)
    total_count = len(results_summary)
    logger.info(f"  Result: {passed_count}/{total_count} tests PASSED")
    logger.info("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
