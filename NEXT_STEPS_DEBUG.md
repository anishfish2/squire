# Next Steps - Vision Pipeline Setup

## Issues Fixed (Code Changes)

### 1. ✅ Settings Persistence Debug Logs
Added comprehensive logging to `/squire-backend/app/routers/vision.py`:
- `update_app_preference()` - Shows exactly what's being saved/updated
- `get_user_preferences()` - Shows what's being loaded from database

### 2. ✅ Vision Events Used Once Only (No Reuse)
Modified `/squire-backend/app/services/vision_job_manager.py`:
- **Added `used_in_llm` tracking** - Each vision event only used once
- **Added 60-minute time filter** - Only retrieves vision events from last hour
- `get_recent_vision_events()` - Filters for unused events only
- `mark_events_as_used()` - Marks events after LLM uses them

Modified `/squire-backend/app/routers/ai.py`:
- `get_vision_context()` - Fetches ONLY unused events
- Automatically marks events as used after fetching
- Detailed logging shows which events are used

### 3. ✅ Stale Vision Context Fixed
- Time-based filtering (60 minutes)
- One-time use prevents reuse of old context
- Comprehensive logging with timestamps

---

## Required Actions

### 1. Run Database Migrations

Run these in Supabase SQL Editor:

```sql
-- Migration 017: Add app_name column to vision_events
ALTER TABLE vision_events
ADD COLUMN IF NOT EXISTS app_name TEXT;

CREATE INDEX IF NOT EXISTS idx_vision_events_app_name
ON vision_events(app_name);

CREATE INDEX IF NOT EXISTS idx_vision_events_user_app
ON vision_events(user_id, app_name, created_at DESC);
```

```sql
-- Migration 018: Add updated_at column to vision_events
ALTER TABLE vision_events
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_vision_events_updated_at ON vision_events(updated_at DESC);

CREATE OR REPLACE FUNCTION update_vision_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_vision_events_updated_at ON vision_events;

CREATE TRIGGER trigger_vision_events_updated_at
    BEFORE UPDATE ON vision_events
    FOR EACH ROW
    EXECUTE FUNCTION update_vision_events_updated_at();
```

```sql
-- Migration 019: Add used_in_llm tracking to vision_events
ALTER TABLE vision_events
ADD COLUMN IF NOT EXISTS used_in_llm BOOLEAN DEFAULT FALSE;

ALTER TABLE vision_events
ADD COLUMN IF NOT EXISTS used_in_llm_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_vision_events_unused
ON vision_events(user_id, used_in_llm, created_at DESC)
WHERE used_in_llm = FALSE;

CREATE INDEX IF NOT EXISTS idx_vision_events_unused_by_app
ON vision_events(user_id, app_name, used_in_llm, created_at DESC)
WHERE used_in_llm = FALSE;
```

### 2. Install Python Package

```bash
cd squire-backend
pip install anthropic>=0.18.0
```

### 3. Restart Backend

```bash
cd squire-backend
python main.py
```

### 4. Test and Monitor Logs

#### Test Settings Persistence:
1. Open Settings (Cmd+,)
2. Toggle vision ON for an app
3. Check backend logs for:
   ```
   📝 [VisionRouter] UPDATE APP PREFERENCE
      User ID: ...
      App: ...
      Updates: {'allow_vision': True}
      Existing record: YES/NO
   ✅ Created/Updated preference for <app>
   ```

4. Close and reopen Settings
5. Check backend logs for:
   ```
   📋 [VisionRouter] GET USER PREFERENCES for user: ...
      Found X preferences
      - <app>: vision=True, screenshots=...
   ```

#### Test Vision Context:
1. Make sure vision is enabled for current app
2. Wait for screenshot captures (every 10 seconds)
3. Check backend logs for:
   ```
   📸 [VisionScheduler] STARTING CAPTURE
   📸 [VisionJobManager] CREATE VISION JOB
   🔮 [VisionJobManager] PROCESSING VISION JOB
   ✅ [VisionJobManager] Job completed successfully
   ```

4. Trigger LLM suggestion (type something)
5. Check logs for:
   ```
   🔮 [AI] GET VISION CONTEXT
   🔍 [VisionJobManager] GET RECENT VISION EVENTS
      Only unused: True
      Max age: 60 minutes (after 2025-10-03T...)
      Found X unused events
      1. [2025-10-03T...] <app> [used=False]: <task>

   📌 [VisionJobManager] MARKING EVENTS AS USED
      Event count: X

   📊 Vision context summary:
      - Total events retrieved: X
      - Events added to context: X
      - Events marked as used: X
   ```

6. Trigger another LLM suggestion immediately
7. Verify logs show:
   ```
   🔍 [VisionJobManager] GET RECENT VISION EVENTS
      Only unused: True
      Found 0 unused events  <-- Should be 0 or fewer
   ```

---

## Expected Behavior

### Settings Persistence:
- ✅ Preferences saved immediately on toggle
- ✅ Preferences persist across Settings window open/close
- ✅ All detected apps saved to database

### Vision Context (NEW - One-Time Use):
- ✅ Only uses vision events from **last 60 minutes**
- ✅ **Each event used exactly ONCE** - marked as used after LLM call
- ✅ Next LLM call gets only NEW/unused vision events
- ✅ Timestamps visible in logs to verify freshness
- ✅ No stale/reused screenshots in context

---

## If Issues Persist

### Settings Not Saving:
1. Check backend logs for database errors
2. Verify Supabase connection is working
3. Check if user_id is correct in requests

### Old Vision Context:
1. Verify cutoff time calculation in logs
2. Check if old events have timestamps within 60 min window
3. Consider lowering `max_age_minutes` from 60 to 30 or 15

### Vision Not Capturing:
1. Check if vision is enabled globally (toggle at top of Settings)
2. Verify app preferences allow vision
3. Check VisionScheduler logs for preference checks
