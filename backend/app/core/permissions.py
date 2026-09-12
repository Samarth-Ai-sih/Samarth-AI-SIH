"""
SAMARTH AI — RBAC Permission Matrix & Jurisdiction Enforcement

Static permission matrix for 8 roles, jurisdiction scope checking,
and MongoDB query filter builder for DB-level access control.
"""

from enum import Enum
import re
from typing import Any, Optional

from app.models.user import UserRole, JurisdictionScope


# ── Permission Enum ──────────────────────────────────────────────


class Permission(str, Enum):
    """Granular permissions checked on every protected endpoint."""
    READ_WORKS = "read_works"
    WRITE_WORKS = "write_works"
    READ_RISK = "read_risk"
    WRITE_RISK = "write_risk"
    READ_INVESTIGATIONS = "read_investigations"
    WRITE_INVESTIGATIONS = "write_investigations"
    READ_PAYMENTS = "read_payments"
    WRITE_PAYMENTS = "write_payments"
    READ_EVIDENCE = "read_evidence"
    WRITE_EVIDENCE = "write_evidence"
    MANAGE_USERS = "manage_users"
    READ_AUDIT = "read_audit"
    READ_ALL_JURISDICTIONS = "read_all_jurisdictions"
    UPLOAD_CSV = "upload_csv"
    MANAGE_SESSIONS = "manage_sessions"
    READ_COMPLIANCE = "read_compliance"
    WRITE_COMPLIANCE = "write_compliance"
    MANAGE_COMPLIANCE_RULES = "manage_compliance_rules"
    MANAGE_ML_MODELS = "manage_ml_models"


# ── Static Role → Permission Matrix ─────────────────────────────


ROLE_PERMISSIONS: dict[UserRole, set[Permission]] = {
    UserRole.ADMIN: set(Permission),  # All permissions

    UserRole.MOSPI: {
        Permission.READ_WORKS,
        Permission.READ_RISK,
        Permission.READ_INVESTIGATIONS,
        Permission.READ_PAYMENTS,
        Permission.READ_EVIDENCE,
        Permission.READ_AUDIT,
        Permission.READ_ALL_JURISDICTIONS,
        Permission.UPLOAD_CSV,
        Permission.READ_COMPLIANCE,
        Permission.WRITE_COMPLIANCE,
    },

    UserRole.STATE_NODAL_OFFICER: {
        Permission.READ_WORKS,
        Permission.WRITE_WORKS,
        Permission.READ_RISK,
        Permission.READ_PAYMENTS,
        Permission.READ_INVESTIGATIONS,
        Permission.READ_EVIDENCE,
        Permission.READ_COMPLIANCE,
    },

    UserRole.DISTRICT_AUTHORITY: {
        Permission.READ_WORKS,
        Permission.WRITE_WORKS,
        Permission.READ_PAYMENTS,
        Permission.WRITE_PAYMENTS,
        Permission.READ_INVESTIGATIONS,
        Permission.WRITE_INVESTIGATIONS,
        Permission.READ_EVIDENCE,
        Permission.READ_COMPLIANCE,
    },

    UserRole.INSPECTOR: {
        Permission.READ_WORKS,
        Permission.WRITE_INVESTIGATIONS,
        Permission.READ_EVIDENCE,
        Permission.WRITE_EVIDENCE,
        Permission.READ_INVESTIGATIONS,
    },

    UserRole.MP: {
        Permission.READ_WORKS,
        Permission.WRITE_WORKS,
        Permission.READ_PAYMENTS,
        Permission.READ_RISK,
        # Explicitly: NO write_investigations, NO write_payments
    },

    UserRole.AGENCY: {
        Permission.READ_WORKS,
        Permission.WRITE_WORKS,
    },

    # Public work discovery is intentionally served only by /api/v1/public.
    # Explicitly: NO internal works, risk, investigations, evidence, or payments.
    UserRole.CITIZEN: set(),
}


# Labels and descriptions intentionally live beside the enforcement matrix so
# the administrative UI cannot drift into a separately hard-coded policy.
PERMISSION_METADATA: dict[Permission, dict[str, str]] = {
    Permission.READ_WORKS: {"label": "Read works", "description": "View work records within the role's permitted scope.", "category": "Works"},
    Permission.WRITE_WORKS: {"label": "Write works", "description": "Create or update permitted work records.", "category": "Works"},
    Permission.READ_RISK: {"label": "Read risk", "description": "View internal risk scores and explanations.", "category": "Risk"},
    Permission.WRITE_RISK: {"label": "Write risk", "description": "Run or persist risk scoring operations.", "category": "Risk"},
    Permission.READ_INVESTIGATIONS: {"label": "Read investigations", "description": "View permitted case and investigation records.", "category": "Investigations"},
    Permission.WRITE_INVESTIGATIONS: {"label": "Write investigations", "description": "Create or update permitted case and inspection records.", "category": "Investigations"},
    Permission.READ_PAYMENTS: {"label": "Read payments", "description": "View permitted payment and financial records.", "category": "Payments"},
    Permission.WRITE_PAYMENTS: {"label": "Write payments", "description": "Add or update permitted payment records.", "category": "Payments"},
    Permission.READ_EVIDENCE: {"label": "Read evidence", "description": "View permitted private evidence metadata and records.", "category": "Evidence"},
    Permission.WRITE_EVIDENCE: {"label": "Write evidence", "description": "Upload or complete permitted evidence records.", "category": "Evidence"},
    Permission.MANAGE_USERS: {"label": "Manage users", "description": "Create, update, deactivate, and administer user accounts.", "category": "Administration"},
    Permission.READ_AUDIT: {"label": "Read audit logs", "description": "View security and workflow audit records.", "category": "Administration"},
    Permission.READ_ALL_JURISDICTIONS: {"label": "Read all jurisdictions", "description": "Access records across all configured jurisdictions.", "category": "Jurisdiction"},
    Permission.UPLOAD_CSV: {"label": "Upload CSV", "description": "Upload and import approved datasets.", "category": "Data ingestion"},
    Permission.MANAGE_SESSIONS: {"label": "Manage sessions", "description": "Revoke and administer account sessions.", "category": "Administration"},
    Permission.READ_COMPLIANCE: {"label": "Read compliance", "description": "View compliance rules and results.", "category": "Compliance"},
    Permission.WRITE_COMPLIANCE: {"label": "Write compliance", "description": "Review or update permitted compliance results.", "category": "Compliance"},
    Permission.MANAGE_COMPLIANCE_RULES: {"label": "Manage compliance rules", "description": "Create, update, or manage compliance rules.", "category": "Compliance"},
    Permission.MANAGE_ML_MODELS: {"label": "Manage ML models", "description": "Approve or roll back registered ML model versions.", "category": "Risk"},
}

ROLE_SCOPE_LABELS: dict[UserRole, str] = {
    UserRole.ADMIN: "Full Access",
    UserRole.MOSPI: "National Scope",
    UserRole.STATE_NODAL_OFFICER: "State Scope",
    UserRole.DISTRICT_AUTHORITY: "District Scope",
    UserRole.INSPECTOR: "Task Scope",
    UserRole.MP: "Constituency Scope",
    UserRole.AGENCY: "District / Project Scope",
    UserRole.CITIZEN: "Public Access",
}

ROLE_LABELS: dict[UserRole, str] = {
    UserRole.ADMIN: "Admin",
    UserRole.MOSPI: "MoSPI",
    UserRole.STATE_NODAL_OFFICER: "State Nodal Officer",
    UserRole.DISTRICT_AUTHORITY: "District Authority",
    UserRole.INSPECTOR: "Inspector",
    UserRole.MP: "MP",
    UserRole.AGENCY: "Agency",
    UserRole.CITIZEN: "Citizen",
}


# ── Permission Checks ───────────────────────────────────────────


def has_permission(role: UserRole, permission: Permission) -> bool:
    """Check if a role grants a specific permission."""
    return permission in ROLE_PERMISSIONS.get(role, set())


def has_all_permissions(role: UserRole, permissions: set[Permission]) -> bool:
    """Check if a role grants ALL specified permissions."""
    role_perms = ROLE_PERMISSIONS.get(role, set())
    return permissions.issubset(role_perms)


def get_role_permissions(role: UserRole) -> set[Permission]:
    """Return the full permission set for a role."""
    return ROLE_PERMISSIONS.get(role, set()).copy()


# ── Jurisdiction Enforcement ─────────────────────────────────────


def check_jurisdiction(
    user_role: UserRole,
    user_jurisdiction: JurisdictionScope,
    resource_state: Optional[str] = None,
    resource_district: Optional[str] = None,
    resource_constituency: Optional[str] = None,
    resource_task_id: Optional[str] = None,
) -> bool:
    """
    Check if a user's jurisdiction scope allows access to a specific resource.

    Admin and MoSPI have READ_ALL_JURISDICTIONS and bypass all checks.
    Other roles are scoped to their assigned geographic area or tasks.
    """
    # Unrestricted roles
    if has_permission(user_role, Permission.READ_ALL_JURISDICTIONS):
        return True

    j = user_jurisdiction

    # State-scoped: state_nodal_officer
    if user_role == UserRole.STATE_NODAL_OFFICER:
        if not j.state_code:
            return False
        if resource_state:
            return _ci_match(resource_state, j.state_code)
        return True  # No state on resource → allow (filtered at DB level)

    # District-scoped: district_authority, agency
    if user_role in (UserRole.DISTRICT_AUTHORITY, UserRole.AGENCY):
        if not j.district_code:
            return False
        state_ok = True
        if resource_state and j.state_code:
            state_ok = _ci_match(resource_state, j.state_code)
        district_ok = True
        if resource_district:
            district_ok = _ci_match(resource_district, j.district_code)
        return state_ok and district_ok

    # Constituency-scoped: MP
    if user_role == UserRole.MP:
        if resource_constituency and j.constituency:
            return _ci_match(resource_constituency, j.constituency)
        if resource_state and j.state_code:
            return _ci_match(resource_state, j.state_code)
        return j.constituency is not None or j.state_code is not None

    # Task-scoped: inspector
    if user_role == UserRole.INSPECTOR:
        if resource_task_id:
            return resource_task_id in j.assigned_task_ids
        # For non-task resources, fall back to geographic scope
        if resource_state and j.state_code:
            state_ok = _ci_match(resource_state, j.state_code)
            if resource_district and j.district_code:
                return state_ok and _ci_match(resource_district, j.district_code)
            return state_ok
        # Inspector with only task IDs and no geographic resource → deny
        return bool(j.state_code)

    # Citizen — public portal data is not jurisdiction-restricted
    if user_role == UserRole.CITIZEN:
        return True

    return False


# ── MongoDB Query Filter Builder ─────────────────────────────────


def build_jurisdiction_filter(
    user_role: UserRole,
    user_jurisdiction: JurisdictionScope,
) -> dict[str, Any]:
    """
    Build a MongoDB query filter that restricts results to the user's
    jurisdiction. Applied directly to every protected database query.

    Returns an empty dict for unrestricted roles (admin, mospi).
    """
    if has_permission(user_role, Permission.READ_ALL_JURISDICTIONS):
        return {}

    j = user_jurisdiction
    filters: dict[str, Any] = {}

    if user_role == UserRole.STATE_NODAL_OFFICER:
        if j.state_code:
            escaped = re.escape(j.state_code.strip())
            filters["state_code"] = {"$regex": f"^{escaped}$", "$options": "i"}

    elif user_role in (UserRole.DISTRICT_AUTHORITY, UserRole.AGENCY):
        if j.state_code:
            escaped_s = re.escape(j.state_code.strip())
            filters["state_code"] = {"$regex": f"^{escaped_s}$", "$options": "i"}
        if j.district_code:
            escaped_d = re.escape(j.district_code.strip())
            filters["district_code"] = {"$regex": f"^{escaped_d}$", "$options": "i"}

    elif user_role == UserRole.MP:
        if j.constituency:
            escaped_c = re.escape(j.constituency.strip())
            filters["constituency"] = {"$regex": f"^{escaped_c}", "$options": "i"}
        elif j.state_code:
            escaped_s = re.escape(j.state_code.strip())
            filters["state_code"] = {"$regex": f"^{escaped_s}$", "$options": "i"}

    elif user_role == UserRole.INSPECTOR:
        if j.district_code:
            escaped_d = re.escape(j.district_code.strip())
            filters["district_code"] = {"$regex": f"^{escaped_d}$", "$options": "i"}
        if j.state_code:
            escaped_s = re.escape(j.state_code.strip())
            filters["state_code"] = {"$regex": f"^{escaped_s}$", "$options": "i"}
        if not j.district_code and not j.state_code:
            if j.assigned_task_ids:
                filters["task_id"] = {"$in": j.assigned_task_ids}
            else:
                filters["_id"] = None

    elif user_role == UserRole.CITIZEN:
        # No internal collection access. The separate public router owns its safe projection.
        filters["_id"] = None

    return filters


# ── Helpers ──────────────────────────────────────────────────────


def _ci_match(a: str, b: str) -> bool:
    """Case-insensitive string comparison."""
    return a.strip().lower() == b.strip().lower()
