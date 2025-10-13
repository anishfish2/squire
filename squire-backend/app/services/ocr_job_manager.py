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
        self.ocr_services: Dict[str, PaddleOCRService] = {}
        self.is_running = False

    async def start(self):
        if self.is_running:
            return

        self.is_running = True

        for i in range(self.max_workers):
            worker_id = f"worker_{i}"
            self.active_workers[worker_id] = asyncio.create_task(
                self._worker_loop(worker_id)
            )

    async def stop(self):
        self.is_running = False

        for worker_id, task in self.active_workers.items():
            task.cancel()

        await asyncio.gather(*self.active_workers.values(), return_exceptions=True)
        self.active_workers.clear()

    async def queue_ocr_job(
        self,
        image_data: bytes,
        app_context: Dict[str, Any],
        priority: JobPriority = JobPriority.NORMAL
    ) -> str:
        job_id = str(uuid.uuid4())

        try:
            session_id = app_context.get("session_id")

            if not session_id:
                raise Exception("No session_id provided in app_context")

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

            result = supabase.table("ocr_events").insert(job_data).execute()

            self._store_image_data(job_id, image_data)

            return job_id

        except Exception as e:
            raise

    def _store_image_data(self, job_id: str, image_data: bytes):
        if not hasattr(self, '_image_store'):
            self._image_store = {}
        self._image_store[job_id] = image_data

    def _get_image_data(self, job_id: str) -> Optional[bytes]:
        if not hasattr(self, '_image_store'):
            return None
        return self._image_store.get(job_id)

    def _cleanup_image_data(self, job_id: str):
        if hasattr(self, '_image_store') and job_id in self._image_store:
            del self._image_store[job_id]

    async def _worker_loop(self, worker_id: str):
        self.ocr_services[worker_id] = PaddleOCRService()

        while self.is_running:
            try:
                job = await self._get_next_job(worker_id)

                if job:

                    await self._process_job(worker_id, job)
                else:
                    await asyncio.sleep(1)

            except asyncio.CancelledError:
                break
            except Exception as e:
                traceback.print_exc()
                await asyncio.sleep(5)

        if worker_id in self.ocr_services:
            del self.ocr_services[worker_id]

    async def _get_next_job(self, worker_id: str) -> Optional[Dict]:
        try:
            result = supabase.table("ocr_events").select("*").eq(
                "job_status", JobStatus.PENDING.value
            ).order("job_priority", desc=True).order("created_at").limit(1).execute()

            if not result.data:
                return None

            job = result.data[0]
            job_id = job["id"]

            update_result = supabase.table("ocr_events").update({
                "job_status": JobStatus.PROCESSING.value,
                "processing_worker_id": worker_id,
                "started_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", job_id).eq("job_status", JobStatus.PENDING.value).execute()

            if update_result.data:
                return update_result.data[0]
            else:
                return None

        except Exception as e:
            return None

    async def _process_job(self, worker_id: str, job: Dict):
        job_id = job["id"]
        from app.routers.ai import extract_meaningful_context, extract_session_context


        try:
            image_data = self._get_image_data(job_id)
            if not image_data:
                raise Exception(f"No image data found for job {job_id}")

            worker_ocr = self.ocr_services.get(worker_id)
            if not worker_ocr:
                raise Exception(f"No OCR service initialized for worker {worker_id}")

            text_lines = await asyncio.to_thread(worker_ocr.process_image, image_data)


            meaningful_context = ""
            session_context_data = {}
            try:
                meaningful_context = await extract_meaningful_context(
                    text_lines,
                    job.get("app_name", ""),
                    job.get("window_title", "")
                )

                session_context_data = await extract_session_context(
                    text_lines,
                    job.get("app_name", ""),
                    job.get("window_title", "")
                )
            except Exception as e:
                print(f"⚠️ Failed to extract meaningful context for job {job['id']}: {e}")
                meaningful_context = ""
                session_context_data = {}

            interaction_context = self._analyze_interaction_context(job, text_lines)
            extracted_entities = self._extract_entities(text_lines, job)

            completion_data = {
                "job_status": JobStatus.COMPLETED.value,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "ocr_text": text_lines,
                "meaningful_context": meaningful_context,
                "interaction_context": interaction_context,
                "extracted_entities": extracted_entities
            }

            supabase.table("ocr_events").update(completion_data).eq("id", job_id).execute()

            await self._emit_job_completion_websocket(job, text_lines, extracted_entities, meaningful_context)

            # Update job dict with completion data for post-processing
            job.update(completion_data)

            await self._post_process_job(job, text_lines, extracted_entities, session_context_data)

            self._cleanup_image_data(job_id)

        except Exception as e:

            retry_count = job.get("retry_count", 0) + 1
            max_retries = 3

            if retry_count < max_retries:
                supabase.table("ocr_events").update({
                    "job_status": JobStatus.PENDING.value,
                    "processing_worker_id": None,
                    "retry_count": retry_count,
                    "error_message": str(e)
                }).eq("id", job_id).execute()
            else:
                supabase.table("ocr_events").update({
                    "job_status": JobStatus.FAILED.value,
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "error_message": str(e)
                }).eq("id", job_id).execute()

                self._cleanup_image_data(job_id)

    def _detect_application_type(self, app_context: Dict) -> str:
        app_name = app_context.get("app_name", "").lower()

        if any(app in app_name for app in ["blender", "figma", "photoshop", "illustrator", "sketch"]):
            return "creative"

        elif any(app in app_name for app in ["code", "xcode", "intellij", "terminal", "git"]):
            return "development"

        elif any(app in app_name for app in ["notion", "obsidian", "word", "excel", "powerpoint"]):
            return "productivity"

        elif any(app in app_name for app in ["slack", "discord", "teams", "zoom", "mail"]):
            return "communication"

        elif any(app in app_name for app in ["chrome", "firefox", "safari", "edge"]):
            return "browser"

        else:
            return "other"

    def _analyze_interaction_context(self, job: Dict, text_lines: List[str]) -> str:
        if not text_lines:
            return "idle"

        text_content = " ".join(text_lines).lower()

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
        entities = []

        for line in text_lines:
            if any(keyword in line.lower() for keyword in ["project", "task", "todo"]):
                entities.append({
                    "type": "task",
                    "content": line,
                    "confidence": 0.8
                })

        return entities

    async def _post_process_job(self, job: Dict, text_lines: List[str], extracted_entities: List[Dict], session_context_data: Dict = None):
        try:
            await self._update_app_session(job, session_context_data or {})

            await self._update_user_session(job, text_lines)

            await self._update_knowledge_graph(job, extracted_entities)

        except Exception as e:
            print(f"❌ Error in _post_process_job: {e}")
            import traceback
            traceback.print_exc()

    async def _update_app_session(self, job: Dict, session_context_data: Dict):
        try:
            from app.services.app_session_service import AppSessionService

            context_data = job.get("context_data", {})
            user_id = context_data.get("user_id")
            session_id = job.get("session_id")

            if not user_id or not session_id:
                return

            await AppSessionService.create_or_update_app_session(
                user_id=user_id,
                session_id=session_id,
                app_name=job.get("app_name", "Unknown"),
                window_title=job.get("window_title", ""),
                bundle_id=job.get("bundle_id", ""),
                context_type=session_context_data.get("context_type", "general"),
                domain=session_context_data.get("domain", "general"),
                activity_summary=session_context_data.get("activity_summary", "")
            )

        except Exception as e:
            pass

    async def _update_user_session(self, job: Dict, text_lines: List[str]):
        pass

    async def _update_knowledge_graph(self, job: Dict, extracted_entities: List[Dict]):
        try:
            from app.core.database import supabase
            from app.routers.ai import get_openai_client

            context_data = job.get("context_data", {})
            user_id = context_data.get("user_id")

            if not user_id:
                return

            meaningful_context = job.get("meaningful_context", "")
            ocr_text = job.get("ocr_text", [])

            # Prefer meaningful context, fallback to raw OCR only if needed
            if not meaningful_context and (not ocr_text or len(ocr_text) == 0):
                print("⚠️ No context available for knowledge graph")
                return

            # Use meaningful context if available, otherwise use raw OCR
            content_for_analysis = meaningful_context if meaningful_context else '\n'.join(ocr_text[:50])

            if meaningful_context:
                pass
            else:
                pass

            client = get_openai_client()
            if not client:
                print("❌ No OpenAI client for knowledge graph")
                return

            content = content_for_analysis

            prompt = f"""Analyze this user's screen content and extract knowledge graph insights about their work patterns, goals, habits, and expertise.

APP: {job.get("app_name", "")}
WINDOW: {job.get("window_title", "")}

CONTEXT SUMMARY:
{content}

Extract insights in these categories:

1. HABITS - Recurring work patterns (e.g., "reviews pull requests in the morning", "tests code before committing")
2. SKILLS - Technical or domain expertise demonstrated (e.g., "proficient in React hooks", "experienced with SQL optimization")
3. GOALS - Stated or implied objectives (e.g., "building authentication system", "learning TypeScript")
4. WORKFLOWS - Multi-step processes they follow (e.g., "writes tests before implementation", "uses git branches for features")
5. PREFERENCES - Tool usage patterns or work style (e.g., "prefers dark mode", "uses keyboard shortcuts extensively")
6. PATTERNS - Notable behavioral patterns (e.g., "debugs by adding console logs", "references documentation frequently")

Return JSON with only the insights that are clearly evident from the content. Each insight should be specific and actionable.

Format:
{{
  "habits": [
    {{"description": "specific habit", "confidence": 0.8}}
  ],
  "skills": [
    {{"description": "specific skill with evidence", "proficiency": "beginner|intermediate|advanced", "confidence": 0.7}}
  ],
  "goals": [
    {{"description": "specific goal", "timeframe": "short|medium|long", "confidence": 0.6}}
  ],
  "workflows": [
    {{"description": "specific workflow pattern", "confidence": 0.8}}
  ],
  "preferences": [
    {{"description": "specific preference", "confidence": 0.7}}
  ],
  "patterns": [
    {{"description": "specific behavioral pattern", "confidence": 0.7}}
  ]
}}

Only include insights with confidence > 0.6. Return empty arrays if no clear insights are found.
"""

            try:
                response = client.chat.completions.create(
                    model="gpt-5",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.3,
                    max_tokens=500,
                    response_format={"type": "json_object"}
                )

                result_text = response.choices[0].message.content.strip()

                import json
                if result_text.startswith("```"):
                    result_text = result_text.split("```")[1]
                    if result_text.startswith("json"):
                        result_text = result_text[4:]
                result_text = result_text.strip()

                insights = json.loads(result_text)

                node_type_mapping = {
                    "habits": "habit",
                    "skills": "skill",
                    "goals": "goal",
                    "workflows": "workflow",
                    "preferences": "preference",
                    "patterns": "pattern"
                }

                created_nodes = []  # Track created nodes for relationship building

                for category, node_type in node_type_mapping.items():
                    items = insights.get(category, [])
                    for item in items[:2]:
                        try:
                            confidence = item.get("confidence", 0.7)
                            if confidence < 0.6:
                                continue

                            content_data = {
                                "description": item.get("description", ""),
                                "source": "llm_analysis",
                                "context": {
                                    "app": job.get("app_name"),
                                    "window": job.get("window_title"),
                                    "timestamp": job.get("created_at")
                                }
                            }

                            if "proficiency" in item:
                                content_data["proficiency"] = item["proficiency"]
                            if "timeframe" in item:
                                content_data["timeframe"] = item["timeframe"]

                            result = supabase.rpc(
                                "upsert_knowledge_node",
                                {
                                    "p_user_id": user_id,
                                    "p_node_type": node_type,
                                    "p_content": content_data,
                                    "p_weight": confidence,
                                    "p_source_event_ids": [],
                                    "p_metadata": {
                                        "confidence": confidence,
                                        "extracted_at": job.get("created_at"),
                                        "source_job_id": job.get("id")
                                    }
                                }
                            ).execute()

                            node_id = result.data
                            created_nodes.append({
                                "id": node_id,
                                "type": node_type,
                                "description": content_data["description"]
                            })

                        except Exception as e:
                            import traceback
                            traceback.print_exc()

                # Create relationships between nodes
                if len(created_nodes) >= 2:
                    self._create_node_relationships(user_id, created_nodes)

            except Exception as e:
                print(f"❌ Failed to parse knowledge insights: {e}")
                print(f"   Raw response: {result_text[:200]}")
                import traceback
                traceback.print_exc()

        except Exception as e:
            print(f"❌ Knowledge graph update failed: {e}")
            import traceback
            traceback.print_exc()

    def _create_node_relationships(self, user_id: str, nodes: List[Dict]):
        """Create relationships between knowledge nodes based on their types"""
        try:
            from app.core.database import supabase

            # Define relationship rules: (source_type, target_type, relationship_type)
            relationship_rules = [
                ("skill", "tool", "uses"),
                ("goal", "skill", "requires"),
                ("workflow", "tool", "uses"),
                ("habit", "workflow", "follows"),
                ("pattern", "skill", "demonstrates"),
            ]

            for i, node1 in enumerate(nodes):
                for node2 in nodes[i+1:]:
                    # Check if there's a rule for this pair
                    relationship_type = None
                    for source_type, target_type, rel_type in relationship_rules:
                        if node1["type"] == source_type and node2["type"] == target_type:
                            relationship_type = rel_type
                            break
                        elif node2["type"] == source_type and node1["type"] == target_type:
                            relationship_type = rel_type
                            node1, node2 = node2, node1  # Swap to match rule direction
                            break

                    if relationship_type:
                        try:
                            supabase.table("knowledge_relationships").insert({
                                "user_id": user_id,
                                "source_node_id": node1["id"],
                                "target_node_id": node2["id"],
                                "relationship_type": relationship_type,
                                "strength": 0.7,
                                "metadata": {
                                    "auto_created": True,
                                    "source_desc": node1["description"][:50],
                                    "target_desc": node2["description"][:50]
                                }
                            }).execute()

                            print(f"✅ Created relationship: {node1['type']} -{relationship_type}-> {node2['type']}")

                        except Exception as e:
                            # Might fail if relationship already exists, that's okay
                            pass

        except Exception as e:
            print(f"❌ Failed to create relationships: {e}")

    async def _emit_job_completion_websocket(self, job: Dict, text_lines: List[str], extracted_entities: List[Dict], meaningful_context: str = ""):
        try:
            session_id = job.get("session_id")
            if not session_id:
                return

            context_data = job.get("context_data", {})
            user_id = context_data.get("user_id")

            if not user_id:
                print("⚠️ Missing user_id for OCR job completion event; skipping websocket emit")
                return

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

            await ws_manager.emit_ocr_job_complete(user_id, job_data)

        except Exception as e:
            pass

    async def get_job_status(self, job_id: str) -> Optional[Dict]:
        try:
            result = supabase.table("ocr_events").select("*").eq("id", job_id).execute()
            return result.data[0] if result.data else None
        except Exception as e:
            return None

    async def get_queue_stats(self) -> Dict:
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
            return {}
