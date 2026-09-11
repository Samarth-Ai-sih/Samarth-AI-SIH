# Security checklist

Use this list before staging promotion and again before any public deployment.

- [ ] `ENVIRONMENT=production` and `DEBUG=false`; OpenAPI docs are not exposed.
- [ ] Exact HTTPS `CORS_ORIGINS` are configured; no wildcard CORS.
- [ ] Secrets are held in a platform secret manager, not `.env`, images, logs,
  screenshots, or client bundles.
- [ ] `JWT_SECRET_KEY` and `CSRF_SECRET_KEY` are unique random values; refresh
  cookies are HttpOnly, Secure in production, and scoped to auth routes.
- [ ] `TRUST_PROXY_HEADERS=true` only when a controlled proxy sanitises
  `X-Forwarded-For`; otherwise leave it false.
- [ ] MongoDB Atlas uses least-privileged application credentials, TLS, IP/VPC
  access restrictions, automated backups, and alerting.
- [ ] Redis is private, authenticated/TLS when managed, and never internet
  exposed. Celery Beat has exactly one replica.
- [ ] Reverse proxy/load balancer terminates TLS, redirects HTTP, limits body
  size, and forwards only trusted request headers.
- [ ] Upload size/type validation and signed Cloudinary flow are tested; private
  evidence is never publicly accessible.
- [ ] RBAC, jurisdiction filters, public API projections, and audit logs have
  passed the automated tests and a manual incognito review.
- [ ] Rate limits, security headers, dependency audit, log retention, backup,
  incident response, and on-call contacts are reviewed.
- [ ] External email/SMS/WhatsApp adapters remain disabled until an approved
  provider and privacy review are in place.

The system produces review signals only. It does not make a legal finding,
confirm misconduct, or confirm fraud.
