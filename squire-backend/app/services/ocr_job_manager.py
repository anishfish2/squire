import asyncio
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from enum import Enum
import traceback

from app.core.database import supabase
from app.services.ocr_service import PaddleOCRService
from app.services.websocket_manager import ws_manager


class JobStatus(Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class JobPriority(Enum):
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"


class OCRJobManager:
    def __init__(self, max_workers: int = 4):
        self.max_workers = max_workers
        self.active_workers: Dict[str, asyncio.Task] = {}
        self.ocr_services: Dict[str, PaddleOCRService] = {}  # One per worker
        self.is_running = False

    async def start(self):
        """Start the job processing system"""
        if self.is_running:
            return

        self.is_running = True
        print(f"🚀 Starting OCR Job Manager with {self.max_workers} workers")

        # Start worker tasks
        for i in range(self.max_workers):
            worker_id = f"worker_{i}"
            self.active_workers[worker_id] = asyncio.create_task(
                self._worker_loop(worker_id)
            )

    async def stop(self):
        """Stop the job processing system"""
        self.is_running = False

        # Cancel all workers
        for worker_id, task in self.active_workers.items():
            task.cancel()

        # Wait for workers to finish
        await asyncio.gather(*self.active_workers.values(), return_exceptions=True)
        self.active_workers.clear()
        print("🛑 OCR Job Manager stopped")

    async def queue_ocr_job(
        self,
        image_data: bytes,
        app_context: Dict[str, Any],
        priority: JobPriority = JobPriority.NORMAL
    ) -> str:
        """Queue a new OCR job"""
        job_id = str(uuid.uuid4())

        try:
            # Use the session_id provided from the frontend
            session_id = app_context.get("session_id")

            if not session_id:
                raise Exception("No session_id provided in app_context")

            # Store job in ocr_events table with image data
            job_data = {
                "id": job_id,
                "session_id": session_id,
                "job_status": JobStatus.PENDING.value,
                "job_priority": priority.value,
                "processing_worker_id": None,
                "retry_count": 0,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "started_at": None,
                "completed_at": None,
                "app_name": app_context.get("app_name"),
                "window_title": app_context.get("window_title"),
                "bundle_id": app_context.get("bundle_id"),
                "application_type": self._detect_application_type(app_context),
                "interaction_context": app_context.get("interaction_context", "unknown"),
                "ocr_text": [],
                "extracted_entities": [],
                "error_message": None,
                "image_data_size": len(image_data),
                "context_data": {
                    **app_context.get("session_context", {}),
                    "user_id": app_context.get("user_id")
                }
            }

            # Insert job into database
            result = supabase.table("ocr_events").insert(job_data).execute()

            # Store image data in memory for processing (in production, use Supabase Storage)
            self._store_image_data(job_id, image_data)

            print(f"📋 Queued OCR job {job_id} for {app_context.get('app_name')} ({len(image_data)} bytes)")
            return job_id

        except Exception as e:
            print(f"❌ Failed to queue OCR job: {e}")
            raise

    def _store_image_data(self, job_id: str, image_data: bytes):
        """Store image data temporarily for processing"""
        if not hasattr(self, '_image_store'):
            self._image_store = {}
        self._image_store[job_id] = image_data

    def _get_image_data(self, job_id: str) -> Optional[bytes]:
        """Retrieve stored image data"""
        if not hasattr(self, '_image_store'):
            return None
        return self._image_store.get(job_id)

    def _cleanup_image_data(self, job_id: str):
        """Clean up stored image data after processing"""
        if hasattr(self, '_image_store') and job_id in self._image_store:
            del self._image_store[job_id]

    async def _worker_loop(self, worker_id: str):
        """Main worker loop for processing jobs"""
        print(f"👷 Worker {worker_id} started")

        # Initialize OCR service for this worker
        print(f"👷 Worker {worker_id} initializing OCR service...")
        self.ocr_services[worker_id] = PaddleOCRService()
        print(f"✅ Worker {worker_id} OCR service ready")

        while self.is_running:
            try:
                # Get next pending job
                job = await self._get_next_job(worker_id)

                if job:
                    await self._process_job(worker_id, job)
                else:
                    # No jobs available, wait a bit
                    await asyncio.sleep(1)

            except asyncio.CancelledError:
                print(f"👷 Worker {worker_id} cancelled")
                break
            except Exception as e:
                print(f"❌ Worker {worker_id} error: {e}")
                traceback.print_exc()
                await asyncio.sleep(5)  # Wait before retrying

        # Cleanup worker's OCR service
        if worker_id in self.ocr_services:
            del self.ocr_services[worker_id]
        print(f"👷 Worker {worker_id} stopped")

    async def _get_next_job(self, worker_id: str) -> Optional[Dict]:
        """Get the next pending job for processing"""
        try:
            # Get highest priority pending job
            result = supabase.table("ocr_events").select("*").eq(
                "job_status", JobStatus.PENDING.value
            ).order("job_priority", desc=True).order("created_at").limit(1).execute()

            if not result.data:
                return None

            job = result.data[0]
            job_id = job["id"]

            # Claim the job
            update_result = supabase.table("ocr_events").update({
                "job_status": JobStatus.PROCESSING.value,
                "processing_worker_id": worker_id,
                "started_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", job_id).eq("job_status", JobStatus.PENDING.value).execute()

            if update_result.data:
                return update_result.data[0]
            else:
                # Job was claimed by another worker
                return None

        except Exception as e:
            print(f"❌ Error getting next job: {e}")
            return None

    async def _process_job(self, worker_id: str, job: Dict):
        """Process a single OCR job"""
        job_id = job["id"]

        try:
            print(f"🔄 Worker {worker_id} processing job {job_id}")

            # Retrieve image data
            image_data = self._get_image_data(job_id)
            if not image_data:
                raise Exception(f"No image data found for job {job_id}")

            # Extract text using worker's dedicated OCR service
            worker_ocr = self.ocr_services.get(worker_id)
            if not worker_ocr:
                raise Exception(f"No OCR service initialized for worker {worker_id}")

            text_lines = await asyncio.to_thread(worker_ocr.process_image, image_data)

            print(f"📝 Extracted {len(text_lines)} text lines from job {job_id}")

            # Extract meaningful context from OCR text
            from app.routers.ai import extract_meaningful_context
            meaningful_context = ""
            try:
                meaningful_context = await extract_meaningful_context(
                    text_lines,
                    job.get("app_name", ""),
                    job.get("window_title", "")
                )
                print(f"📝 Meaningful context extracted for job {job_id}: {meaningful_context[:100]}...")
            except Exception as e:
                print(f"⚠️ Failed to extract meaningful context for job {job_id}: {e}")
                meaningful_context = ""

            # Detect interaction context and entities
            interaction_context = self._analyze_interaction_context(job, text_lines)
            extracted_entities = self._extract_entities(text_lines, job)

            # Update job as completed
            completion_data = {
                "job_status": JobStatus.COMPLETED.value,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "ocr_text": text_lines,
                "meaningful_context": meaningful_context,
                "interaction_context": interaction_context,
                "extracted_entities": extracted_entities
            }

            supabase.table("ocr_events").update(completion_data).eq("id", job_id).execute()

            # Emit WebSocket notification for job completion
            await self._emit_job_completion_websocket(job, text_lines, extracted_entities, meaningful_context)

            # Trigger additional processing
            await self._post_process_job(job, text_lines, extracted_entities)

            # Clean up image data
            self._cleanup_image_data(job_id)

            print(f"✅ Worker {worker_id} completed job {job_id}")

        except Exception as e:
            print(f"❌ Worker {worker_id} failed job {job_id}: {e}")

            # Mark job as failed
            retry_count = job.get("retry_count", 0) + 1
            max_retries = 3

            if retry_count < max_retries:
                # Retry the job
                supabase.table("ocr_events").update({
                    "job_status": JobStatus.PENDING.value,
                    "processing_worker_id": None,
                    "retry_count": retry_count,
                    "error_message": str(e)
                }).eq("id", job_id).execute()
            else:
                # Mark as permanently failed
                supabase.table("ocr_events").update({
                    "job_status": JobStatus.FAILED.value,
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "error_message": str(e)
                }).eq("id", job_id).execute()

                # Clean up image data even on failure
                self._cleanup_image_data(job_id)

    def _detect_application_type(self, app_context: Dict) -> str:
        """Detect general application type based on context"""
        app_name = app_context.get("app_name", "").lower()

        # Creative applications
        if any(app in app_name for app in ["blender", "figma", "photoshop", "illustrator", "sketch"]):
            return "creative"

        # Development applications
        elif any(app in app_name for app in ["code", "xcode", "intellij", "terminal", "git"]):
            return "development"

        # Productivity applications
        elif any(app in app_name for app in ["notion", "obsidian", "word", "excel", "powerpoint"]):
            return "productivity"

        # Communication applications
        elif any(app in app_name for app in ["slack", "discord", "teams", "zoom", "mail"]):
            return "communication"

        # Web browsers
        elif any(app in app_name for app in ["chrome", "firefox", "safari", "edge"]):
            return "browser"

        else:
            return "other"

    def _analyze_interaction_context(self, job: Dict, text_lines: List[str]) -> str:
        """Analyze what type of interaction is happening"""
        # Analyze OCR results to determine interaction context
        if not text_lines:
            return "idle"

        text_content = " ".join(text_lines).lower()

        # Check for common UI patterns
        if any(keyword in text_content for keyword in ["menu", "file", "edit", "view", "help"]):
            return "menu_navigation"
        elif any(keyword in text_content for keyword in ["error", "warning", "failed", "exception"]):
            return "error_handling"
        elif any(keyword in text_content for keyword in ["save", "open", "new", "create"]):
            return "file_operations"
        elif any(keyword in text_content for keyword in ["settings", "preferences", "configuration"]):
            return "configuration"
        elif len([line for line in text_lines if len(line) > 50]) > 3:
            return "content_creation"
        else:
            return "active_work"

    def _extract_entities(self, text_lines: List[str], job: Dict) -> List[Dict]:
        """Extract entities from OCR text"""
        entities = []

        # Extract entities from text
        for line in text_lines:
            # Simple entity extraction (would be much more sophisticated)
            if any(keyword in line.lower() for keyword in ["project", "task", "todo"]):
                entities.append({
                    "type": "task",
                    "content": line,
                    "confidence": 0.8
                })

        return entities

    async def _post_process_job(self, job: Dict, text_lines: List[str], extracted_entities: List[Dict]):
        """Additional processing after OCR completion"""
        try:
            # Update user session
            await self._update_user_session(job, text_lines)

            # Update knowledge graph
            await self._update_knowledge_graph(job, extracted_entities)

            # Generate suggestions if appropriate
            await self._generate_suggestions(job, text_lines, extracted_entities)

        except Exception as e:
            print(f"❌ Post-processing error for job {job['id']}: {e}")

    async def _update_user_session(self, job: Dict, text_lines: List[str]):
        """Update current user session with job context"""
        # Implementation for session tracking
        pass

    async def _update_knowledge_graph(self, job: Dict, extracted_entities: List[Dict]):
        """Update knowledge graph with extracted entities"""
        # Implementation for knowledge graph updates
        pass

    async def _generate_suggestions(self, job: Dict, text_lines: List[str], extracted_entities: List[Dict]):
        """Generate AI suggestions based on current context"""
        # Implementation for suggestion generation
        pass

    async def _emit_job_completion_websocket(self, job: Dict, text_lines: List[str], extracted_entities: List[Dict], meaningful_context: str = ""):
        """Emit WebSocket notification for job completion"""
        try:
            # Extract user_id from the session_id (assuming user_id is part of session_id)
            session_id = job.get("session_id")
            if not session_id:
                print(f"⚠️ No session_id found for job {job['id']}, cannot emit WebSocket event")
                return

            # Extract user_id from context_data - this should be provided when queuing the job
            context_data = job.get("context_data", {})
            user_id = context_data.get("user_id") or "550e8400-e29b-41d4-a716-446655440000"  # fallback to known user

            # Debug logging
            print(f"🔍 OCR Job {job['id']} - Session ID: {session_id}")
            print(f"🔍 OCR Job {job['id']} - Context data: {context_data}")
            print(f"🔍 OCR Job {job['id']} - Extracted user_id: {user_id}")

            # Prepare job completion data
            job_data = {
                "job_id": job["id"],
                "session_id": session_id,
                "status": "completed",
                "text_lines": text_lines,
                "app_context": {
                    "app_name": job.get("app_name"),
                    "window_title": job.get("window_title"),
                    "bundle_id": job.get("bundle_id"),
                    "application_type": job.get("application_type"),
                    "interaction_context": job.get("interaction_context"),
                    "meaningful_context": meaningful_context
                },
                "extracted_entities": extracted_entities,
                "completed_at": job.get("completed_at")
            }

            # Emit to user room
            success = await ws_manager.emit_ocr_job_complete(user_id, job_data)

            if success:
                print(f"📡 Emitted WebSocket OCR completion for job {job['id']} to user {user_id}")
            else:
                print(f"⚠️ Failed to emit WebSocket OCR completion for job {job['id']} (no active connections)")

        except Exception as e:
            print(f"❌ Error emitting WebSocket OCR completion for job {job['id']}: {e}")
            # Don't re-raise - this is not critical for job completion

    async def get_job_status(self, job_id: str) -> Optional[Dict]:
        """Get the status of a specific job"""
        try:
            result = supabase.table("ocr_events").select("*").eq("id", job_id).execute()
            return result.data[0] if result.data else None
        except Exception as e:
            print(f"❌ Error getting job status: {e}")
            return None

    async def get_queue_stats(self) -> Dict:
        """Get current queue statistics"""
        try:
            pending = supabase.table("ocr_events").select("id", count="exact").eq(
                "job_status", JobStatus.PENDING.value
            ).execute()

            processing = supabase.table("ocr_events").select("id", count="exact").eq(
                "job_status", JobStatus.PROCESSING.value
            ).execute()

            return {
                "pending_jobs": pending.count or 0,
                "processing_jobs": processing.count or 0,
                "active_workers": len(self.active_workers),
                "is_running": self.is_running
            }
        except Exception as e:
            print(f"❌ Error getting queue stats: {e}")
            return {}

    # Removed SSE emission method - will use WebSocket for real-time notifications