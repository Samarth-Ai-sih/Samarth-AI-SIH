# Incident-response runbook

1. **Triage:** record time, reporter, affected URL/service, impact, and any
   request/correlation ID. Treat evidence and citizen identity as sensitive.
2. **Contain:** revoke exposed credentials, disable affected external delivery
   adapter, restrict ingress, or place affected account/API in read-only mode.
   Do not delete audit logs or evidence records.
3. **Preserve:** retain structured application logs, MongoDB audit events,
   Celery job records, provider delivery IDs, and image tags in a restricted
   incident workspace.
4. **Eradicate:** patch the cause, rotate secrets/tokens, invalidate sessions
   when necessary, review RBAC/jurisdiction access, and run all automated
   checks in a non-production environment.
5. **Recover:** deploy the verified image, verify `/health` and `/ready`, test
   login in an incognito window, validate the public privacy projection, and
   monitor errors/rate-limit events.
6. **Communicate:** use the organisation's approved incident process. Do not
   send citizen identity, raw GPS, evidence, case rationale, or risk details in
   broad notifications.
7. **Review:** document timeline, root cause, data impact, recovery evidence,
   follow-up owners, and lessons learned.

For suspected private-evidence exposure, immediately disable affected signed
upload/delivery credentials, rotate Cloudinary credentials, and investigate
access logs before re-enabling uploads.
