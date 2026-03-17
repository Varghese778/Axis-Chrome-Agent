"""
backend/firestore_client.py
Async Firestore wrapper — users/{user_id}/sessions/{session_id} schema.
"""
import logging
from datetime import datetime, timezone

from google.cloud import firestore
from google.cloud.firestore_v1.async_client import AsyncClient

from backend.config import settings

logger = logging.getLogger(__name__)


class FirestoreClient:
    def __init__(self):
        self._client: AsyncClient | None = None

    def _get_client(self) -> AsyncClient:
        if self._client is None:
            self._client = firestore.AsyncClient(
                project=settings.google_cloud_project
            )
        return self._client

    # ------------------------------------------------------------------
    # User
    # ------------------------------------------------------------------

    async def upsert_user(self, user_id: str, email: str, display_name: str) -> None:
        """Create or update user document. Never raises."""
        try:
            client = self._get_client()
            doc_ref = client.collection("users").document(user_id)
            now = datetime.now(timezone.utc)
            await doc_ref.set(
                {
                    "user_id": user_id,
                    "email": email,
                    "display_name": display_name,
                    "last_seen_at": now,
                    "input_count": firestore.Increment(0), # Ensure it exists without overwriting
                    "image_count": firestore.Increment(0), 
                },
                merge=True,
            )
            # Set created_at only on first write
            snap = await doc_ref.get()
            if snap.exists and not snap.to_dict().get("created_at"):
                await doc_ref.update({"created_at": now})
            logger.info(f"upsert_user: {user_id}")
        except Exception as e:
            logger.error(f"upsert_user error: {e}")

    async def get_user_counts(self, user_id: str) -> dict:
        """Fetch user document and return input/image counts and optional limit overrides."""
        try:
            client = self._get_client()
            doc_ref = client.collection("users").document(user_id)
            snap = await doc_ref.get()
            if snap.exists:
                data = snap.to_dict()
                return {
                    "input_count": data.get("input_count", 0),
                    "image_count": data.get("image_count", 0),
                    "input_limit": data.get("input_limit"),
                    "image_limit": data.get("image_limit"),
                }
            return {"input_count": 0, "image_count": 0, "input_limit": None, "image_limit": None}
        except Exception as e:
            logger.error(f"get_user_counts error: {e}")
            return {"input_count": 0, "image_count": 0, "input_limit": None, "image_limit": None}

    async def increment_input_count(self, user_id: str) -> int:
        """Atomically increment input_count."""
        try:
            client = self._get_client()
            doc_ref = client.collection("users").document(user_id)
            await doc_ref.update({"input_count": firestore.Increment(1)})
            # We don't return the new count because get() after update is slow
            # and the requirement says return new count but also says use atomic increment.
            # I will return the value after a quick fetch if needed, 
            # but usually for limits we check BEFORE incrementing.
            # Re-reading: "Return new count". I'll fetch it.
            snap = await doc_ref.get()
            return snap.to_dict().get("input_count", 0)
        except Exception as e:
            logger.error(f"increment_input_count error: {e}")
            return 0

    async def increment_image_count(self, user_id: str) -> int:
        """Atomically increment image_count."""
        try:
            client = self._get_client()
            doc_ref = client.collection("users").document(user_id)
            await doc_ref.update({"image_count": firestore.Increment(1)})
            snap = await doc_ref.get()
            return snap.to_dict().get("image_count", 0)
        except Exception as e:
            logger.error(f"increment_image_count error: {e}")
            return 0

    # ------------------------------------------------------------------
    # Session CRUD
    # ------------------------------------------------------------------

    async def create_session(
        self, user_id: str, session_id: str, page_url: str, page_title: str,
        session_type: str = "live",
    ) -> None:
        """Create session document under users/{user_id}/sessions/{session_id}."""
        try:
            client = self._get_client()
            doc_ref = (
                client.collection("users")
                .document(user_id)
                .collection(settings.firestore_collection)
                .document(session_id)
            )
            await doc_ref.set(
                {
                    "session_id": session_id,
                    "user_id": user_id,
                    "started_at": datetime.now(timezone.utc),
                    "ended_at": None,
                    "page_url": page_url,
                    "page_title": page_title,
                    "session_headline": "",
                    "session_type": session_type,
                    "transcript": [],
                }
            )
            logger.info(f"create_session: {session_id} type={session_type}")
        except Exception as e:
            logger.error(f"create_session error: {e}")

    async def append_transcript(
        self, user_id: str, session_id: str, role: str, text: str, timestamp: str
    ) -> None:
        """Append a transcript entry to the session document. Never raises."""
        try:
            client = self._get_client()
            doc_ref = (
                client.collection("users")
                .document(user_id)
                .collection(settings.firestore_collection)
                .document(session_id)
            )
            await doc_ref.set(
                {
                    "transcript": firestore.ArrayUnion(
                        [{"role": role, "text": text, "timestamp": timestamp}]
                    )
                },
                merge=True,
            )
            logger.debug(f"append_transcript: {role} in {session_id}")
        except Exception as e:
            logger.error(f"append_transcript error: {e}")

    async def end_session(
        self, user_id: str, session_id: str, session_headline: str
    ) -> None:
        """Mark session as ended and store AI headline. Never raises."""
        try:
            client = self._get_client()
            doc_ref = (
                client.collection("users")
                .document(user_id)
                .collection(settings.firestore_collection)
                .document(session_id)
            )
            await doc_ref.set(
                {
                    "ended_at": datetime.now(timezone.utc),
                    "session_headline": session_headline,
                },
                merge=True,
            )
            logger.info(f"end_session: {session_id} headline={session_headline!r}")
        except Exception as e:
            logger.error(f"end_session error: {e}")

    async def get_recent_sessions(self, user_id: str, limit: int = 10) -> list:
        """Return recent sessions for a user. Never raises."""
        try:
            client = self._get_client()
            sessions_ref = (
                client.collection("users")
                .document(user_id)
                .collection(settings.firestore_collection)
            )
            docs = await sessions_ref.get()
            results = []
            for doc in docs:
                data = doc.to_dict()
                data["session_id"] = doc.id
                transcript = data.get("transcript") or []
                data["transcript_count"] = len(transcript)
                # Remove full transcript from listing payload
                data.pop("transcript", None)
                # Serialise datetimes
                for key in ("started_at", "ended_at"):
                    val = data.get(key)
                    if val is not None and hasattr(val, "isoformat"):
                        data[key] = val.isoformat()
                results.append(data)
            results.sort(key=lambda x: x.get("started_at", ""), reverse=True)
            return results[:limit]
        except Exception as e:
            logger.error(f"get_recent_sessions error: {e}")
            return []

    async def get_session_transcript(self, user_id: str, session_id: str) -> list:
        """Return full transcript array for a session. Never raises."""
        try:
            client = self._get_client()
            doc_ref = (
                client.collection("users")
                .document(user_id)
                .collection(settings.firestore_collection)
                .document(session_id)
            )
            snap = await doc_ref.get()
            if not snap.exists:
                return []
            return snap.to_dict().get("transcript", [])
        except Exception as e:
            logger.error(f"get_session_transcript error: {e}")
            return []

    async def delete_session(self, user_id: str, session_id: str) -> None:
        """Hard delete a session document. Never raises."""
        try:
            client = self._get_client()
            doc_ref = (
                client.collection("users")
                .document(user_id)
                .collection(settings.firestore_collection)
                .document(session_id)
            )
            await doc_ref.delete()
            logger.info(f"delete_session: {session_id}")
        except Exception as e:
            logger.error(f"delete_session error: {e}")

    async def store_session_file(
        self, user_id: str, session_id: str, filename: str, mime_type: str, data: str
    ) -> None:
        """Store an uploaded file under users/{user_id}/sessions/{session_id}/files. Never raises."""
        try:
            import uuid
            file_id = str(uuid.uuid4())
            client = self._get_client()
            ref = (
                client.collection("users")
                .document(user_id)
                .collection(settings.firestore_collection)
                .document(session_id)
                .collection("files")
                .document(file_id)
            )
            await ref.set({
                "file_id": file_id,
                "filename": filename,
                "mime_type": mime_type,
                "data": data,
                "uploaded_at": datetime.now(timezone.utc),
            })
            logger.info(f"store_session_file: {filename}")
        except Exception as e:
            logger.error(f"store_session_file error: {e}")


# Singleton instance
firestore_client = FirestoreClient()
