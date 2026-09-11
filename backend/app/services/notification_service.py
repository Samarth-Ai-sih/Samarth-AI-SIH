"""Privacy-safe in-app notifications and adapter-backed delivery tracking."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional, Protocol
from uuid import uuid4

from app.core.config import get_settings
from app.core.database import Database
from app.models.background import (
    NotificationChannel,
    NotificationDeliveryRecord,
    NotificationDeliveryStatus,
    NotificationEventType,
    NotificationPreference,
    NotificationPreferenceUpdate,
    NotificationRecord,
)

logger = logging.getLogger("samarth.notifications")

NOTIFICATIONS_COLLECTION = "notifications"
PREFERENCES_COLLECTION = "notification_preferences"
DELIVERIES_COLLECTION = "notification_deliveries"
USERS_COLLECTION = "users"


SAFE_CONTENT: dict[NotificationEventType, tuple[str, str]] = {
    NotificationEventType.RED_ALERT_ASSIGNED: ("Red risk alert assigned", "A work in your jurisdiction requires review."),
    NotificationEventType.SLA_BREACH_APPROACHING: ("SLA review approaching", "A case in your jurisdiction is approaching its review deadline."),
    NotificationEventType.CASE_ESCALATED: ("Case escalated", "A case has been escalated to your review level."),
    NotificationEventType.INSPECTOR_ASSIGNED: ("Inspection assigned", "A field inspection task is ready in your assigned queue."),
    NotificationEventType.INSPECTION_SUBMITTED: ("Inspection submitted", "A field inspection report is ready for authority review."),
    NotificationEventType.CLARIFICATION_REQUESTED: ("Clarification requested", "A case requires a clarification or supporting documents."),
    NotificationEventType.CITIZEN_REPORT_UPDATED: ("Citizen report updated", "A citizen report in your jurisdiction changed moderation status."),
    NotificationEventType.MATERIAL_RISK_SCORE_CHANGE: ("Risk score changed", "A work has a material change in its decision-support risk signal."),
    NotificationEventType.VERIFICATION_REQUEST_ASSIGNED: ("Verification requested", "A project anomaly verification request has been assigned to you."),
    NotificationEventType.CASE_OWNER_ASSIGNED: ("Case assigned", "You have been assigned as owner for a public work case."),
    NotificationEventType.CITIZEN_ISSUE_RAISED: ("New citizen issue reported", "A citizen reported a ground concern for a work in your jurisdiction."),
    NotificationEventType.CASE_COMPLETED: ("Notice: Case Completed & Resolved", "District Authority has verified field inspection and officially marked the case completed."),
    NotificationEventType.CASE_RESOLVED: ("Case resolved", "A case in your jurisdiction has been officially resolved."),
}


@dataclass(frozen=True)
class DeliveryOutcome:
    status: NotificationDeliveryStatus
    provider_message_id: Optional[str] = None
    detail: str = ""


class NotificationAdapter(Protocol):
    channel: NotificationChannel

    async def deliver(self, *, recipient: dict[str, Any], notification: NotificationRecord) -> DeliveryOutcome: ...


class _DisabledExternalAdapter:
    """Intentional no-op until a vetted provider is configured by deployment ops."""

    def __init__(self, channel: NotificationChannel, enabled: bool):
        self.channel = channel
        self._enabled = enabled

    async def deliver(self, *, recipient: dict[str, Any], notification: NotificationRecord) -> DeliveryOutcome:
        if not self._enabled:
            return DeliveryOutcome(NotificationDeliveryStatus.SKIPPED, detail=f"{self.channel.value} adapter is not configured")
        # A production provider is deliberately injected at deployment time.
        # Never send full case, citizen, evidence, GPS, or financial data here.
        logger.info("Configured %s adapter accepted notification=%s recipient=%s", self.channel.value, notification.notification_id, recipient.get("user_id"))
        return DeliveryOutcome(NotificationDeliveryStatus.DELIVERED, provider_message_id=f"adapter-{notification.notification_id[:8]}")


class EmailAdapter(_DisabledExternalAdapter):
    def __init__(self):
        super().__init__(NotificationChannel.EMAIL, get_settings().NOTIFICATION_EMAIL_ENABLED)


class SMSAdapter(_DisabledExternalAdapter):
    def __init__(self):
        super().__init__(NotificationChannel.SMS, get_settings().NOTIFICATION_SMS_ENABLED)


class WhatsAppAdapter(_DisabledExternalAdapter):
    def __init__(self):
        super().__init__(NotificationChannel.WHATSAPP, get_settings().NOTIFICATION_WHATSAPP_ENABLED)


class NotificationService:
    """Stores user-visible events and channel delivery status in MongoDB."""

    def __init__(self, db: Database):
        self._db = db
        self._notifications = db.get_collection(NOTIFICATIONS_COLLECTION)
        self._preferences = db.get_collection(PREFERENCES_COLLECTION)
        self._deliveries = db.get_collection(DELIVERIES_COLLECTION)
        self._users = db.get_collection(USERS_COLLECTION)
        self._adapters: dict[NotificationChannel, NotificationAdapter] = {
            NotificationChannel.EMAIL: EmailAdapter(),
            NotificationChannel.SMS: SMSAdapter(),
            NotificationChannel.WHATSAPP: WhatsAppAdapter(),
        }

    async def ensure_indexes(self) -> None:
        await self._notifications.create_index("notification_id", unique=True)
        await self._notifications.create_index("idempotency_key", unique=True)
        await self._notifications.create_index([("recipient_user_id", 1), ("created_at", -1)])
        await self._notifications.create_index([("recipient_user_id", 1), ("read_at", 1)])
        await self._preferences.create_index("user_id", unique=True)
        await self._deliveries.create_index("delivery_id", unique=True)
        await self._deliveries.create_index([("status", 1), ("created_at", 1)])
        await self._deliveries.create_index([("notification_id", 1), ("channel", 1)], unique=True)

    async def get_preferences(self, user_id: str) -> NotificationPreference:
        document = await self._preferences.find_one({"user_id": user_id}, {"_id": 0})
        if document:
            return NotificationPreference(**document)
        preference = NotificationPreference(user_id=user_id)
        try:
            await self._preferences.insert_one(preference.model_dump(mode="python"))
        except Exception:
            document = await self._preferences.find_one({"user_id": user_id}, {"_id": 0})
            if document:
                return NotificationPreference(**document)
            raise
        return preference

    async def update_preferences(self, user_id: str, update: NotificationPreferenceUpdate) -> NotificationPreference:
        current = await self.get_preferences(user_id)
        data = current.model_dump(mode="python")
        for key, value in update.model_dump(exclude_none=True).items():
            data[key] = value
        data["updated_at"] = datetime.now(timezone.utc)
        await self._preferences.update_one({"user_id": user_id}, {"$set": data})
        return NotificationPreference(**data)

    async def create_event(
        self,
        *,
        recipient_user_id: str,
        event_type: NotificationEventType,
        resource_type: str,
        resource_id: str,
        idempotency_key: str,
        title: Optional[str] = None,
        message: Optional[str] = None,
    ) -> NotificationRecord:
        """Create one safe event and its channel-delivery records exactly once."""
        existing = await self._notifications.find_one({"idempotency_key": idempotency_key}, {"_id": 0})
        if existing:
            return NotificationRecord(**existing)
        preference = await self.get_preferences(recipient_user_id)
        default_title, default_message = SAFE_CONTENT.get(event_type, ("Notification", "A workflow update occurred."))
        notification = NotificationRecord(
            notification_id=str(uuid4()), recipient_user_id=recipient_user_id,
            event_type=event_type,
            title=title or default_title,
            message=message or default_message,
            resource_type=resource_type, resource_id=resource_id,
            idempotency_key=idempotency_key,
            in_app_visible=self._enabled(preference, NotificationChannel.IN_APP, event_type),
        )
        try:
            await self._notifications.insert_one(notification.model_dump(mode="python"))
        except Exception:
            existing = await self._notifications.find_one({"idempotency_key": idempotency_key}, {"_id": 0})
            if existing:
                return NotificationRecord(**existing)
            raise
        for channel in NotificationChannel:
            if not self._enabled(preference, channel, event_type):
                continue
            status = NotificationDeliveryStatus.DELIVERED if channel == NotificationChannel.IN_APP else NotificationDeliveryStatus.PENDING
            delivery = NotificationDeliveryRecord(
                delivery_id=str(uuid4()), notification_id=notification.notification_id,
                channel=channel, status=status,
                delivered_at=notification.created_at if status == NotificationDeliveryStatus.DELIVERED else None,
            )
            await self._deliveries.insert_one(delivery.model_dump(mode="python"))
        return notification

    async def create_for_roles(
        self,
        *,
        roles: set[str],
        state_code: str = "",
        district_code: str = "",
        event_type: NotificationEventType,
        resource_type: str,
        resource_id: str,
        idempotency_prefix: str,
        title: Optional[str] = None,
        message: Optional[str] = None,
    ) -> int:
        users = await self._users.find({"is_active": True}, {"_id": 0}).to_list(length=None)
        recipients = [user for user in users if str(user.get("role", "")) in roles and _in_scope(user, state_code, district_code)]
        created = 0
        for recipient in recipients:
            user_id = str(recipient.get("user_id", ""))
            if not user_id:
                continue
            await self.create_event(
                recipient_user_id=user_id, event_type=event_type, resource_type=resource_type,
                resource_id=resource_id, idempotency_key=f"{idempotency_prefix}:{user_id}",
                title=title, message=message,
            )
            created += 1
        return created

    async def list_in_app(self, recipient_user_id: str, *, limit: int = 50) -> tuple[list[NotificationRecord], int]:
        query = {"recipient_user_id": recipient_user_id, "in_app_visible": True}
        docs = await self._notifications.find(query, {"_id": 0}).sort([("created_at", -1)]).limit(limit).to_list(length=limit)
        unread = await self._notifications.count_documents({**query, "read_at": None})
        return [NotificationRecord(**doc) for doc in docs], unread

    async def mark_read(self, notification_id: str, *, recipient_user_id: str) -> Optional[NotificationRecord]:
        notification = await self._notifications.find_one({"notification_id": notification_id, "recipient_user_id": recipient_user_id}, {"_id": 0})
        if not notification:
            return None
        if not notification.get("read_at"):
            await self._notifications.update_one({"notification_id": notification_id}, {"$set": {"read_at": datetime.now(timezone.utc)}})
            notification["read_at"] = datetime.now(timezone.utc)
        return NotificationRecord(**notification)

    async def mark_all_read(self, recipient_user_id: str) -> int:
        now = datetime.now(timezone.utc)
        result = await self._notifications.update_many(
            {"recipient_user_id": recipient_user_id, "read_at": None, "in_app_visible": True},
            {"$set": {"read_at": now}},
        )
        return int(result.modified_count)

    async def deliver_pending(self, *, notification_id: Optional[str] = None) -> dict[str, int]:
        # Failed external-adapter attempts stay eligible for the Celery task's
        # exponential retry. Permanent local conditions are stored as skipped.
        query: dict[str, Any] = {"status": {"$in": [NotificationDeliveryStatus.PENDING.value, NotificationDeliveryStatus.FAILED.value]}}
        if notification_id:
            query["notification_id"] = notification_id
        deliveries = await self._deliveries.find(query, {"_id": 0}).to_list(length=None)
        results = {"delivered": 0, "skipped": 0, "failed": 0}
        for document in deliveries:
            delivery = NotificationDeliveryRecord(**document)
            notification_doc = await self._notifications.find_one({"notification_id": delivery.notification_id}, {"_id": 0})
            if not notification_doc:
                await self._update_delivery(delivery, NotificationDeliveryStatus.FAILED, "Notification record is unavailable")
                results["failed"] += 1
                continue
            recipient = await self._users.find_one({"user_id": notification_doc["recipient_user_id"]}, {"_id": 0})
            if not recipient:
                await self._update_delivery(delivery, NotificationDeliveryStatus.SKIPPED, "Recipient account is unavailable")
                results["skipped"] += 1
                continue
            adapter = self._adapters.get(delivery.channel)
            if not adapter:
                await self._update_delivery(delivery, NotificationDeliveryStatus.SKIPPED, "No adapter for channel")
                results["skipped"] += 1
                continue
            try:
                outcome = await adapter.deliver(recipient=recipient, notification=NotificationRecord(**notification_doc))
            except Exception as exc:
                await self._update_delivery(delivery, NotificationDeliveryStatus.FAILED, str(exc))
                results["failed"] += 1
                raise
            await self._update_delivery(delivery, outcome.status, outcome.detail, outcome.provider_message_id)
            results[outcome.status.value] = results.get(outcome.status.value, 0) + 1
        return results

    async def _update_delivery(
        self,
        delivery: NotificationDeliveryRecord,
        status: NotificationDeliveryStatus,
        detail: str = "",
        provider_message_id: Optional[str] = None,
    ) -> None:
        now = datetime.now(timezone.utc)
        updates: dict[str, Any] = {
            "status": status.value, "attempt_count": delivery.attempt_count + 1,
            "last_error": detail[:500], "updated_at": now,
        }
        if status == NotificationDeliveryStatus.DELIVERED:
            updates["delivered_at"] = now
        if provider_message_id:
            updates["provider_message_id"] = provider_message_id
        await self._deliveries.update_one({"delivery_id": delivery.delivery_id}, {"$set": updates})

    @staticmethod
    def _enabled(preference: NotificationPreference, channel: NotificationChannel, event_type: NotificationEventType) -> bool:
        if event_type.value in preference.event_overrides:
            return bool(preference.event_overrides[event_type.value])
        return {
            NotificationChannel.IN_APP: preference.in_app_enabled,
            NotificationChannel.EMAIL: preference.email_enabled,
            NotificationChannel.SMS: preference.sms_enabled,
            NotificationChannel.WHATSAPP: preference.whatsapp_enabled,
        }[channel]


STATE_CODE_MAP = {
    "up": "uttar pradesh",
    "dl": "delhi",
    "mh": "maharashtra",
    "pb": "punjab",
    "rj": "rajasthan",
    "mp": "madhya pradesh",
    "as": "assam",
    "gj": "gujarat",
    "ka": "karnataka",
    "tn": "tamil nadu",
    "wb": "west bengal",
    "br": "bihar",
}


def _in_scope(user: dict[str, Any], state_code: str, district_code: str) -> bool:
    jurisdiction = user.get("jurisdiction") if isinstance(user.get("jurisdiction"), dict) else {}
    user_state = str(jurisdiction.get("state_code") or "").strip().casefold()
    user_district = str(jurisdiction.get("district_code") or "").strip().casefold()
    sc = (state_code or "").strip().casefold()
    dc = (district_code or "").strip().casefold()

    if sc and user_state:
        matched_state = (sc == user_state) or (sc in user_state) or (user_state in sc)
        if not matched_state:
            sc_full = STATE_CODE_MAP.get(sc, sc)
            us_full = STATE_CODE_MAP.get(user_state, user_state)
            if sc_full == us_full or sc_full in us_full or us_full in sc_full:
                matched_state = True
        if not matched_state:
            return False

    if dc and user_district:
        matched_dist = (dc == user_district) or (dc in user_district) or (user_district in dc)
        if not matched_dist:
            # District abbreviation mappings: LKO / Lucknow, RBL / Raebareli, VNS / Varanasi
            if ("lko" in dc and "lucknow" in user_district) or ("lko" in user_district and "lucknow" in dc):
                matched_dist = True
            elif ("rbl" in dc and "raebareli" in user_district) or ("rbl" in user_district and "raebareli" in dc):
                matched_dist = True
            elif ("vns" in dc and "varanasi" in user_district) or ("vns" in user_district and "varanasi" in dc):
                matched_dist = True
        if not matched_dist:
            return False
    return True
