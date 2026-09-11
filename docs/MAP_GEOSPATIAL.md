# Map and geospatial integration

## Status

**Extended existing implementation.** The repository already contained Leaflet
for an individual Work 360° location and coordinate-only comparison views.
This implementation adds the missing primary, MongoDB-backed work map to the
existing **Works** register. It does not create a second standalone map flow.

| Layer | Implementation |
| --- | --- |
| Frontend map | React Leaflet / Leaflet in `frontend/src/components/maps/work-explorer-map.tsx` |
| Register integration | `frontend/src/app/dashboard/works/page.tsx` |
| API client types | `frontend/src/lib/api.ts` |
| Backend map API | `GET /api/v1/works/map` in `backend/app/api/v1/works.py` |
| Domain/query service | `backend/app/services/work_service.py` |
| Work schemas | `backend/app/models/work.py` |
| MongoDB storage | `works.location.latitude`, `works.location.longitude`, and validated `works.location.geo` GeoJSON |
| Tests | `backend/tests/test_map_geospatial.py` |

## Data contract and safety

The canonical exact-project-location representation is created only when both
stored WGS84 coordinates are valid:

```json
{
  "location": {
    "latitude": 26.8467,
    "longitude": 80.9462,
    "geo": { "type": "Point", "coordinates": [80.9462, 26.8467] }
  }
}
```

Existing latitude/longitude fields are retained. Work creation and update write
the GeoJSON mirror. Startup safely backfills it for legacy records with valid
coordinate pairs; it never overwrites latitude/longitude or creates a point
from an address. The `works.location.geo` field has a `2dsphere` index named
`location.geo_2dsphere`.

`scripts.seed_works` now creates only an address-like synthetic description,
not district-centre jitter. The map excludes documents marked `synthetic_demo`
or `synthetic_ml_training`. This prevents a demo point from looking like an
observed work-site location.

The supplied allocation CSVs contain no work-site coordinates. At the time of
this audit, the local `samarth_ai` database contains **0 works**, therefore
the primary map has **0 valid project markers**. No state, district, or
constituency GeoJSON boundary source is bundled, so this implementation does
not fabricate polygons or label a boundary centroid as a work location.

There is no automatic geocoding service. A future approved provider must be
environment-configured, record source/provenance and confidence, require
operator review, and never silently write approximate coordinates.

## API

`GET /api/v1/works/map` is authenticated and requires `READ_WORKS`. Its
allow-listed filters are `state_code`, `district_code`, `constituency`,
`work_id`, `status`, `category`, `risk_tier`, `search`, `updated_from`,
`updated_to`, `page`, and `page_size` (maximum 500). A complete optional
bounding box uses `min_longitude`, `min_latitude`, `max_longitude`, and
`max_latitude`; incomplete, reversed, or out-of-range bounds return `422`.

MongoDB combines client filters with the server-generated scope rather than
replacing it. Bounding-box filtering uses `$geoWithin` with a GeoJSON Polygon
against the 2dsphere index. The response includes marker details from stored
work records, matching/mapped/no-coordinate counts, pagination, and a data
notice explaining that only valid stored coordinates are shown.

The marker response intentionally omits private evidence, audit events, case
details, inspection notes, raw citizen reports, and payment tranches. Amounts
are returned only to roles with `READ_PAYMENTS`; current risk fields only to
roles with `READ_RISK`.

### Access boundaries

| Caller | Map scope |
| --- | --- |
| Admin / MoSPI | All internally authorized jurisdictions |
| State Nodal Officer | Assigned state |
| District Authority / Agency | Assigned state and district |
| MP | Assigned constituency (or assigned state fallback) |
| Inspector | Only works attached to persisted case assignments for that inspector |
| Citizen | No internal map access (`403`); only the separate public API is available |

An inspector's task IDs are case IDs, so the map resolves them server-side to
assigned `cases.work_id` values. Supplying another work ID, state, district,
coordinate, or query parameter cannot widen that task scope.

## User experience and performance

The Works register uses exactly the same search, status, category, risk,
state-code, district-code, and constituency filters for its table and map API
request. This keeps results synchronized without embedding a dataset in the
browser.

The map provides loading, empty, error/retry, and responsive states; a marker
popup links to the existing Work 360° page. It fits to permitted results and
uses deterministic grid clustering when a loaded result page has 25 or more
points. Cluster centroids are navigation aids only, never presented as project
coordinates. Server-side paging caps a request at 500 markers, and the UI asks
the reviewer to refine filters when another page exists.

The pre-existing Work 360° Leaflet card remains in
`frontend/src/components/maps/work-location-map.tsx`. The duplicate and
inspection coordinate comparison views remain focused tools and were not
replaced. Tile URL and attribution are configurable through
`NEXT_PUBLIC_MAP_TILE_URL` and `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION`; otherwise
OpenStreetMap tiles and attribution are used.

## Verification

`backend/tests/test_map_geospatial.py` covers coordinate-pair validation,
GeoJSON preservation, API authentication, citizen restriction, state/district
scope, attempted cross-scope filtering, inspector assigned-task scope,
permission redaction, missing coordinates, pagination, bounding-box input, and
marker allow-listing.

Results recorded during implementation:

- Focused map suite: **7 passed** (one Starlette deprecation warning).
- Complete backend suite: **180 passed, 11 skipped** (one Starlette
  deprecation warning). The additional skip is the guarded real-Mongo test.
- Focused frontend map component suite: **2 passed**.
- Frontend lint and production build: passed after the map explorer addition.

An opt-in test exercises the actual Motor/MongoDB `$geoWithin` path only when
`RUN_MONGODB_INTEGRATION_TESTS=1` and a database name ending in `_test` are
supplied. Its local execution was interrupted before completion, so this file
does **not** claim a completed real-Mongo run for this map change. The
in-memory API/service tests and backend regression results above are the
completed evidence.

The route-registration smoke test confirmed `GET /api/v1/works/map` is
present, healthy, and returns `401` to an unauthenticated request. Restart the
API after future backend source changes before manually using the endpoint.
