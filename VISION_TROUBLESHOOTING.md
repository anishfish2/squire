# Vision Feature - Troubleshooting Guide

## Common Issues & Fixes

### Issue 1: Apps Disappear from Settings

**Symptoms**:
- You enable vision for an app
- Close Settings window
- Reopen Settings → app is gone

**Root Cause**: App preferences not saved to database

**Fix**: Now implemented! The fixes ensure:
1. ✅ `mergeWithPreferences()` now saves to database immediately
2. ✅ `app-preferences-loaded` marks all database apps as detected
3. ✅ Apps persist across Settings window reopens

**How to verify**:
```bash
# Open Settings (Cmd+,)
# Check console logs for:
⚙️ [Settings] Loaded app preferences from database: X apps
  - Chrome: vision=true, screenshots=false
  - VSCode: vision=false, screenshots=false
```

---

### Issue 2: Vision Says "Disabled" But Settings Show "Enabled"

**Symptoms**:
- Settings UI shows vision toggle ON
- VisionScheduler logs say "vision disabled"

**Root Causes**:
1. VisionScheduler hasn't refreshed preferences
2. App name mismatch (e.g., "Chrome" vs "Google Chrome")

**How to diagnose**:

Check VisionScheduler logs:
```bash
📸 [VisionScheduler] shouldCapture = false (no preferences found for "Google Chrome")
   Available apps in preferences: ["kitty", "Finder", "VSCode"]
```

This shows the app name doesn't match!

**Fix**:
1. Check exact app name in Settings
2. Toggle vision OFF then ON (forces refresh)
3. VisionScheduler will refresh preferences automatically

**Verify**:
```bash
# After toggling, you should see:
📸 [VisionScheduler] Refreshing preference for "Google Chrome"...
📸 [VisionScheduler] ✅ Refreshed preference for "Google Chrome": vision=true
```

---

### Issue 3: Preferences Not Persisting

**Symptoms**:
- Enable vision for app
- Works for a while
- Restart Squire → settings lost

**Root Cause**: Database not being updated

**Check database**:
```sql
SELECT app_name, allow_vision, allow_screenshots, updated_at
FROM user_app_preferences
WHERE user_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY updated_at DESC;
```

**If no rows**: Preferences never saved to database

**Fix**: Check backend logs for errors:
```bash
cd squire-backend
python main.py

# Watch for:
❌ Failed to update preference for Chrome: 500
```

**Common causes**:
- Backend not running
- Supabase credentials invalid
- Network connectivity issue

---

### Issue 4: Vision Captures Not Happening

**Symptoms**:
- Vision enabled in Settings
- No captures happening
- No logs in console

**Debugging steps**:

#### Step 1: Check VisionScheduler is running

```bash
# In Electron console, you should see on startup:
📸 VisionScheduler initialized
📸 [VisionScheduler] Loading app preferences from backend...
📸 [VisionScheduler] ✅ Loaded preferences for 3 apps:
   - kitty: vision=true, screenshots=false
   - Chrome: vision=true, screenshots=true
```

**If not seeing this**: VisionScheduler not initialized

#### Step 2: Check current app detection

```bash
# When you switch apps, should see:
📱 New app detected: Google Chrome
📸 App changed: kitty → Google Chrome
📸 [VisionScheduler] Next capture for "Google Chrome" in 10s (enabled: true)
```

#### Step 3: Check shouldCapture logic

```bash
# Every 10 seconds, should see ONE of:

# ✅ Vision enabled:
📸 [VisionScheduler] shouldCapture = true for "Google Chrome" (allow_vision=true)

# ❌ Vision disabled:
📸 [VisionScheduler] shouldCapture = false (no preferences found for "Google Chrome")
```

#### Step 4: Check actual capture

```bash
# If shouldCapture = true, you should see:
========================================
📸 [VisionScheduler] STARTING CAPTURE
   App: Google Chrome
   Time: 2025-10-03T12:34:56.789Z
========================================
📸 [VisionScheduler] Display size: 2560x1440
📸 [VisionScheduler] Found 1 screen source(s)
📸 [VisionScheduler] ✅ Screenshot captured: 1024.50 KB
```

**If capture starts but fails**: Check for permission errors

---

### Issue 5: Vision Enabled But "No Preferences Found"

**Symptoms**:
```bash
📸 [VisionScheduler] shouldCapture = false (no preferences found for "Google Chrome")
   Available apps in preferences: []
```

**Root Cause**: VisionScheduler preferences Map is empty

**How this happens**:
1. VisionScheduler loads preferences on startup
2. Backend returns empty array (no apps in database)
3. You enable vision in Settings
4. VisionScheduler doesn't get notified

**Fix**: The `refreshAppPreference()` is now called automatically when you toggle in Settings

**Verify**:
```bash
# When you toggle vision ON in Settings, should see:
📸 [VisionScheduler] Refreshing preference for "Google Chrome"...
📸 [VisionScheduler] ✅ Refreshed preference for "Google Chrome": vision=true, screenshots=false
```

---

### Issue 6: Database Has Preferences But Settings Shows Empty

**Symptoms**:
- Query database → preferences exist
- Open Settings → no apps shown

**Root Cause**: `load-app-preferences` IPC handler not responding

**Check**:
```bash
# In Electron console when opening Settings:
⚙️ [Settings] Loaded app preferences from database: 0 apps
```

**If count is 0 but database has rows**: Backend API issue

**Test backend directly**:
```bash
curl http://127.0.0.1:8000/api/vision/preferences/550e8400-e29b-41d4-a716-446655440000 | jq
```

**Expected**:
```json
[
  {
    "app_name": "Google Chrome",
    "allow_vision": true,
    "allow_screenshots": false,
    ...
  }
]
```

**If empty array**: Database issue (wrong user_id or no rows)

---

## Testing Checklist

Use this to verify everything works:

### 1. Preferences Persistence

- [ ] Enable vision for app in Settings
- [ ] Close Settings window
- [ ] Reopen Settings (Cmd+,)
- [ ] **PASS**: App still shows vision enabled

### 2. Vision Capture Flow

- [ ] Enable vision for app
- [ ] Switch to that app
- [ ] Wait 10 seconds
- [ ] **PASS**: See capture logs in console

### 3. Settings → VisionScheduler Sync

- [ ] Open Settings
- [ ] Toggle vision ON for app
- [ ] Check console for refresh log
- [ ] **PASS**: VisionScheduler refreshes preferences

### 4. Database Persistence

- [ ] Enable vision for app
- [ ] Restart Squire completely
- [ ] Check Settings
- [ ] **PASS**: Vision still enabled

### 5. Cross-Window Consistency

- [ ] Enable vision in Settings
- [ ] VisionScheduler starts capturing
- [ ] Toggle vision OFF in Settings
- [ ] **PASS**: VisionScheduler stops capturing

---

## Log Patterns

### ✅ Healthy Vision System

```bash
# Startup
📸 VisionScheduler initialized
📸 [VisionScheduler] Loading app preferences from backend...
📸 [VisionScheduler] ✅ Loaded preferences for 2 apps:
   - kitty: vision=true, screenshots=false
   - Chrome: vision=true, screenshots=true

# App switch
📱 New app detected: Google Chrome
📸 App changed: kitty → Google Chrome
📸 [VisionScheduler] Next capture for "Google Chrome" in 10s (enabled: true)

# Capture cycle
📸 [VisionScheduler] shouldCapture = true for "Google Chrome" (allow_vision=true)
========================================
📸 [VisionScheduler] STARTING CAPTURE
   App: Google Chrome
========================================
📸 [VisionScheduler] ✅ Screenshot captured: 1024.50 KB
📸 [VisionScheduler] ✅ Vision job created successfully!
   - Job ID: abc-123
   - Status: processing
   - S3 stored: true

# Backend
============================================================
📸 [VisionJobManager] CREATE VISION JOB
   Job ID: abc-123
   App: Google Chrome
   Screenshot size: 1024.50 KB
============================================================
✅ [VisionJobManager] Vision analysis complete!
   - Processing time: 6.34s
   - Model: claude-3-5-sonnet-20241022
✅ [VisionJobManager] Job abc-123 completed successfully
```

### ❌ Broken Vision System

```bash
# No preferences loaded
📸 [VisionScheduler] ✅ Loaded preferences for 0 apps:

# Can't capture
📸 [VisionScheduler] shouldCapture = false (no preferences found for "Google Chrome")
   Available apps in preferences: []

# OR

# Preference not saving
⚙️ [Settings] Updating preference for Chrome: {allow_vision: true}
❌ Failed to update preference for Chrome: 500
```

---

## Quick Fixes

### Reset All Preferences

```sql
-- In Supabase SQL Editor
DELETE FROM user_app_preferences
WHERE user_id = '550e8400-e29b-41d4-a716-446655440000';

-- Restart Squire
-- Preferences will be recreated with defaults
```

### Force Preference Refresh

```javascript
// In Electron DevTools console
ipcRenderer.send('load-app-preferences')
```

### Check VisionScheduler State

```javascript
// In Electron DevTools console (main process)
console.log(visionScheduler.appPreferences)
console.log(visionScheduler.currentApp)
console.log(visionScheduler.globalVisionEnabled)
```

---

## Support

If none of these fixes work:

1. **Collect logs**: Copy entire console output
2. **Check database**: Run the SQL queries above
3. **Test API**: Run the curl commands
4. **Create minimal test**: Enable vision for 1 app only
5. **Watch logs**: Both Electron and backend simultaneously

The enhanced logging should make it obvious where the issue is!
