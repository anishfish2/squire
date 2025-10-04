"""
Vision Job Manager Service

Handles the vision job queue:
1. Receives screenshot uploads from Electron
2. Uploads screenshots to S3 (if allow_screenshots is enabled)
3. Creates vision_events records with 'pending' status
4. Queues vision API requests for processing

This service manages the asynchronous vision processing pipeline.
"""

import asyncio
import uuid
from datetime import datetime
from typing import Optional, Dict, Any
from app.services.s3_service import s3_service
from app.services.vision_service import vision_service
from app.core.database import supabase
import logging

logger = logging.getLogger(__name__)


class VisionJobManager:
    def __init__(self):
        self.processing_queue = asyncio.Queue()
        self.is_processing = False

    async def create_vision_job(
        self,
        user_id: str,
        screenshot_data: bytes,
        app_name: str,
        session_id: str,
        allow_screenshots: bool = False,
        ocr_event_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a new vision job from screenshot data.

        Args:
            user_id: User UUID
            screenshot_data: Raw screenshot bytes (PNG format)
            app_name: Application name
            session_id: Session UUID
            allow_screenshots: Whether to store screenshot in S3
            ocr_event_id: Optional OCR event to link to

        Returns:
            Dict with job_id, status, and optional screenshot_url
        """
        try:
            job_id = str(uuid.uuid4())
            screenshot_url = None
            screenshot_storage_path = None

            logger.info(f"\n{'='*60}")
            logger.info(f"📸 [VisionJobManager] CREATE VISION JOB")
            logger.info(f"   Job ID: {job_id}")
            logger.info(f"   User ID: {user_id}")
            logger.info(f"   App: {app_name}")
            logger.info(f"   Screenshot size: {len(screenshot_data) / 1024:.2f} KB")
            logger.info(f"   Store in S3: {allow_screenshots}")
            logger.info(f"{'='*60}")

            # Upload to S3 if allowed
            if allow_screenshots:
                logger.info(f"📸 [VisionJobManager] Uploading screenshot to S3...")
                upload_result = await s3_service.upload_screenshot(
                    user_id=user_id,
                    screenshot_data=screenshot_data,
                    session_id=session_id,
                    screenshot_id=job_id
                )
                screenshot_url = upload_result["url"]
                screenshot_storage_path = upload_result["storage_path"]
                logger.info(f"✅ [VisionJobManager] Screenshot uploaded to S3:")
                logger.info(f"   - Path: {screenshot_storage_path}")
                logger.info(f"   - URL: {screenshot_url[:80]}...")
            else:
                logger.info(f"⚠️ [VisionJobManager] Screenshot storage disabled (not saving to S3)")

            # Create vision_events record
            vision_event_data = {
                "id": job_id,
                "user_id": user_id,
                "ocr_event_id": ocr_event_id,
                "screenshot_url": screenshot_url,
                "screenshot_storage_path": screenshot_storage_path,
                "status": "pending",
                "vision_analysis": None,
                "vision_model": None,
                "created_at": datetime.utcnow().isoformat(),
                "app_name": app_name  # Store app context
            }

            result = supabase.table("vision_events").insert(vision_event_data).execute()

            if not result.data:
                logger.error(f"❌ [VisionJobManager] Failed to create vision_events record for job {job_id}")
                raise Exception("Failed to create vision event")

            logger.info(f"✅ [VisionJobManager] Database record created")
            logger.info(f"   - Table: vision_events")
            logger.info(f"   - Status: pending")

            # Process vision analysis immediately
            logger.info(f"🔮 [VisionJobManager] Starting vision analysis...")
            await self.process_vision_job(job_id, screenshot_data, app_name)

            return {
                "job_id": job_id,
                "status": "processing",
                "screenshot_url": screenshot_url,
                "screenshot_storage_path": screenshot_storage_path,
                "allow_screenshots": allow_screenshots,
                "app_name": app_name
            }

        except Exception as e:
            logger.error(f"❌ Error creating vision job: {e}")
            raise

    async def _update_job_status(self, job_id: str, status: str):
        """Update vision job status"""
        try:
            supabase.table("vision_events")\
                .update({"status": status, "updated_at": datetime.utcnow().isoformat()})\
                .eq("id", job_id)\
                .execute()
            logger.info(f"📊 Job {job_id} status: {status}")
        except Exception as e:
            logger.error(f"❌ Error updating job status: {e}")

    async def get_job_status(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get vision job status"""
        try:
            result = supabase.table("vision_events")\
                .select("*")\
                .eq("id", job_id)\
                .execute()

            if result.data and len(result.data) > 0:
                return result.data[0]
            return None

        except Exception as e:
            logger.error(f"❌ Error getting job status: {e}")
            return None

    async def process_vision_job(
        self,
        job_id: str,
        screenshot_data: bytes,
        app_name: str
    ):
        """
        Process a vision job using Vision API.

        Args:
            job_id: Vision job ID
            screenshot_data: Screenshot bytes
            app_name: Application name for context
        """
        try:
            logger.info(f"🔮 [VisionJobManager] PROCESSING VISION JOB")
            logger.info(f"   Job ID: {job_id}")
            logger.info(f"   App: {app_name}")

            # Update status to processing
            await self._update_job_status(job_id, "processing")

            # Check if vision service is available
            if not vision_service.is_available():
                logger.error("❌ [VisionJobManager] Vision service not available (no API keys configured)")
                await self._update_job_status(job_id, "failed")
                await self._update_job_error(job_id, "Vision API not configured")
                return

            logger.info(f"🤖 [VisionJobManager] Calling Vision API (this may take 5-10 seconds)...")

            # Call Vision API
            start_time = datetime.utcnow()
            analysis_result = await vision_service.analyze_screenshot(
                screenshot_data=screenshot_data,
                app_name=app_name
            )
            end_time = datetime.utcnow()
            processing_time = (end_time - start_time).total_seconds()

            logger.info(f"✅ [VisionJobManager] Vision analysis complete!")
            logger.info(f"   - Processing time: {processing_time:.2f}s")
            logger.info(f"   - Model: {analysis_result.get('model', 'unknown')}")
            logger.info(f"   - Provider: {analysis_result.get('provider', 'unknown')}")
            logger.info(f"\n📊 [VisionJobManager] ANALYSIS RESULTS:")
            logger.info(f"   - Task: {analysis_result.get('task', 'N/A')[:100]}")
            logger.info(f"   - UI Elements: {len(analysis_result.get('ui_elements', []))} found")
            logger.info(f"   - Context: {analysis_result.get('context', 'N/A')[:100]}")

            # Update vision_events with analysis results
            update_data = {
                "vision_analysis": analysis_result,
                "vision_model": analysis_result.get("model"),
                "status": "completed",
                "updated_at": datetime.utcnow().isoformat()
            }

            supabase.table("vision_events")\
                .update(update_data)\
                .eq("id", job_id)\
                .execute()

            logger.info(f"✅ [VisionJobManager] Job {job_id} completed successfully")
            logger.info(f"   - Status: completed")
            logger.info(f"   - Stored in: vision_events table")
            logger.info(f"{'='*60}\n")

        except Exception as e:
            logger.error(f"❌ Error processing vision job {job_id}: {e}")
            await self._update_job_status(job_id, "failed")
            await self._update_job_error(job_id, str(e))

    async def _update_job_error(self, job_id: str, error: str):
        """Update vision job with error message"""
        try:
            # Store error in vision_analysis as metadata
            supabase.table("vision_events")\
                .update({
                    "vision_analysis": {"error": error},
                    "updated_at": datetime.utcnow().isoformat()
                })\
                .eq("id", job_id)\
                .execute()
            logger.info(f"📊 Job {job_id} error logged: {error}")
        except Exception as e:
            logger.error(f"❌ Error updating job error: {e}")

    async def get_recent_vision_events(
        self,
        user_id: str,
        limit: int = 5,
        app_name: Optional[str] = None,
        max_age_minutes: int = 60,  # Only get events from last 60 minutes
        only_unused: bool = True  # Only get events not yet used in LLM
    ) -> list:
        """
        Get recent vision events for a user.

        Used to fetch vision context for LLM suggestions.

        Args:
            user_id: User UUID
            limit: Max number of events to return
            app_name: Optional filter by app name
            max_age_minutes: Maximum age of events in minutes (default: 60)
            only_unused: Only return events not yet used in LLM (default: True)

        Returns:
            List of vision events with analysis
        """
        try:
            # Calculate cutoff time
            from datetime import timedelta
            cutoff_time = (datetime.utcnow() - timedelta(minutes=max_age_minutes)).isoformat()

            logger.info(f"\n{'='*60}")
            logger.info(f"🔍 [VisionJobManager] GET RECENT VISION EVENTS")
            logger.info(f"   User ID: {user_id}")
            logger.info(f"   App filter: {app_name or 'None (all apps)'}")
            logger.info(f"   Limit: {limit}")
            logger.info(f"   Max age: {max_age_minutes} minutes (after {cutoff_time})")
            logger.info(f"   Only unused: {only_unused}")

            query = supabase.table("vision_events")\
                .select("*")\
                .eq("user_id", user_id)\
                .eq("status", "completed")\
                .is_("deleted_at", "null")\
                .gte("created_at", cutoff_time)\
                .order("created_at", desc=True)\
                .limit(limit)

            # Filter for unused events only
            if only_unused:
                query = query.eq("used_in_llm", False)

            if app_name:
                query = query.eq("app_name", app_name)

            result = query.execute()

            logger.info(f"   Found {len(result.data) if result.data else 0} {'unused ' if only_unused else ''}events")

            if result.data:
                for i, event in enumerate(result.data, 1):
                    created_at = event.get("created_at", "unknown")
                    app = event.get("app_name", "unknown")
                    used = event.get("used_in_llm", False)
                    analysis = event.get("vision_analysis", {})
                    task = analysis.get("task", "N/A")[:60] + "..." if len(analysis.get("task", "")) > 60 else analysis.get("task", "N/A")
                    logger.info(f"   {i}. [{created_at}] {app} [used={used}]: {task}")

            logger.info(f"{'='*60}\n")

            return result.data if result.data else []

        except Exception as e:
            logger.error(f"❌ Error getting recent vision events: {e}")
            import traceback
            traceback.print_exc()
            return []

    async def mark_events_as_used(self, event_ids: list[str]) -> bool:
        """
        Mark vision events as used in LLM context.

        Args:
            event_ids: List of vision event IDs to mark as used

        Returns:
            True if successful, False otherwise
        """
        try:
            if not event_ids:
                return True

            logger.info(f"\n📌 [VisionJobManager] MARKING EVENTS AS USED")
            logger.info(f"   Event count: {len(event_ids)}")
            logger.info(f"   Event IDs: {', '.join(event_ids[:3])}{'...' if len(event_ids) > 3 else ''}")

            # Update all events in one batch
            result = supabase.table("vision_events")\
                .update({
                    "used_in_llm": True,
                    "used_in_llm_at": datetime.utcnow().isoformat()
                })\
                .in_("id", event_ids)\
                .execute()

            logger.info(f"✅ Marked {len(event_ids)} events as used in LLM")
            return True

        except Exception as e:
            logger.error(f"❌ Error marking events as used: {e}")
            import traceback
            traceback.print_exc()
            return False


# Singleton instance
vision_job_manager = VisionJobManager()
