# Backup and restore runbook

## Backup

1. Confirm MongoDB Atlas continuous/cloud backup is enabled and retain backups
   for the organisation's approved period.
2. Test point-in-time restore in a separate staging project at least quarterly.
3. Record the database name, restore point timestamp, application image tag,
   operator, and change ticket in the operational log. Do not place URI
   credentials in the log.
4. For the local demo MongoDB volume only, stop writers and export a snapshot:

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml stop backend celery-worker celery-beat
docker compose -f docker-compose.yml -f docker-compose.local.yml exec mongo mongodump --db samarth_ai_local --archive=/tmp/samarth-demo.archive
docker cp samarth-mongo-local:/tmp/samarth-demo.archive .\samarth-demo.archive
```

## Restore

1. Declare the incident, stop API/worker/beat writers, and preserve relevant
   audit logs before making changes.
2. Restore Atlas into a **new isolated cluster/database** first. Validate record
   counts, indexes, `/ready`, authentication, public data projection, and a
   sample case/evidence record.
3. Obtain change approval before switching application secrets/connection string
   to the restored database. Keep the damaged database read-only until review
   is complete.
4. For local demo data only:

```powershell
docker cp .\samarth-demo.archive samarth-mongo-local:/tmp/samarth-demo.archive
docker compose -f docker-compose.yml -f docker-compose.local.yml exec mongo mongorestore --drop --archive=/tmp/samarth-demo.archive
```

5. Start services, run the smoke checks in [DEPLOYMENT.md](DEPLOYMENT.md), and
   document the recovery outcome. Never use this local runbook to overwrite a
   real production database.
