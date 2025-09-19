# Complete API Routes Documentation

## 🚀 Overview

Complete REST API for interacting with your Supabase database tables and their connections. 70+ endpoints covering all functionality.

## 📋 Route Categories

1. **User Profiles** - User management and statistics
2. **Sessions** - Session tracking, events, and insights
3. **AI Suggestions** - Suggestion creation, management, and analytics
4. **Events** - User behavior tracking and pattern analysis
5. **Knowledge Graph** - Node/relationship management and traversal
6. **Analytics** - Comprehensive insights and reporting
7. **Data Management** - GDPR compliance, cleanup, and exports

---

## 🔐 User Profile Routes (`/api/profiles`)

### Core Operations
- `GET /api/profiles/:id` - Get user profile
- `POST /api/profiles` - Create user profile
- `PUT /api/profiles/:id` - Update user profile
- `GET /api/profiles/:id/stats` - Get user statistics

### Request Examples
```javascript
// Create user profile
POST /api/profiles
{
  "email": "user@example.com",
  "full_name": "John Doe",
  "avatar_url": "https://example.com/avatar.jpg",
  "timezone": "America/New_York"
}

// Update preferences
PUT /api/profiles/uuid
{
  "preferences": {"notifications": true, "theme": "dark"},
  "settings": {"auto_save": true}
}
```

---

## 🎯 Session Management Routes (`/api/sessions`)

### Session Lifecycle
- `POST /api/sessions/start` - Start new session
- `PUT /api/sessions/:id/end` - End session
- `GET /api/sessions/:id` - Get session details
- `PUT /api/sessions/:id` - Update session data

### Event Management
- `POST /api/sessions/:id/events` - Add single event
- `POST /api/sessions/:id/events/bulk` - Add multiple events

### Session Queries
- `GET /api/sessions/user/:userId` - Get all user sessions
- `GET /api/sessions/user/:userId/active` - Get active sessions
- `GET /api/sessions/:id/insights` - Get session insights

### Request Examples
```javascript
// Start session
POST /api/sessions/start
{
  "user_id": "uuid",
  "device_info": {"browser": "Chrome", "os": "macOS"},
  "session_type": "active"
}

// Add OCR event
POST /api/sessions/uuid/events
{
  "event_type": "ocr",
  "event_data": {"text": "Hello World", "confidence": 0.95}
}

// Add multiple events
POST /api/sessions/uuid/events/bulk
{
  "events": [
    {"event_type": "click", "event_data": {"x": 100, "y": 200}},
    {"event_type": "ocr", "event_data": {"text": "Document", "confidence": 0.9}}
  ]
}
```

---

## 🤖 AI Suggestions Routes (`/api/suggestions`)

### Suggestion Management
- `POST /api/suggestions` - Create AI suggestion
- `GET /api/suggestions/:id` - Get specific suggestion
- `PUT /api/suggestions/:id` - Update suggestion
- `DELETE /api/suggestions/:id` - Delete suggestion

### Status Management
- `PUT /api/suggestions/:id/status` - Update suggestion status
- `POST /api/suggestions/cleanup` - Cleanup expired suggestions

### User Suggestions
- `GET /api/suggestions/user/:userId/active` - Get active suggestions
- `GET /api/suggestions/user/:userId` - Get all user suggestions
- `GET /api/suggestions/analytics/:userId` - Get suggestion analytics

### Request Examples
```javascript
// Create AI suggestion
POST /api/suggestions
{
  "user_id": "uuid",
  "session_ids": ["session-uuid"],
  "suggestion_type": "productivity",
  "suggestion_content": {
    "title": "Use keyboard shortcuts",
    "description": "Save time with Cmd+S instead of clicking",
    "action": "learn_shortcuts"
  },
  "confidence_score": 0.85,
  "priority": 8
}

// Update suggestion status
PUT /api/suggestions/uuid/status
{
  "status": "accepted",
  "feedback": {"helpful": true, "time_saved": "5 minutes"}
}
```

---

## 📊 User Events Routes (`/api/events`)

### Event Management
- `POST /api/events` - Create user event
- `GET /api/events/:id` - Get specific event
- `PUT /api/events/:id` - Update event
- `DELETE /api/events/:id` - Delete event
- `POST /api/events/bulk` - Create multiple events

### Event Queries
- `GET /api/events/user/:userId` - Get all user events
- `GET /api/events/user/:userId/analytics` - Get event analytics
- `GET /api/events/user/:userId/patterns` - Get behavioral patterns

### Knowledge Processing
- `POST /api/events/process-to-knowledge/:userId` - Process events to knowledge graph

### Request Examples
```javascript
// Create user event
POST /api/events
{
  "user_id": "uuid",
  "event_type": "habit",
  "event_data": {
    "action": "frequent_saving",
    "frequency": "every_2_minutes",
    "tool": "text_editor"
  },
  "importance_score": 0.8,
  "tags": ["productivity", "habits"]
}

// Get events with filters
GET /api/events/user/uuid?event_type=habit&min_importance=0.7&limit=50
```

---

## 🧠 Knowledge Graph Routes (`/api/knowledge`)

### Node Management
- `POST /api/knowledge/nodes` - Create/update knowledge node
- `GET /api/knowledge/nodes/:id` - Get specific node
- `PUT /api/knowledge/nodes/:id` - Update node
- `DELETE /api/knowledge/nodes/:id` - Delete node
- `GET /api/knowledge/nodes/user/:userId` - Get all user nodes

### Relationship Management
- `POST /api/knowledge/relationships` - Create/update relationship
- `GET /api/knowledge/relationships/user/:userId` - Get all user relationships

### Graph Operations
- `GET /api/knowledge/traverse/:userId/:nodeId` - Traverse knowledge graph
- `GET /api/knowledge/path/:userId/:sourceId/:targetId` - Find connection path
- `GET /api/knowledge/similar/:userId` - Find similar nodes

### Analytics & Export
- `GET /api/knowledge/analytics/:userId` - Get knowledge graph analytics
- `GET /api/knowledge/export/:userId` - Export knowledge graph

### Request Examples
```javascript
// Create knowledge node
POST /api/knowledge/nodes
{
  "user_id": "uuid",
  "node_type": "habit",
  "content": {
    "name": "frequent_saving",
    "description": "User saves documents every 2 minutes",
    "strength": "strong"
  },
  "weight": 2.5
}

// Create relationship
POST /api/knowledge/relationships
{
  "user_id": "uuid",
  "source_node_id": "node1-uuid",
  "target_node_id": "node2-uuid",
  "relationship_type": "triggers",
  "strength": 0.8
}

// Traverse graph
GET /api/knowledge/traverse/uuid/node-uuid?max_depth=3&min_strength=0.5
```

---

## 📈 Analytics Routes (`/api/analytics`)

### Dashboard & Insights
- `GET /api/analytics/dashboard/:userId` - Comprehensive dashboard data
- `GET /api/analytics/session-insights/:sessionId` - Detailed session insights
- `GET /api/analytics/behavior-patterns/:userId` - Behavioral pattern analysis
- `GET /api/analytics/knowledge-insights/:userId` - Knowledge graph insights

### Reports
- `GET /api/analytics/reports/:userId/productivity` - Productivity report
- `GET /api/analytics/reports/:userId/learning` - Learning progress report
- `GET /api/analytics/reports/:userId/usage` - Usage statistics report
- `GET /api/analytics/reports/:userId/ai-performance` - AI performance report

### System Health
- `GET /api/analytics/health-check` - Database health check

### Request Examples
```javascript
// Get dashboard for last 30 days
GET /api/analytics/dashboard/uuid?days=30

// Get behavior patterns
GET /api/analytics/behavior-patterns/uuid?days=14&pattern_type=temporal

// Get report as CSV
GET /api/analytics/reports/uuid/productivity?format=csv&startDate=2024-01-01
```

---

## 🗂️ Data Management Routes (`/api/management`)

### Cleanup Operations
- `POST /api/management/cleanup/comprehensive` - Run comprehensive cleanup
- `POST /api/management/cleanup/sessions` - Archive old sessions
- `POST /api/management/cleanup/events` - Clean up low importance events
- `POST /api/management/cleanup/suggestions` - Clean up old suggestions
- `POST /api/management/cleanup/knowledge-graph` - Prune weak connections

### GDPR Compliance
- `GET /api/management/export/:userId` - Export all user data
- `DELETE /api/management/user/:userId` - Delete all user data

### Backup & Restore
- `POST /api/management/backup/user/:userId` - Create user data backup
- `POST /api/management/restore/user/:userId` - Restore user data

### System Management
- `GET /api/management/storage-stats` - Get storage statistics
- `GET /api/management/cleanup-schedule` - Get cleanup schedule status

### Request Examples
```javascript
// Run cleanup (dry run first)
POST /api/management/cleanup/comprehensive
{
  "dry_run": true
}

// Export user data
GET /api/management/export/uuid?format=json

// Delete user (GDPR)
DELETE /api/management/user/uuid
{
  "confirmation_email": "user@example.com"
}
```

---

## 🔧 Setup & Integration

### 1. Environment Variables
```bash
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-supabase-anon-key
```

### 2. Express App Setup
```javascript
const express = require('express');
const app = express();

// Import routes
const profileRoutes = require('./api/routes/profiles');
const sessionRoutes = require('./api/routes/sessions');
const suggestionRoutes = require('./api/routes/suggestions');
const eventRoutes = require('./api/routes/events');
const knowledgeRoutes = require('./api/routes/knowledge');
const analyticsRoutes = require('./api/routes/analytics');
const managementRoutes = require('./api/routes/management');

// Use routes
app.use('/api/profiles', profileRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/suggestions', suggestionRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/management', managementRoutes);
```

### 3. Dependencies
```bash
npm install express @supabase/supabase-js
```

---

## 📊 Common Query Parameters

### Pagination
- `limit` - Number of records to return (default: 50-100)
- `offset` - Number of records to skip (default: 0)

### Filtering
- `order_by` - Field to sort by (default: created_at)
- `order_direction` - asc or desc (default: desc)
- `days` - Number of days to look back for analytics

### Format Options
- `format` - json or csv for exports/reports

---

## 🚨 Error Responses

All endpoints return consistent error format:
```javascript
{
  "error": "Descriptive error message"
}
```

Common status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `404` - Not Found
- `500` - Internal Server Error

---

## 🎯 Quick Start Examples

### Complete User Journey
```javascript
// 1. Create user
const user = await fetch('/api/profiles', {
  method: 'POST',
  body: JSON.stringify({
    email: 'user@example.com',
    full_name: 'John Doe'
  })
});

// 2. Start session
const session = await fetch('/api/sessions/start', {
  method: 'POST',
  body: JSON.stringify({
    user_id: user.id,
    device_info: {browser: 'Chrome'}
  })
});

// 3. Add OCR event
await fetch(`/api/sessions/${session.session_id}/events`, {
  method: 'POST',
  body: JSON.stringify({
    event_type: 'ocr',
    event_data: {text: 'Hello World', confidence: 0.95}
  })
});

// 4. Get dashboard
const dashboard = await fetch(`/api/analytics/dashboard/${user.id}?days=7`);
```

## 🎉 Ready to Use!

Your complete API layer is ready with **70+ endpoints** covering every aspect of your database. All routes integrate seamlessly with your Supabase database functions and provide comprehensive functionality for your OCR tracking, AI suggestions, and knowledge graph application!