"""
backend/email_service.py
Send feedback emails via SMTP (Gmail).
"""
import logging
import smtplib
import ssl
from email.mime.text import MIMEText

from backend.config import settings

logger = logging.getLogger(__name__)


async def send_feedback_email(
    feedback_type: str,
    subject: str,
    message: str,
    sender_name: str,
    user_email: str,
) -> bool:
    """Send feedback email via Gmail SMTP. Returns True on success."""
    try:
        sender = settings.feedback_sender_email
        password = settings.feedback_sender_app_password
        recipient = settings.feedback_recipient_email

        if not sender or not password or not recipient:
            logger.error("Feedback email settings not configured")
            return False

        email_subject = f"[Axis {feedback_type}] {subject}"
        body = (
            f"Type: {feedback_type}\n"
            f"From: {sender_name}\n"
            f"User Email: {user_email}\n"
            f"\n{message}\n"
            f"\n---\n"
            f"Sent from Axis Browser Extension v1.0.0"
        )

        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = email_subject
        msg["From"] = sender
        msg["To"] = recipient

        context = ssl.create_default_context()
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
            server.login(sender, password)
            server.sendmail(sender, recipient, msg.as_string())

        logger.info("Feedback email sent successfully")
        return True
    except Exception as e:
        logger.error(f"send_feedback_email error: {e}")
        return False
