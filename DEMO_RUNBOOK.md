# Demo runbook

This is a synthetic-data demonstration only. It does not use Government of
India systems or data, and its ML/risk/duplicate/evidence signals require human
review. It does not confirm fraud or any other wrongdoing.

## Prepare a local demo

1. Copy `.env.example` to `.env`, set a local random `JWT_SECRET_KEY`, provide
   every `SEED_*_EMAIL` and `SEED_*_PASSWORD` value through a local secret
   manager, and set `SEED_FORCE_PASSWORD_CHANGE=false` for a short-lived
   demonstration only. Do not put the values in source-controlled files.
2. Start the self-contained stack:

   ```powershell
   docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
   ```

3. In a separate terminal, run the synthetic seed sequence after MongoDB is
   healthy:

   ```powershell
   cd backend
   python -m scripts.seed_users
   python -m scripts.seed_works
   python -m scripts.seed_evidence
   ```

   All seeders leave a nonempty database unchanged. Use a fresh local demo
   database rather than a shared or production database. The first seeded work
   is deliberately in `UP-LKO`, matching the District Authority and Inspector
   demo accounts.

4. Verify `http://localhost:8000/ready` reports `ok`, then open
   `http://localhost:3000` in an incognito/private browser window.

## Development-only demo accounts

The seed script creates Administrator, MoSPI, State Nodal Officer, District
Authority, Field Inspector, MP, Agency, and Citizen roles from `SEED_*`
environment values. It intentionally has no hard-coded email or password. For
the documented case demo, configure a District Authority and Field Inspector
in `UP` / `UP-LKO`; the first synthetic work is seeded in that jurisdiction.
Keep temporary demo credentials in an approved local secret manager, rotate
them after the session, and never reuse them for staging or production.

## 3-minute walkthrough

1. In an incognito window, sign in as District Authority and use the **Works**
   queue to open a `UP-LKO` work. The Work 360° view persists payments,
   progress, and audit timeline data in MongoDB.
   The primary work map deliberately remains empty until an operator/importer
   records valid work-site coordinates; synthetic demo addresses are not shown
   as approximate pins.
2. Open **Risk Alert Center** and explain the composite score, top factors,
   supporting references, and the label: “AI signal — requires human review.”
   Do not describe it as a finding.
3. Open **Financial Intelligence** to compare financial versus physical progress
   and show a “Requires verification” signal.
4. Open **Evidence** to show seeded metadata labels or, with Cloudinary unset,
   the controlled local upload fallback. No image is exposed publicly.
5. Open `/public` in a second incognito window, search the same work, and show
   that public detail omits risk, agency-sensitive, private evidence, and
   restricted financial fields.

## 5-minute workflow walkthrough

1. Sign in as the District Authority and create a case from a high-priority
   work. Acknowledge it, begin review, and select the configured Field
   Inspector from the eligible assignees list. The case becomes *Inspection
   Assigned*.
2. In a separate incognito window, sign in as the Inspector. Open **Inspection
   Management**, select the assigned task, use the map/navigation action, fill
   the checklist, add GPS/timestamp/remarks, and submit. If testing offline UI,
   show the queue state before reconnecting; upload evidence only through the
   signed/local controlled flow.
3. Return to the District Authority window. Review the submitted report and
   resolve or escalate it with a required reason. Show the immutable case and
   audit timeline plus the in-app notification.
4. In a citizen browser session, open `/public`, complete the demo verification
   challenge, submit a ground issue, and save its reference ID. A photo and
   location are optional; do not demonstrate real personal information.
5. Back as District Authority, open **Citizen Moderation**, mark the report
   *Under Review* then *Inspection Assigned*. Track the reference in the
   citizen session and confirm that only the public status is visible.

## Demonstration limitations

- Dataset, images, rules, and model targets are synthetic MPLADS-style demo
  records; displayed model metrics are synthetic-holdout measurements only.
- External notification adapters are disabled unless independently configured.
- Cloudinary is optional; the local evidence fallback is not production object
  storage.
- A deployment URL, Atlas/Redis account, domain/TLS setup, and Cloudinary
  credentials are operator-provided. This repository does not create them.
