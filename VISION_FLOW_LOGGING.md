# Vision Flow - Complete Logging Guide

## Overview

This document shows all logging points in the vision pipeline from screenshot capture to LLM context injection.

---

## Complete Vision Flow

### 1. **Screenshot Capture** (Frontend - `vision-scheduler.js`)

**Location**: `electron-app/vision-scheduler.js`

**Logs**:
```
========================================
📸 [VisionScheduler] STARTING CAPTURE
   App: <app_name>
   Time: <ISO timestamp>
========================================
📸 [VisionScheduler] Display size: <width>x<height>
📸 [VisionScheduler] Found X screen source(s)
📸 [VisionScheduler] ✅ Screenshot captured: XX.XX KB
📸 [VisionScheduler] Sending to backend...
```

---

### 2. **Backend Receives Screenshot** (Backend - `vision.py`)

**Location**: `squire-backend/app/routers/vision.py:312`
**Endpoint**: `POST /api/vision/jobs/{user_id}`

**Logs**: (Preference checks - optional)
```
📋 [VisionRouter] GET USER PREFERENCES for user: <user_id>
   Found X preferences
   - <app>: vision=True, screenshots=True
```

---

### 3. **Vision Job Creation** (Backend - `vision_job_manager.py`)

**Location**: `squire-backend/app/services/vision_job_manager.py:30`

**Logs**:
```
============================================================
📸 [VisionJobManager] CREATE VISION JOB
   Job ID: <uuid>
   User ID: <user_id>
   App: <app_name>
   Screenshot size: XX.XX KB
   Store in S3: True/False
============================================================
```

**If S3 Upload**:
```
📸 [VisionJobManager] Uploading screenshot to S3...
✅ [VisionJobManager] Screenshot uploaded to S3:
   - Path: <s3_path>
   - URL: <url>...
```

**Database Record**:
```
✅ [VisionJobManager] Database record created
   - Table: vision_events
   - Status: pending
```

---

### 4. **Vision Analysis** (Backend - `vision_job_manager.py`)

**Location**: `squire-backend/app/services/vision_job_manager.py:152`

**Logs**:
```
🔮 [VisionJobManager] PROCESSING VISION JOB
   Job ID: <job_id>
   App: <app_name>
📊 Job <job_id> status: processing
```

**Vision API Check**:
```
🤖 [VisionJobManager] Calling Vision API (this may take 5-10 seconds)...
```

---

### 5. **Vision Service Analysis** (Backend - `vision_service.py`)

**Location**: `squire-backend/app/services/vision_service.py:85`

**Anthropic Claude Vision**:
```
✅ Claude Vision analysis complete for <app_name>
```

**OR GPT-4 Vision**:
```
✅ GPT-4 Vision analysis complete for <app_name>
```

**On Error**:
```
❌ Claude Vision error: <error>
❌ GPT-4 Vision error: <error>
```

---

### 6. **Analysis Complete** (Backend - `vision_job_manager.py`)

**Logs**:
```
✅ [VisionJobManager] Vision analysis complete!
   - Processing time: X.XX s
   - Model: claude-3-5-sonnet-20241022
   - Provider: anthropic

📊 [VisionJobManager] ANALYSIS RESULTS:
   - Task: <task_description>
   - UI Elements: X found
   - Context: <context>

✅ [VisionJobManager] Job <job_id> completed successfully
   - Status: completed
   - Stored in: vision_events table
============================================================
```

---

### 7. **LLM Context Retrieval** (Backend - `ai.py`)

**Location**: `squire-backend/app/routers/ai.py:754`

**Logs**:
```
============================================================
🔮 [AI] GET VISION CONTEXT
   User ID: <user_id>
   App filter: <app_name>
   Limit: 3
```

---

### 8. **Fetch Unused Events** (Backend - `vision_job_manager.py`)

**Location**: `squire-backend/app/services/vision_job_manager.py:239`

**Logs**:
```
============================================================
🔍 [VisionJobManager] GET RECENT VISION EVENTS
   User ID: <user_id>
   App filter: <app_name>
   Limit: 3
   Max age: 60 minutes (after 2025-10-03T10:30:00Z)
   Only unused: True
   Found X unused events
   1. [2025-10-03T10:35:00Z] VS Code [used=False]: Writing Python code
   2. [2025-10-03T10:34:50Z] Chrome [used=False]: Reading docs
============================================================
```

---

### 9. **Build Vision Context** (Backend - `ai.py`)

**Logs**:
```
   Retrieved X UNUSED vision events
   ✅ Event 1: VS Code at 2025-10-03T10:35:00Z [id=abc-123]
   ✅ Event 2: Chrome at 2025-10-03T10:34:50Z [id=def-456]
```

---

### 10. **Mark Events as Used** (Backend - `vision_job_manager.py`)

**Location**: `squire-backend/app/services/vision_job_manager.py:314`

**Logs**:
```
📌 [VisionJobManager] MARKING EVENTS AS USED
   Event count: 2
   Event IDs: abc-123, def-456
✅ Marked 2 events as used in LLM
```

---

### 11. **Vision Context Summary** (Backend - `ai.py`)

**Logs**:
```
   📊 Vision context summary:
      - Total events retrieved: 2
      - Events added to context: 2
      - Events marked as used: 2
      - Context length: 450 chars
============================================================
```

---

### 12. **Final LLM Prompt** (Backend - `ai.py`)

**Location**: `squire-backend/app/routers/ai.py:1075`

**Logs**:
```
📝 BATCH PROMPT SENT TO LLM:
--------------------------------------------------------------------------------
[Full prompt with vision context included]
--------------------------------------------------------------------------------
🔚 END BATCH PROMPT
================================================================================
```

---

## Troubleshooting with Logs

### Issue: No vision events in LLM context

**Check logs in order**:
1. `📸 [VisionScheduler] STARTING CAPTURE` - Is capture happening?
2. `📸 [VisionJobManager] CREATE VISION JOB` - Is job created?
3. `🔮 [VisionJobManager] PROCESSING VISION JOB` - Is analysis starting?
4. `✅ [VisionJobManager] Vision analysis complete!` - Is analysis succeeding?
5. `🔍 [VisionJobManager] GET RECENT VISION EVENTS` - Are events being queried?
6. `Found X unused events` - How many unused events exist?
7. `📌 [VisionJobManager] MARKING EVENTS AS USED` - Are they being marked?

### Issue: Vision analysis failing

**Look for**:
```
❌ [VisionJobManager] Vision service not available (no API keys configured)
❌ Claude Vision error: <error>
❌ GPT-4 Vision error: <error>
```

### Issue: Same vision context repeated

**Check**:
```
   Only unused: True  <- Should be True
   Found 0 unused events  <- Old events were marked as used
```

### Issue: Upload to S3 failing

**Look for**:
```
📸 [VisionJobManager] Uploading screenshot to S3...
❌ (any S3 errors)
```

---

## Expected Healthy Flow

```
1. 📸 Screenshot captured (10s intervals)
2. 📸 CREATE VISION JOB
3. 📸 Upload to S3 (if allowed)
4. 🔮 PROCESSING VISION JOB
5. 🤖 Calling Vision API...
6. ✅ Vision analysis complete! (5-10s)
7. 📊 Job completed successfully

[User types, triggers LLM]

8. 🔮 GET VISION CONTEXT
9. 🔍 GET RECENT VISION EVENTS (only unused)
10. Found 1 unused events
11. 📌 MARKING EVENTS AS USED
12. 📝 BATCH PROMPT SENT TO LLM (with vision)
```

---

## Log Levels

- `📸` = Screenshot/Capture operations
- `🔮` = Vision analysis
- `📋` = Preferences/Settings
- `🔍` = Database queries
- `📌` = Event marking
- `📝` = LLM prompts
- `✅` = Success
- `❌` = Error
- `⚠️` = Warning
- `📊` = Status/Summary
