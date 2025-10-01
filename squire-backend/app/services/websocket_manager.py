import socketio
import json
import asyncio
from typing import Dict, Set, Optional, Any
from datetime import datetime


class WebSocketManager:
    def __init__(self):
        self.sio = socketio.AsyncServer(
            cors_allowed_origins="*",
            async_mode='asgi',
            logger=False,
            engineio_logger=False
        )

        self.active_connections: Dict[str, Dict[str, Any]] = {}
        self.user_connections: Dict[str, Set[str]] = {}
        self.session_connections: Dict[str, Set[str]] = {}

        self._register_events()

    def _register_events(self):

        @self.sio.event
        async def connect(sid, environ, auth):
            self.active_connections[sid] = {
                'connected_at': datetime.now().isoformat(),
                'user_id': None,
                'session_id': None
            }

            await self.sio.emit('connected', {
                'status': 'connected',
                'sid': sid,
                'timestamp': int(datetime.now().timestamp() * 1000)
            }, room=sid)

            return True

        @self.sio.event
        async def disconnect(sid):
            await self._cleanup_connection(sid)

        @self.sio.event
        async def join_user_room(sid, data):
            try:
                user_id = data.get('user_id')
                session_id = data.get('session_id')

                if not user_id:
                    await self.sio.emit('error', {'message': 'user_id required'}, room=sid)
                    return

                if sid in self.active_connections:
                    self.active_connections[sid].update({
                        'user_id': user_id,
                        'session_id': session_id
                    })

                await self.sio.enter_room(sid, f"user_{user_id}")

                if user_id not in self.user_connections:
                    self.user_connections[user_id] = set()
                self.user_connections[user_id].add(sid)

                if session_id:
                    await self.sio.enter_room(sid, f"session_{session_id}")
                    if session_id not in self.session_connections:
                        self.session_connections[session_id] = set()
                    self.session_connections[session_id].add(sid)

                await self.sio.emit('room_joined', {
                    'user_id': user_id,
                    'session_id': session_id,
                    'rooms': [f"user_{user_id}"] + ([f"session_{session_id}"] if session_id else [])
                }, room=sid)

            except Exception as e:
                await self.sio.emit('error', {'message': f'Failed to join room: {str(e)}'}, room=sid)

        @self.sio.event
        async def ping(sid, data):
            await self.sio.emit('pong', {
                'timestamp': int(datetime.now().timestamp() * 1000),
                'data': data
            }, room=sid)

    async def _cleanup_connection(self, sid: str):
        if sid not in self.active_connections:
            return

        connection = self.active_connections[sid]
        user_id = connection.get('user_id')
        session_id = connection.get('session_id')

        if user_id and user_id in self.user_connections:
            self.user_connections[user_id].discard(sid)
            if not self.user_connections[user_id]:
                del self.user_connections[user_id]

        if session_id and session_id in self.session_connections:
            self.session_connections[session_id].discard(sid)
            if not self.session_connections[session_id]:
                del self.session_connections[session_id]

        del self.active_connections[sid]

    async def emit_ocr_job_complete(self, user_id: str, job_data: dict):
        try:
            if user_id not in self.user_connections:
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
            return True

        except Exception as e:
            return False

    async def emit_batch_progress(self, session_id: str, progress_data: dict):
        try:
            if session_id not in self.session_connections:
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
            return True

        except Exception as e:
            return False

    async def emit_batch_complete(self, session_id: str, completion_data: dict):
        try:
            if session_id not in self.session_connections:
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
            return True

        except Exception as e:
            return False

    def get_connection_stats(self) -> dict:
        return {
            'total_connections': len(self.active_connections),
            'user_connections': len(self.user_connections),
            'session_connections': len(self.session_connections),
            'active_users': list(self.user_connections.keys()),
            'active_sessions': list(self.session_connections.keys())
        }


ws_manager = WebSocketManager()