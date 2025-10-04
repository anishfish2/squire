# Vision Events - One-Time Use System

## Overview

Vision events are now used **exactly once** in LLM context and then marked as "used" to prevent repetition.

## How It Works

### 1. Vision Event Lifecycle

```
Screenshot Captured
        ↓
Vision Analysis Complete
        ↓
Event stored: { used_in_llm: false }
        ↓
LLM Request arrives
        ↓
Fetch ONLY unused events (used_in_llm = false)
        ↓
Add to LLM context
        ↓
Mark as used: { used_in_llm: true, used_in_llm_at: timestamp }
        ↓
Event will NEVER be used in LLM again
```

### 2. Database Schema (Migration 019)

```sql
ALTER TABLE vision_events
ADD COLUMN used_in_llm BOOLEAN DEFAULT FALSE;

ALTER TABLE vision_events
ADD COLUMN used_in_llm_at TIMESTAMP WITH TIME ZONE;
```

**Fields:**
- `used_in_llm` - Boolean flag indicating if event was used
- `used_in_llm_at` - Timestamp when it was marked as used

**Indexes:**
- Optimized queries for unused events only
- Per-app and global unused event queries

### 3. Query Logic

**Before (Old System - PROBLEMATIC):**
```python
# Got ALL events from last 60 minutes
# Same events could be reused multiple times
vision_events = get_recent_vision_events(user_id, limit=3)
```

**After (New System - CORRECT):**
```python
# Get ONLY unused events from last 60 minutes
vision_events = get_recent_vision_events(
    user_id=user_id,
    limit=3,
    only_unused=True  # Filter: used_in_llm = FALSE
)

# Mark them as used immediately after fetching
mark_events_as_used(event_ids)
```

---

## Benefits

### ✅ No Repetition
- Each vision insight used exactly once
- LLM never sees same screenshot analysis twice
- Fresh context in every request

### ✅ Automatic Cleanup
- Old "used" events naturally filtered out
- No manual intervention needed
- Database queries optimized with partial indexes

### ✅ Clear Logging
```
🔍 GET RECENT VISION EVENTS
   Only unused: True
   Found 3 unused events
   1. [2025-10-03T10:30:00] VS Code [used=False]: Writing Python code
   2. [2025-10-03T10:29:50] Chrome [used=False]: Reading documentation
   3. [2025-10-03T10:29:40] Terminal [used=False]: Running tests

📌 MARKING EVENTS AS USED
   Event count: 3
   ✅ Marked 3 events as used in LLM
```

---

## Example Flow

### Scenario: User working in VS Code

**10:00:00** - Screenshot captured, vision analysis: "Writing API endpoint"
```sql
INSERT vision_events (id='abc', app_name='VS Code', used_in_llm=FALSE, ...)
```

**10:00:15** - User types, triggers LLM suggestion
```python
# Fetch unused events
events = get_recent_vision_events(only_unused=True)  # Returns [abc]

# Build context with vision
context = """
🔮 VISION INSIGHTS:
1. VS Code: Writing API endpoint
"""

# Mark as used
mark_events_as_used(['abc'])
```

**10:00:20** - User types again, triggers another LLM suggestion
```python
# Fetch unused events
events = get_recent_vision_events(only_unused=True)  # Returns [] (empty!)

# No vision context this time
context = ""  # No unused events available
```

**10:00:30** - New screenshot captured, vision analysis: "Debugging error"
```sql
INSERT vision_events (id='def', app_name='VS Code', used_in_llm=FALSE, ...)
```

**10:00:45** - User types, triggers LLM suggestion
```python
# Fetch unused events
events = get_recent_vision_events(only_unused=True)  # Returns [def]

# Build context with NEW vision
context = """
🔮 VISION INSIGHTS:
1. VS Code: Debugging error
"""

# Mark as used
mark_events_as_used(['def'])
```

---

## Configuration

### Time Window
- Default: 60 minutes
- Only events from last hour are considered
- Even if unused, events older than 60min are filtered out

```python
get_recent_vision_events(
    user_id=user_id,
    max_age_minutes=60,  # Configurable
    only_unused=True
)
```

### Limit
- Default: 3 events per request
- Configurable based on token budget

```python
get_recent_vision_events(
    user_id=user_id,
    limit=3,  # Max events to return
    only_unused=True
)
```

---

## Monitoring

### Check Unused Events (SQL)
```sql
SELECT
    id, app_name, created_at, used_in_llm, used_in_llm_at
FROM vision_events
WHERE user_id = 'your-user-id'
  AND used_in_llm = FALSE
  AND deleted_at IS NULL
ORDER BY created_at DESC;
```

### Check Usage Stats (SQL)
```sql
SELECT
    COUNT(*) FILTER (WHERE used_in_llm = TRUE) as used_count,
    COUNT(*) FILTER (WHERE used_in_llm = FALSE) as unused_count,
    COUNT(*) as total_count
FROM vision_events
WHERE user_id = 'your-user-id'
  AND created_at > NOW() - INTERVAL '1 hour';
```

---

## Troubleshooting

### "No unused events found" in logs
**Possible causes:**
1. ✅ **Expected**: All recent events already used in previous LLM calls
2. ✅ **Expected**: No new screenshots captured recently (vision disabled?)
3. ❌ **Issue**: Events not being marked as unused (check `used_in_llm` column exists)

**Solution**: Wait for new screenshot capture (every 10 seconds)

### Same vision context appearing twice
**Possible causes:**
1. ❌ **Issue**: `mark_events_as_used()` not being called
2. ❌ **Issue**: Database update failing silently

**Solution**: Check logs for `📌 MARKING EVENTS AS USED` confirmation

### Too few vision events in context
**Possible causes:**
1. ✅ **Expected**: Events being used up faster than new screenshots captured
2. ✅ **Expected**: User typing multiple suggestions between screenshot intervals

**Solution**: Decrease screenshot interval (currently 10 seconds) or increase limit
