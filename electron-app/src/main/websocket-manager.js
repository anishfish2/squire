import { io } from 'socket.io-client'

class WebSocketManager {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.userId = null;
    this.sessionId = null;
    this.backendUrl = 'http://127.0.0.1:8000';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;

    this.eventHandlers = new Map();

  }

  async connect(userId, sessionId = null) {
    if (this.isConnected) {
      return true;
    }

    try {
      this.userId = userId;
      this.sessionId = sessionId;


      this.socket = io(this.backendUrl, {
        transports: ['websocket'],
        upgrade: false,
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectDelay,
        timeout: 10000
      });

      this._setupEventListeners();

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);

        this.socket.on('connect', () => {
          clearTimeout(timeout);
          this.isConnected = true;
          this.reconnectAttempts = 0;

          this._joinUserRoom();
          resolve(true);
        });

        this.socket.on('connect_error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

    } catch (error) {
      return false;
    }
  }

  _setupEventListeners() {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      this.isConnected = true;
      this._joinUserRoom();
    });

    this.socket.on('disconnect', (reason) => {
      this.isConnected = false;

      if (reason === 'io server disconnect') {
        this._attemptReconnect();
      }
    });

    this.socket.on('connect_error', (error) => {
      this._attemptReconnect();
    });

    this.socket.on('connected', (data) => {
    });

    this.socket.on('room_joined', (data) => {
    });

    this.socket.on('ocr_job_complete', (data) => {
      this._emitEvent('ocr_job_complete', data);
    });

    this.socket.on('batch_progress', (data) => {
      this._emitEvent('batch_progress', data);
    });

    this.socket.on('batch_complete', (data) => {
      this._emitEvent('batch_complete', data);
    });

    this.socket.on('error', (error) => {
      this._emitEvent('error', error);
    });

    this.socket.on('pong', (data) => {
    });
  }

  _joinUserRoom() {
    if (!this.socket || !this.userId) return;


    this.socket.emit('join_user_room', {
      user_id: this.userId,
      session_id: this.sessionId
    });
  }

  _attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);


    setTimeout(() => {
      if (!this.isConnected && this.userId) {
        this.connect(this.userId, this.sessionId).catch(error => {
          console.warn('⚠️ [WebSocketManager] Reconnect attempt failed:', error?.message || error);
        });
      }
    }, delay);
  }

  _emitEvent(eventName, data) {
    const handlers = this.eventHandlers.get(eventName);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
        }
      });
    }
  }

  onOCRJobComplete(handler) {
    this.addEventListener('ocr_job_complete', handler);
  }

  onBatchProgress(handler) {
    this.addEventListener('batch_progress', handler);
  }

  onBatchComplete(handler) {
    this.addEventListener('batch_complete', handler);
  }

  onError(handler) {
    this.addEventListener('error', handler);
  }

  addEventListener(eventName, handler) {
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, []);
    }
    this.eventHandlers.get(eventName).push(handler);
  }

  removeEventListener(eventName, handler) {
    const handlers = this.eventHandlers.get(eventName);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  ping() {
    if (this.socket && this.isConnected) {
      this.socket.emit('ping', { timestamp: Date.now() });
    }
  }

  async getConnectionStats() {
    if (!this.isConnected) {
      return { connected: false };
    }

    try {
      const response = await fetch(`${this.backendUrl}/api/ws/stats`);
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
    }

    return { connected: this.isConnected, error: 'Failed to get stats' };
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
    this.userId = null;
    this.sessionId = null;
    this.reconnectAttempts = 0;
  }

  get connected() {
    return this.isConnected;
  }

  get currentUserId() {
    return this.userId;
  }

  get currentSessionId() {
    return this.sessionId;
  }
}

export default WebSocketManager
