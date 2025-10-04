# Vision Feature Setup Guide

## Overview

The Vision feature has been fully implemented! It captures screenshots, analyzes them using AI vision models (Claude or GPT-4), and provides contextual insights for productivity assistance.

---

## Architecture

### Frontend (Electron)
- **VisionScheduler**: Captures screenshots at configurable intervals (30-60s)
- Respects per-app preferences (enable/disable vision)
- Uploads screenshots to backend via multipart form

### Backend (FastAPI)
- **VisionJobManager**: Manages vision job queue and processing
- **VisionService**: Integrates with Claude Vision and GPT-4 Vision APIs
- **S3Service**: Optionally stores screenshots in AWS S3
- **Vision API Endpoints**: Create jobs, check status, fetch results

---

## Setup Steps

### 1. Install Python Dependencies

```bash
cd squire-backend
pip install anthropic>=0.18.0
# Or install all requirements:
pip install -r requirements.txt
```

### 2. Run Database Migration

```bash
# In Supabase SQL Editor, run:
```

```sql
-- Migration 017: Add app_name column to vision_events table
ALTER TABLE vision_events
ADD COLUMN IF NOT EXISTS app_name TEXT;

CREATE INDEX IF NOT EXISTS idx_vision_events_app_name
ON vision_events(app_name);

CREATE INDEX IF NOT EXISTS idx_vision_events_user_app
ON vision_events(user_id, app_name, created_at DESC);
```

### 3. Configure API Keys

Add to your `.env` file:

```bash
# Choose ONE of these (or both):

# Option 1: Anthropic Claude (recommended - more cost effective)
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Option 2: OpenAI GPT-4 Vision
OPENAI_API_KEY=sk-xxxxx
```

**Cost Comparison**:
- **Claude 3.5 Sonnet**: ~$0.008-0.024/image (cheaper, better quality)
- **GPT-4 Vision**: ~$0.01-0.03/image

### 4. Rebuild Electron App

```bash
cd electron-app
npm run build -- --mac --arm64 --config.mac.identity=null
open dist/mac-arm64/Squire.app
```

---

## How It Works

### User Flow

1. **Open Settings** (Cmd+,)
2. **Enable Vision** for specific apps (toggle "Vision" switch)
3. **Switch to that app** - Vision capture starts automatically
4. **Screenshots captured** every 30-60 seconds (based on frequency setting)
5. **AI analyzes** screenshot and extracts:
   - Current task
   - UI elements visible
   - Context and patterns
   - Productivity insights
6. **Results stored** in `vision_events` table

### Data Flow

```
User switches app
  ↓
VisionScheduler checks preferences
  ↓
Should capture? (vision enabled for this app)
  ↓
Capture screenshot via desktopCapturer
  ↓
Upload to backend (multipart form)
  ↓
VisionJobManager creates vision_events record
  ↓
Optionally upload to S3 (if allow_screenshots=true)
  ↓
VisionService calls Claude/GPT-4 Vision API
  ↓
Parse and store analysis results
  ↓
Status: completed
```

---

## API Endpoints

### Create Vision Job
```bash
POST /api/vision/jobs/{user_id}
Content-Type: multipart/form-data

Fields:
- file: screenshot file (PNG/JPEG)
- app_name: application name
- allow_screenshots: boolean (store in S3?)
- ocr_event_id: optional OCR event link
```

### Get Job Status
```bash
GET /api/vision/jobs/{job_id}
```

### Get Recent Vision Events
```bash
GET /api/vision/events/{user_id}/recent?limit=5&app_name=Chrome
```

---

## Testing

### 1. Backend Health Check

```bash
curl http://127.0.0.1:8000/api/vision/health | python3 -m json.tool
```

Expected:
```json
{
  "status": "ok",
  "service": "vision",
  "s3_status": "connected",
  "bucket": "xecond"
}
```

### 2. Enable Vision for an App

1. Open Settings (Cmd+,)
2. Switch to Chrome/VSCode/any app
3. App appears in Settings list
4. Toggle "Vision" switch ON
5. Optionally toggle "Screenshots" ON (to save to S3)

### 3. Watch Backend Logs

```bash
cd squire-backend
python main.py
```

Look for:
```
📸 Capturing screenshot for Chrome...
✅ Screenshot captured: 524288 bytes
📸 Vision job queued: abc-123-def
🔮 Processing vision job abc-123-def for app 'Chrome'
✅ Claude Vision analysis complete for Chrome
✅ Job abc-123-def completed successfully
```

### 4. Check Database

```sql
SELECT
  id,
  app_name,
  status,
  vision_model,
  vision_analysis->>'task' as task,
  created_at
FROM vision_events
WHERE user_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY created_at DESC
LIMIT 5;
```

---

## Vision Analysis Output

The Vision API returns structured data:

```json
{
  "task": "Browsing documentation for FastAPI endpoints",
  "ui_elements": [
    "Browser window",
    "Documentation page",
    "Code snippets",
    "Navigation sidebar"
  ],
  "context": "User is reading API documentation for vision endpoint implementation",
  "patterns": "Reviewing code examples and comparing with existing implementation",
  "insights": "User appears to be in learning/research mode, may benefit from code snippet suggestions",
  "provider": "anthropic",
  "model": "claude-3-5-sonnet-20241022",
  "app_name": "Google Chrome"
}
```

---

## Configuration Options

### Per-App Settings (in Settings UI)

- **OCR Toggle**: Enable/disable text extraction
- **Vision Toggle**: Enable/disable screenshot analysis
- **Screenshots Toggle**: Enable/disable S3 storage

### Vision Frequency (per app)

In database (`user_app_preferences.vision_frequency`):
- `low`: 60 seconds (1 minute)
- `normal`: 45 seconds
- `high`: 30 seconds

### Global Vision Toggle

In Settings UI header - enables/disables vision globally across all apps.

---

## Cost Monitoring

### Estimated Costs (Claude 3.5 Sonnet)

- **1 capture/minute**: ~$0.60-1.80/hour
- **Daily usage (8 hours)**: ~$4.80-14.40/day
- **Monthly (20 working days)**: ~$96-288/month

**Cost Reduction Strategies**:
1. Only enable vision for critical apps (IDE, Browser)
2. Use "low" frequency (60s) instead of "high" (30s)
3. Disable vision when not actively working
4. Use global vision toggle to pause all captures

---

## Troubleshooting

### Screenshots Not Capturing

1. Check console logs: `📸 Skipping capture (vision disabled for ...)`
2. Verify vision is enabled in Settings for that app
3. Check global vision toggle is ON
4. Verify app name matches (case-sensitive)

### Vision API Errors

1. Check API key is set: `echo $ANTHROPIC_API_KEY`
2. Check backend logs for error messages
3. Verify API key has sufficient credits
4. Check network connectivity

### Screenshots Not Saving to S3

1. Verify "Screenshots" toggle is ON for the app
2. Check S3 credentials in `.env`
3. Check backend logs for S3 upload errors
4. Verify bucket permissions

### High Costs

1. Check how many apps have vision enabled
2. Review capture frequency settings
3. Consider disabling screenshots (S3 storage costs)
4. Use global vision toggle when not needed

---

## Next Steps

After testing vision capture:

1. **Merge Vision + OCR Context**: Enhance LLM suggestions with vision insights
2. **Add Vision to Suggestions**: Display vision-based recommendations in suggestions box
3. **Implement Vision Caching**: Reduce duplicate analysis of similar screens
4. **Add Vision History**: UI to view past vision events and insights

---

## Files Modified/Created

### Electron
- `electron-app/vision-scheduler.js` (NEW)
- `electron-app/main.js` (modified)
- `electron-app/package.json` (modified)

### Backend
- `squire-backend/app/services/vision_service.py` (NEW)
- `squire-backend/app/services/vision_job_manager.py` (NEW)
- `squire-backend/app/routers/vision.py` (modified)
- `squire-backend/requirements.txt` (modified)
- `squire-backend/migrations/017_add_app_name_to_vision_events.sql` (NEW)

---

## Support

For issues or questions:
1. Check backend logs: `tail -f squire-backend/logs/app.log`
2. Check Electron console: Open DevTools in main window
3. Verify database state: Query `vision_events` table
4. Check API health: `GET /api/vision/health`
