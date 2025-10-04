# Vision Storage Architecture - Complete Explanation

## Overview

The Vision feature captures screenshots, processes them with AI, and stores the data in **two separate locations**:

1. **Database (Supabase)**: Stores metadata and AI analysis results
2. **S3 (AWS)**: Optionally stores the actual screenshot images

---

## Data Flow - Step by Step

### 1. Screenshot Capture (Electron)

**File**: `electron-app/vision-scheduler.js`

```
User switches to app with vision enabled
  ↓
Every 10 seconds (configurable)
  ↓
VisionScheduler.performCapture()
  ↓
Uses Electron's desktopCapturer API
  ↓
Captures full screen as PNG buffer
  ↓
Screenshot size: ~500KB - 2MB (depends on screen resolution)
```

**Logs to watch**:
```
📸 [VisionScheduler] STARTING CAPTURE
   App: Google Chrome
   Time: 2025-10-03T12:34:56.789Z
📸 [VisionScheduler] ✅ Screenshot captured: 1024.50 KB
```

---

### 2. Upload to Backend (Electron → FastAPI)

**Endpoint**: `POST /api/vision/jobs/{user_id}`

**Data sent**:
- `file`: PNG screenshot (multipart form)
- `app_name`: "Google Chrome"
- `allow_screenshots`: true/false (from user preferences)

**Logs to watch**:
```
📸 [VisionScheduler] Uploading to: http://127.0.0.1:8000/api/vision/jobs/550e8400...
📸 [VisionScheduler] ✅ Vision job created successfully!
   - Job ID: abc-123-def
   - Status: processing
   - S3 stored: true
   - Upload time: 245ms
```

---

### 3. Backend Processing (FastAPI)

#### A. Job Creation

**File**: `squire-backend/app/services/vision_job_manager.py`

**Function**: `create_vision_job()`

**Process**:
1. Generate unique job_id (UUID)
2. Check `allow_screenshots` preference
3. **IF allow_screenshots = true**: Upload to S3
4. **ALWAYS**: Create database record
5. **ALWAYS**: Analyze with Vision API

**Logs to watch**:
```
============================================================
📸 [VisionJobManager] CREATE VISION JOB
   Job ID: 3f8d9e2a-1234-5678-abcd-ef1234567890
   User ID: 550e8400-e29b-41d4-a716-446655440000
   App: Google Chrome
   Screenshot size: 1024.50 KB
   Store in S3: true
============================================================
```

---

#### B. S3 Upload (Optional)

**File**: `squire-backend/app/services/s3_service.py`

**Function**: `upload_screenshot()`

**Condition**: Only runs if `allow_screenshots = true`

**S3 Path Structure**:
```
{bucket}/
  {user_id}/
    {year}/
      {month}/
        {job_id}.png
```

**Example**:
```
xecond/
  550e8400-e29b-41d4-a716-446655440000/
    2025/
      10/
        3f8d9e2a-1234-5678-abcd-ef1234567890.png
```

**Logs to watch**:
```
📸 [VisionJobManager] Uploading screenshot to S3...
✅ [VisionJobManager] Screenshot uploaded to S3:
   - Path: 550e8400.../2025/10/3f8d9e2a...png
   - URL: https://xecond.s3.us-east-1.amazonaws.com/550e8400.../2025/10/3f8d9e2a...
```

**If NOT storing in S3**:
```
⚠️ [VisionJobManager] Screenshot storage disabled (not saving to S3)
```

---

#### C. Database Record Creation

**Table**: `vision_events`

**Always created** (regardless of S3 setting)

**Schema**:
```sql
CREATE TABLE vision_events (
    id UUID PRIMARY KEY,                      -- Job ID
    user_id UUID NOT NULL,                    -- User UUID
    app_name TEXT,                            -- "Google Chrome"
    ocr_event_id UUID,                        -- Optional link to OCR
    screenshot_url TEXT,                      -- S3 URL (if stored)
    screenshot_storage_path TEXT,             -- S3 path (if stored)
    status TEXT DEFAULT 'pending',            -- pending → processing → completed/failed
    vision_analysis JSONB,                    -- AI analysis results
    vision_model TEXT,                        -- "claude-3-5-sonnet-20241022"
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    deleted_at TIMESTAMP
);
```

**Initial record**:
```json
{
  "id": "3f8d9e2a-1234-5678-abcd-ef1234567890",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "app_name": "Google Chrome",
  "screenshot_url": "https://xecond.s3.../screenshot.png", // null if not stored
  "screenshot_storage_path": "550e8400.../2025/10/3f8d9e2a...png", // null if not stored
  "status": "pending",
  "vision_analysis": null,
  "vision_model": null,
  "created_at": "2025-10-03T12:34:56.789Z"
}
```

**Logs to watch**:
```
✅ [VisionJobManager] Database record created
   - Table: vision_events
   - Status: pending
```

---

#### D. Vision AI Analysis

**File**: `squire-backend/app/services/vision_service.py`

**Function**: `analyze_screenshot()`

**Provider**: Claude 3.5 Sonnet (or GPT-4 Vision)

**Process**:
1. Encode screenshot as base64
2. Send to Anthropic/OpenAI API
3. Receive AI analysis
4. Parse response into structured format

**API Call**:
```python
message = anthropic.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "data": base64_image}},
                {"type": "text", "text": "Analyze this screenshot..."}
            ]
        }
    ]
)
```

**Logs to watch**:
```
🤖 [VisionJobManager] Calling Vision API (this may take 5-10 seconds)...
✅ [VisionJobManager] Vision analysis complete!
   - Processing time: 6.34s
   - Model: claude-3-5-sonnet-20241022
   - Provider: anthropic

📊 [VisionJobManager] ANALYSIS RESULTS:
   - Task: User is browsing documentation for FastAPI endpoints
   - UI Elements: 4 found
   - Context: Reading API documentation for vision endpoint implementation
```

---

#### E. Update Database with Results

**Updates the same record** in `vision_events`

**Updated fields**:
```json
{
  "status": "completed",
  "vision_model": "claude-3-5-sonnet-20241022",
  "vision_analysis": {
    "task": "User is browsing documentation for FastAPI endpoints",
    "ui_elements": ["Browser window", "Documentation page", "Code snippets", "Navigation sidebar"],
    "context": "Reading API documentation for vision endpoint implementation, multiple tabs open",
    "patterns": "Switching between documentation and code editor, comparing examples",
    "insights": "User is in learning/research mode, may benefit from code snippet suggestions",
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022",
    "app_name": "Google Chrome"
  },
  "updated_at": "2025-10-03T12:35:03.456Z"
}
```

**Logs to watch**:
```
✅ [VisionJobManager] Job 3f8d9e2a... completed successfully
   - Status: completed
   - Stored in: vision_events table
============================================================
```

---

## Storage Summary

### What Gets Stored Where

| Data | Database (Supabase) | S3 (AWS) |
|------|---------------------|----------|
| **Screenshot image** | ❌ Never | ✅ Only if `allow_screenshots = true` |
| **Job metadata** | ✅ Always | ❌ Never |
| **AI analysis** | ✅ Always | ❌ Never |
| **App name** | ✅ Always | ❌ Never |
| **Timestamp** | ✅ Always | ❌ Never |
| **S3 URL** | ✅ If stored in S3 | N/A |

### Database Only vs Database + S3

#### Scenario 1: `allow_screenshots = false` (Default)

```
Screenshot captured
  ↓
Sent to backend (temporary, in memory)
  ↓
Vision API analyzes it
  ↓
AI results stored in database
  ✓
Screenshot discarded (NOT saved anywhere)
```

**Database record**:
```json
{
  "id": "abc-123",
  "screenshot_url": null,           // ← No S3 URL
  "screenshot_storage_path": null,  // ← No S3 path
  "vision_analysis": { ... },       // ← AI results SAVED
  "status": "completed"
}
```

**Result**: You have the AI insights, but can't view the original screenshot

---

#### Scenario 2: `allow_screenshots = true`

```
Screenshot captured
  ↓
Sent to backend
  ↓
Uploaded to S3 ✓
  ↓
Vision API analyzes it
  ↓
AI results + S3 URL stored in database
  ✓
Screenshot saved in S3 bucket
```

**Database record**:
```json
{
  "id": "abc-123",
  "screenshot_url": "https://xecond.s3.../screenshot.png",    // ← S3 URL
  "screenshot_storage_path": "user/2025/10/abc-123.png",      // ← S3 path
  "vision_analysis": { ... },                                  // ← AI results
  "status": "completed"
}
```

**Result**: You have both AI insights AND can retrieve the original screenshot

---

## Retrieving Vision Data

### 1. Get Recent Vision Events (for LLM context)

**Endpoint**: `GET /api/vision/events/{user_id}/recent?limit=3&app_name=Chrome`

**Returns**:
```json
{
  "success": true,
  "data": [
    {
      "id": "abc-123",
      "app_name": "Google Chrome",
      "vision_analysis": {
        "task": "...",
        "ui_elements": [...],
        "context": "...",
        "patterns": "...",
        "insights": "..."
      },
      "screenshot_url": "https://...",  // null if not stored
      "created_at": "2025-10-03T12:34:56.789Z"
    }
  ],
  "count": 3
}
```

**Used by**: `build_batch_openai_prompt()` in `ai.py` to merge vision context with OCR

---

### 2. Get Specific Job Status

**Endpoint**: `GET /api/vision/jobs/{job_id}`

**Returns**:
```json
{
  "success": true,
  "data": {
    "id": "abc-123",
    "status": "completed",
    "vision_analysis": { ... },
    "screenshot_url": "https://..."
  }
}
```

---

### 3. Get Screenshot from S3

**IF** screenshot was stored:

**Endpoint**: `GET /api/vision/screenshots/{storage_path}/presigned`

**Returns**:
```json
{
  "success": true,
  "presigned_url": "https://xecond.s3...?X-Amz-Expires=3600",
  "expires_in": 3600
}
```

**Use**: Temporary URL valid for 1 hour to view/download screenshot

---

## Storage Costs

### S3 Storage (if enabled)

**Screenshot size**: ~1MB per screenshot

**Daily usage** (1 app, 10s interval, 8 hours):
- Captures per day: ~2,880 screenshots
- Storage per day: ~2.88 GB
- Monthly storage: ~86 GB

**AWS S3 Pricing** (us-east-1):
- Storage: $0.023 per GB/month
- Monthly cost: 86 GB × $0.023 = **$1.98/month**

**Recommendation**: Only enable `allow_screenshots` for debugging or when you need to review screenshots later

---

### Database Storage (always used)

**Vision analysis size**: ~2-5 KB per record (JSON)

**Daily usage**:
- Records per day: ~2,880
- Storage per day: ~10 MB
- Monthly storage: ~300 MB

**Supabase Free Tier**: 500 MB database
**Monthly cost**: **FREE** (under free tier limit)

---

### Vision API Costs (always incurred)

**Claude 3.5 Sonnet**: ~$0.015 per image

**Daily usage**:
- API calls per day: ~2,880
- Daily cost: 2,880 × $0.015 = **$43.20/day**
- Monthly cost: **~$864/month**

**Note**: This is why the default interval is NOT 10 seconds! For production, use 45-60 seconds.

---

## Checking Your Data

### 1. Database (Supabase)

```sql
-- Check recent vision events
SELECT
  id,
  app_name,
  status,
  vision_model,
  vision_analysis->>'task' as task,
  screenshot_url IS NOT NULL as has_screenshot,
  created_at
FROM vision_events
WHERE user_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY created_at DESC
LIMIT 10;
```

### 2. S3 Bucket (AWS Console)

1. Go to: https://s3.console.aws.amazon.com/
2. Open bucket: `xecond`
3. Navigate to: `550e8400-e29b-41d4-a716-446655440000/2025/10/`
4. See all screenshots as PNG files

### 3. Via API

```bash
# Get recent vision events
curl http://127.0.0.1:8000/api/vision/events/550e8400-e29b-41d4-a716-446655440000/recent?limit=5 | jq

# Get specific job
curl http://127.0.0.1:8000/api/vision/jobs/{job_id} | jq
```

---

## Log Examples

### Full Capture Cycle

**Electron logs**:
```
📸 [VisionScheduler] Next capture for "Google Chrome" in 10s (enabled: true)

========================================
📸 [VisionScheduler] STARTING CAPTURE
   App: Google Chrome
   Time: 2025-10-03T12:34:56.789Z
========================================
📸 [VisionScheduler] Display size: 2560x1440
📸 [VisionScheduler] Found 1 screen source(s)
📸 [VisionScheduler] ✅ Screenshot captured: 1024.50 KB
📸 [VisionScheduler] Sending to backend...
📸 [VisionScheduler] Preferences for Google Chrome:
   - allow_screenshots: true
   - vision_frequency: normal
📸 [VisionScheduler] Uploading to: http://127.0.0.1:8000/api/vision/jobs/550e8400...
📸 [VisionScheduler] ✅ Vision job created successfully!
   - Job ID: 3f8d9e2a-1234-5678-abcd-ef1234567890
   - Status: processing
   - S3 stored: true
   - Upload time: 245ms
========================================
```

**Backend logs**:
```
============================================================
📸 [VisionJobManager] CREATE VISION JOB
   Job ID: 3f8d9e2a-1234-5678-abcd-ef1234567890
   User ID: 550e8400-e29b-41d4-a716-446655440000
   App: Google Chrome
   Screenshot size: 1024.50 KB
   Store in S3: true
============================================================
📸 [VisionJobManager] Uploading screenshot to S3...
✅ [VisionJobManager] Screenshot uploaded to S3:
   - Path: 550e8400.../2025/10/3f8d9e2a...png
   - URL: https://xecond.s3.us-east-1.amazonaws.com/550e8400.../2025/10/3f8d9e2a...
✅ [VisionJobManager] Database record created
   - Table: vision_events
   - Status: pending
🔮 [VisionJobManager] Starting vision analysis...
🔮 [VisionJobManager] PROCESSING VISION JOB
   Job ID: 3f8d9e2a-1234-5678-abcd-ef1234567890
   App: Google Chrome
🤖 [VisionJobManager] Calling Vision API (this may take 5-10 seconds)...
✅ [VisionJobManager] Vision analysis complete!
   - Processing time: 6.34s
   - Model: claude-3-5-sonnet-20241022
   - Provider: anthropic

📊 [VisionJobManager] ANALYSIS RESULTS:
   - Task: User is browsing documentation for FastAPI endpoints
   - UI Elements: 4 found
   - Context: Reading API documentation for vision endpoint implementation
✅ [VisionJobManager] Job 3f8d9e2a... completed successfully
   - Status: completed
   - Stored in: vision_events table
============================================================
```

---

## Summary

✅ **Screenshots**: Captured in memory, sent to backend

✅ **S3 Storage**: Optional (only if `allow_screenshots = true`)

✅ **Database**: Always stores job metadata and AI analysis

✅ **Vision API**: Always analyzes screenshot (costs money)

✅ **Logs**: Comprehensive logging at every step for debugging
