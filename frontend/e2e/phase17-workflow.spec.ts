import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

const env = process.env;
const required = [
  "E2E_DISTRICT_EMAIL", "E2E_DISTRICT_PASSWORD", "E2E_INSPECTOR_EMAIL", "E2E_INSPECTOR_PASSWORD",
  "E2E_INSPECTOR_ID", "E2E_WORK_ID",
];
const mutationsEnabled = env.E2E_ALLOW_MUTATIONS === "true" && required.every((key) => Boolean(env[key]));

async function json(response: APIResponse) {
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function login(request: APIRequestContext, email: string, password: string) {
  const response = await request.post("/api/v1/auth/login", { data: { email, password } });
  const body = await json(response);
  return { authorization: `Bearer ${body.access_token}`, userId: body.user.user_id as string };
}

test.describe("Phase 17 District Authority → Inspector → Citizen workflow", () => {
  test.skip(!mutationsEnabled, "Set E2E_ALLOW_MUTATIONS=true and the documented E2E_* variables to run against a test environment.");

  test("completes inspection, escalation, moderation, and public privacy contract", async ({ request }) => {
    const district = await login(request, env.E2E_DISTRICT_EMAIL!, env.E2E_DISTRICT_PASSWORD!);
    const inspector = await login(request, env.E2E_INSPECTOR_EMAIL!, env.E2E_INSPECTOR_PASSWORD!);
    const headers = { Authorization: district.authorization };

    const created = await json(await request.post("/api/v1/cases", {
      headers,
      data: { work_id: env.E2E_WORK_ID, title: "E2E verification case", description: "Automated test review", severity: "high" },
    }));
    const caseId = created.case_id as string;
    await json(await request.post(`/api/v1/cases/${caseId}/acknowledge`, { headers }));
    await json(await request.post(`/api/v1/cases/${caseId}/begin-review`, { headers }));
    await json(await request.put(`/api/v1/cases/${caseId}/inspector`, {
      headers, data: { user_id: env.E2E_INSPECTOR_ID, reason: "E2E field verification" },
    }));

    await json(await request.post(`/api/v1/cases/assigned/${caseId}/report`, {
      headers: { Authorization: inspector.authorization },
      data: {
        checklist: {
          asset_found: true, work_active: true, verified_physical_progress_pct: 60,
          quality_concern: false, work_delayed: false, cause_of_delay: "", additional_remarks: "E2E report",
        },
        evidence_ids: [], remarks: "Submitted by opt-in browser contract",
      },
    }));
    const escalated = await json(await request.post(`/api/v1/cases/${caseId}/escalate`, {
      headers, data: { reason: "E2E escalation verification" },
    }));
    expect(escalated.status).toBe("escalated");

    const challenge = await json(await request.get("/api/v1/public/verification-challenge"));
    const match = String(challenge.prompt).match(/(\d+)\s*\+\s*(\d+)/);
    expect(match).not.toBeNull();
    const citizen = await json(await request.post("/api/v1/public/issues", {
      data: {
        work_id: env.E2E_WORK_ID, issue_type: "quality_concern", description: "Citizen E2E report for moderation.",
        location_consent: false, verification_id: challenge.verification_id,
        verification_answer: String(Number(match![1]) + Number(match![2])),
      },
    }));
    const reference = citizen.reference_id as string;
    const moderationHeaders = { Authorization: district.authorization };
    await json(await request.put(`/api/v1/citizen-reports/${reference}/status`, {
      headers: moderationHeaders,
      data: { status: "under_review", public_status_message: "Your report is under review." },
    }));
    await json(await request.put(`/api/v1/citizen-reports/${reference}/status`, {
      headers: moderationHeaders,
      data: { status: "inspection_assigned", assigned_inspector_id: env.E2E_INSPECTOR_ID, public_status_message: "Inspection assigned." },
    }));

    const publicWork = await json(await request.get(`/api/v1/public/works/${env.E2E_WORK_ID}`));
    for (const restricted of ["risk_score", "composite_score", "financial", "agency", "investigation_notes", "evidence"]) {
      expect(publicWork).not.toHaveProperty(restricted);
    }
  });
});
