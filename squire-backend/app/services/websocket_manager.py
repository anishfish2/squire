"""
WebSocket Manager for real-time communication with Electron clients
"""
import socketio
import json
import asyncio
from typing import Dict, Set, Optional, Any
from datetime import datetime


class WebSocketManager:
    def __init__(self):
        # Create SocketIO server with CORS enabled for Electron app
        self.sio = socketio.AsyncServer(
            cors_allowed_origins="*",
            async_mode='asgi',
            logger=True,
            engineio_logger=True
        )

        # Track active connections
        self.active_connections: Dict[str, Dict[str, Any]] = {}  # sid -> {user_id, session_id, connected_at}
        self.user_connections: Dict[str, Set[str]] = {}  # user_id -> {sids}
        self.session_connections: Dict[str, Set[str]] = {}  # session_id -> {sids}

        # Register event handlers
        self._register_events()

        print("🔌 WebSocket Manager initialized")

    def _register_events(self):
        """Register all WebSocket event handlers"""

        @self.sio.event
        async def connect(sid, environ, auth):
            """Handle client connection"""
            print(f"🔗 Client connected: {sid}")

            # Store connection info
            self.active_connections[sid] = {
                'connected_at': datetime.now().isoformat(),
                'user_id': None,
                'session_id': None
            }

            # Send connection confirmation
            await self.sio.emit('connected', {
                'status': 'connected',
                'sid': sid,
                'timestamp': int(datetime.now().timestamp() * 1000)
            }, room=sid)

            return True

        @self.sio.event
        async def disconnect(sid):
            """Handle client disconnection"""
            print(f"🔌 Client disconnected: {sid}")
            await self._cleanup_connection(sid)

        @self.sio.event
        async def join_user_room(sid, data):
            """Join user-specific room for OCR job notifications"""
            try:
                user_id = data.get('user_id')
                session_id = data.get('session_id')

                if not user_id:
                    await self.sio.emit('error', {'message': 'user_id required'}, room=sid)
                    return

                print(f"👤 User {user_id} joining room (session: {session_id})")

                # Update connection info
                if sid in self.active_connections:
                    self.active_connections[sid].update({
                        'user_id': user_id,
                        'session_id': session_id
                    })

                # Add to user room
                await self.sio.enter_room(sid, f"user_{user_id}")

                # Track user connections
                if user_id not in self.user_connections:
                    self.user_connections[user_id] = set()
                self.user_connections[user_id].add(sid)

                # Track session connections if provided
                if session_id:
                    await self.sio.enter_room(sid, f"session_{session_id}")
                    if session_id not in self.session_connections:
                        self.session_connections[session_id] = set()
                    self.session_connections[session_id].add(sid)

                # Confirm room join
                await self.sio.emit('room_joined', {
                    'user_id': user_id,
                    'session_id': session_id,
                    'rooms': [f"user_{user_id}"] + ([f"session_{session_id}"] if session_id else [])
                }, room=sid)

                print(f"✅ User {user_id} joined rooms successfully")

            except Exception as e:
                print(f"❌ Error joining user room: {e}")
                await self.sio.emit('error', {'message': f'Failed to join room: {str(e)}'}, room=sid)

        @self.sio.event
        async def ping(sid, data):
            """Handle ping for connection health check"""
            await self.sio.emit('pong', {
                'timestamp': int(datetime.now().timestamp() * 1000),
                'data': data
            }, room=sid)

    async def _cleanup_connection(self, sid: str):
        """Clean up connection data when client disconnects"""
        if sid not in self.active_connections:
            return

        connection = self.active_connections[sid]
        user_id = connection.get('user_id')
        session_id = connection.get('session_id')

        # Remove from user connections
        if user_id and user_id in self.user_connections:
            self.user_connections[user_id].discard(sid)
            if not self.user_connections[user_id]:
                del self.user_connections[user_id]

        # Remove from session connections
        if session_id and session_id in self.session_connections:
            self.session_connections[session_id].discard(sid)
            if not self.session_connections[session_id]:
                del self.session_connections[session_id]

        # Remove from active connections
        del self.active_connections[sid]

        print(f"🧹 Cleaned up connection for user {user_id}")

    async def emit_ocr_job_complete(self, user_id: str, job_data: dict):
        """Emit OCR job completion to user"""
        try:
            if user_id not in self.user_connections:
                print(f"⚠️ No active connections for user {user_id}")
                return False

            room = f"user_{user_id}"
            message = {
                'type': 'ocr_job_complete',
                'job_id': job_data.get('job_id'),
                'user_id': user_id,
                'status': job_data.get('status', 'completed'),
                'text_lines': job_data.get('text_lines', []),
                'app_context': job_data.get('app_context', {}),
                'timestamp': int(datetime.now().timestamp() * 1000)
            }

            await self.sio.emit('ocr_job_complete', message, room=room)
            print(f"📡 Emitted OCR job completion to user {user_id}")
            return True

        except Exception as e:
            print(f"❌ Error emitting OCR job completion: {e}")
            return False

    async def emit_batch_progress(self, session_id: str, progress_data: dict):
        """Emit batch processing progress to session"""
        try:
            if session_id not in self.session_connections:
                print(f"⚠️ No active connections for session {session_id}")
                return False

            room = f"session_{session_id}"
            message = {
                'type': 'batch_progress',
                'session_id': session_id,
                'sequence_id': progress_data.get('sequence_id'),
                'status': progress_data.get('status', 'processing'),
                'apps_processed': progress_data.get('apps_processed', 0),
                'total_apps': progress_data.get('total_apps', 0),
                'current_app': progress_data.get('current_app'),
                'timestamp': int(datetime.now().timestamp() * 1000)
            }

            await self.sio.emit('batch_progress', message, room=room)
            print(f"📊 Emitted batch progress to session {session_id}")
            return True

        except Exception as e:
            print(f"❌ Error emitting batch progress: {e}")
            return False

    async def emit_batch_complete(self, session_id: str, completion_data: dict):
        """Emit batch processing completion with suggestions"""
        try:
            if session_id not in self.session_connections:
                print(f"⚠️ No active connections for session {session_id}")
                return False

            room = f"session_{session_id}"
            message = {
                'type': 'batch_complete',
                'session_id': session_id,
                'sequence_id': completion_data.get('sequence_id'),
                'suggestions': completion_data.get('suggestions', []),
                'sequence_metadata': completion_data.get('sequence_metadata', {}),
                'timestamp': int(datetime.now().timestamp() * 1000)
            }

            await self.sio.emit('batch_complete', message, room=room)
            print(f"🎉 Emitted batch completion to session {session_id}")
            return True

        except Exception as e:
            print(f"❌ Error emitting batch completion: {e}")
            return False

    def get_connection_stats(self) -> dict:
        """Get current connection statistics"""
        return {
            'total_connections': len(self.active_connections),
            'user_connections': len(self.user_connections),
            'session_connections': len(self.session_connections),
            'active_users': list(self.user_connections.keys()),
            'active_sessions': list(self.session_connections.keys())
        }


# Global WebSocket manager instance
ws_manager = WebSocketManager()