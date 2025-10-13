"""
Gmail Agent
Handles email operations
"""
from typing import Dict, Any, List
import base64
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.agents.base_agent import BaseAgent, ActionResult, AuthenticationError


class GmailAgent(BaseAgent):
    """Agent for Gmail operations"""

    def __init__(self, user_id: str, credentials: Dict[str, Any]):
        super().__init__(user_id, credentials)
        self.service = None

        if credentials:
            try:
                # Build Google API credentials
                creds = Credentials(
                    token=credentials.get("access_token"),
                    refresh_token=credentials.get("refresh_token"),
                    token_uri="https://oauth2.googleapis.com/token",
                    client_id=os.getenv("GOOGLE_CLIENT_ID"),
                    client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
                    scopes=credentials.get("scopes", [
                        "https://www.googleapis.com/auth/gmail.send",
                        "https://www.googleapis.com/auth/gmail.compose",
                        "https://www.googleapis.com/auth/gmail.readonly"
                    ])
                )

                # Build Gmail API service
                self.service = build('gmail', 'v1', credentials=creds)
                self.log("Gmail service initialized")

            except Exception as e:
                self.log(f"Failed to initialize Gmail service: {e}", "error")
                raise AuthenticationError(f"Failed to authenticate with Gmail: {e}")

    async def execute(self, action_type: str, params: Dict[str, Any]) -> ActionResult:
        """Execute a Gmail action"""

        if not self.service:
            return ActionResult(
                success=False,
                error="Gmail service not initialized. Please connect your Google account."
            )

        try:
            # Route to appropriate method
            if action_type == "gmail_send":
                return await self.send_email(**params)
            elif action_type == "gmail_create_draft":
                return await self.create_draft(**params)
            elif action_type == "gmail_search":
                return await self.search_emails(**params)
            else:
                return ActionResult(
                    success=False,
                    error=f"Unknown action type: {action_type}"
                )

        except Exception as e:
            self.log(f"Error executing {action_type}: {e}", "error")
            return ActionResult(success=False, error=str(e))

    async def send_email(
        self,
        to: str,
        subject: str,
        body: str,
        cc: str = None,
        bcc: str = None,
        html: bool = False
    ) -> ActionResult:
        """
        Send an email

        Args:
            to: Recipient email address
            subject: Email subject
            body: Email body
            cc: CC recipients (comma-separated)
            bcc: BCC recipients (comma-separated)
            html: Whether body is HTML

        Returns:
            ActionResult with sent email data
        """
        try:
            # Create message
            message = MIMEMultipart() if html else MIMEText(body)
            message['to'] = to
            message['subject'] = subject

            if cc:
                message['cc'] = cc
            if bcc:
                message['bcc'] = bcc

            if html:
                message.attach(MIMEText(body, 'html'))

            # Encode message
            raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode('utf-8')

            # Send email
            sent_message = self.service.users().messages().send(
                userId='me',
                body={'raw': raw_message}
            ).execute()

            self.log(f"Sent email to {to}")

            thread_id = sent_message.get('threadId')
            web_link = f"https://mail.google.com/mail/u/0/#sent/{thread_id}" if thread_id else None

            return ActionResult(
                success=True,
                data={
                    "message_id": sent_message.get('id'),
                    "thread_id": thread_id,
                    "to": to,
                    "subject": subject,
                    "web_link": web_link
                },
                metadata={
                    "sent_at": sent_message.get('internalDate')
                }
            )

        except HttpError as e:
            self.log(f"Gmail API error: {e}", "error")
            return ActionResult(
                success=False,
                error=f"Gmail API error: {e}"
            )
        except Exception as e:
            self.log(f"Error sending email: {e}", "error")
            return ActionResult(success=False, error=str(e))

    async def create_draft(
        self,
        to: str,
        subject: str,
        body: str,
        cc: str = None,
        bcc: str = None,
        html: bool = False
    ) -> ActionResult:
        """
        Create an email draft (safer than sending)

        Args:
            to: Recipient email address
            subject: Email subject
            body: Email body
            cc: CC recipients
            bcc: BCC recipients
            html: Whether body is HTML

        Returns:
            ActionResult with draft data
        """
        try:
            # Create message
            message = MIMEMultipart() if html else MIMEText(body)
            message['to'] = to
            message['subject'] = subject

            if cc:
                message['cc'] = cc
            if bcc:
                message['bcc'] = bcc

            if html:
                message.attach(MIMEText(body, 'html'))

            # Encode message
            raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode('utf-8')

            # Create draft
            draft = self.service.users().drafts().create(
                userId='me',
                body={'message': {'raw': raw_message}}
            ).execute()

            self.log(f"Created draft for {to}")

            draft_id = draft.get('id')
            message_id = draft.get('message', {}).get('id')
            web_link = f"https://mail.google.com/mail/u/0/#drafts/{draft_id}" if draft_id else None

            return ActionResult(
                success=True,
                data={
                    "draft_id": draft_id,
                    "message_id": message_id,
                    "to": to,
                    "subject": subject,
                    "web_link": web_link
                },
                metadata={
                    "is_draft": True
                }
            )

        except HttpError as e:
            self.log(f"Gmail API error: {e}", "error")
            return ActionResult(
                success=False,
                error=f"Gmail API error: {e}"
            )
        except Exception as e:
            self.log(f"Error creating draft: {e}", "error")
            return ActionResult(success=False, error=str(e))

    async def search_emails(
        self,
        query: str,
        max_results: int = 10
    ) -> ActionResult:
        """
        Search user's emails

        Args:
            query: Search query (Gmail search syntax)
            max_results: Maximum number of results to return

        Returns:
            ActionResult with list of matching emails
        """
        try:
            # Search for messages
            results = self.service.users().messages().list(
                userId='me',
                q=query,
                maxResults=max_results
            ).execute()

            messages = results.get('messages', [])

            # Get full message details
            email_list = []
            for msg in messages:
                msg_detail = self.service.users().messages().get(
                    userId='me',
                    id=msg['id'],
                    format='metadata',
                    metadataHeaders=['From', 'To', 'Subject', 'Date']
                ).execute()

                headers = {h['name']: h['value'] for h in msg_detail.get('payload', {}).get('headers', [])}

                email_list.append({
                    "id": msg_detail.get('id'),
                    "thread_id": msg_detail.get('threadId'),
                    "from": headers.get('From'),
                    "to": headers.get('To'),
                    "subject": headers.get('Subject'),
                    "date": headers.get('Date'),
                    "snippet": msg_detail.get('snippet'),
                    "web_link": f"https://mail.google.com/mail/u/0/#inbox/{msg_detail.get('id')}"
                })

            self.log(f"Found {len(email_list)} emails matching '{query}'")

            return ActionResult(
                success=True,
                data={
                    "emails": email_list,
                    "total": len(email_list),
                    "query": query
                }
            )

        except HttpError as e:
            self.log(f"Gmail API error: {e}", "error")
            return ActionResult(
                success=False,
                error=f"Gmail API error: {e}"
            )
        except Exception as e:
            self.log(f"Error searching emails: {e}", "error")
            return ActionResult(success=False, error=str(e))
