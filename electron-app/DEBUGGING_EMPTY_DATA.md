# Debugging Empty Supabase Tables

Your Supabase tables are empty because the features need to be **explicitly enabled** and **triggered** by app usage. Here's how to fix it:

## 🔍 Root Causes

### 1. Vision Events Empty
**Why:** Vision is disabled by default for all apps
**Fix:** Enable vision for specific apps in Settings

### 2. AI Suggestions Empty
**Why:** Suggestions are only generated after you accumulate OCR batches
**Fix:** Switch between apps to build up context

### 3. Active Vision Events Empty
**Why:** Same as vision events - needs to be enabled
**Fix:** Enable vision globally + per-app

---

## ✅ Step-by-Step Fix

### Step 1: Verify Backend is Running

```bash
# In squire-backend/ terminal
python -m uvicorn main:app --reload

# Should see:
# INFO:     Uvicorn running on http://127.0.0.1:8000
```

Test it:
```bash
curl http://127.0.0.1:8000/docs
# Should return HTML (Swagger UI)
```

### Step 2: Start Electron App

```bash
# In electron-app/ terminal
npm run dev
```

Look for these startup messages in terminal:
```
✓ VisionScheduler started
✓ Session created
✓ Suggestions window visible
```

### Step 3: Enable Vision Feature

**Method 1: Via Settings UI**
1. Open Settings: `Cmd+Shift+S` (or Menu → Settings)
2. Find "Vision Feature" toggle at top
3. Turn it **ON** ✅
4. Scroll down to find an app (like "Code" or "Chrome")
5. Turn on **Vision** toggle for that app ✅

**Method 2: Enable All Apps**
1. Open Settings
2. Click "Enable Vision (All)" button
3. All apps will have vision enabled ✅

**Expected Result:**
- VisionScheduler will start capturing every 10-60 seconds
- Screenshots sent to backend → stored in Supabase

### Step 4: Generate AI Suggestions

AI suggestions require **OCR batches** from app switching:

1. **Switch between apps** (at least 2-3 different apps)
2. Wait a few seconds between switches
3. Switch 5+ times to build a batch

**Example workflow:**
```bash
1. Open Chrome → Wait 3 seconds
2. Switch to VSCode → Wait 3 seconds
3. Switch to Terminal → Wait 3 seconds
4. Switch to Chrome → Wait 3 seconds
5. Switch to VSCode → Wait 3 seconds
```

After 5+ switches, OCR batch is sent to AI → Suggestions appear

### Step 5: Force Generate Suggestions

If you don't want to wait:

1. Switch between 2-3 apps a few times
2. Click the **🔍 Search button** in suggestions window (top right, below the dot)
3. This forces batch submission → AI processes → Shows suggestions

---

## 🧪 Verification Checklist

### ✅ Vision Events Working:

**Check 1: Terminal Logs**
```bash
# In Electron terminal, look for:
📸 [VisionScheduler] Capturing for: Chrome
📸 [VisionScheduler] Vision job queued
```

**Check 2: Backend Logs**
```bash
# In backend terminal, look for:
INFO: POST /api/vision/jobs/{userId}
INFO: Vision job created
```

**Check 3: Supabase**
```sql
SELECT * FROM vision_events ORDER BY created_at DESC LIMIT 5;
-- Should show recent captures
```

### ✅ AI Suggestions Working:

**Check 1: Terminal Logs**
```bash
# In Electron terminal, look for:
📊 [Batch] Sending batch with 5 apps
🤖 [AI] Received 3 suggestions
```

**Check 2: Backend Logs**
```bash
# In backend terminal, look for:
INFO: POST /api/ai/batch-context
INFO: Generated 3 suggestions
```

**Check 3: Supabase**
```sql
SELECT * FROM ai_suggestions ORDER BY created_at DESC LIMIT 5;
-- Should show recent suggestions
```

**Check 4: UI**
- Suggestions window should show suggestions
- Can click to expand/collapse

---

## 🐛 Troubleshooting

### Problem: Vision events still empty after enabling

**Check app is actually enabled:**
```bash
# In browser, check backend:
curl http://127.0.0.1:8000/api/vision/preferences/550e8400-e29b-41d4-a716-446655440000

# Should return JSON with apps like:
# { "app_name": "Chrome", "allow_vision": true, ... }
```

**Check VisionScheduler is running:**
```bash
# In Electron DevTools Console (Suggestions window):
# Right-click suggestions window → Inspect
# Console should show:
"VisionScheduler initialized"
```

**Force immediate capture:**
```js
// In Electron DevTools Console:
// This manually triggers a capture (for testing):
window.require('electron').ipcRenderer.send('force-vision-capture')
```

### Problem: AI suggestions still empty

**Check OCR is working:**
```bash
# Terminal logs should show:
"OCR job <jobid> queued for batch processing"
"Batch submitted with X apps"
```

**Check batch was sent:**
```bash
# Backend logs should show:
INFO: POST /api/ai/batch-context
```

**Check for errors:**
```bash
# Look for these in backend logs:
ERROR: OpenAI API error
ERROR: Database error
```

### Problem: No data in any tables

**Verify Supabase connection:**
```bash
# In squire-backend/.env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key

# Test connection:
curl -H "apikey: YOUR_SUPABASE_KEY" \
     https://your-project.supabase.co/rest/v1/vision_events
```

**Check database tables exist:**
```sql
-- In Supabase SQL Editor:
\dt
-- Should list: vision_events, active_vision_events, ai_suggestions, etc.
```

---

## 📊 Expected Data Flow

### Vision Events:
```
App Switch → VisionScheduler checks shouldCapture()
           → Takes screenshot
           → POST /api/vision/jobs/{userId}
           → Backend saves to vision_events table
           → Also creates active_vision_event
```

### AI Suggestions:
```
App Switch → OCR captured
           → Added to batch (5 max)
           → Batch timeout (30s) or batch full
           → POST /api/ai/batch-context
           → Backend calls OpenAI
           → Saves suggestions to ai_suggestions table
           → IPC to Electron → Shows in UI
```

---

## 🎯 Quick Test Script

Run this to verify everything:

```bash
# 1. Backend must be running
curl -s http://127.0.0.1:8000/health || echo "❌ Backend down"

# 2. Check if user preferences exist
curl http://127.0.0.1:8000/api/vision/preferences/550e8400-e29b-41d4-a716-446655440000

# 3. Enable vision for Chrome (example)
curl -X PUT http://127.0.0.1:8000/api/vision/preferences/550e8400-e29b-41d4-a716-446655440000/Chrome \
  -H "Content-Type: application/json" \
  -d '{"allow_vision": true, "vision_frequency": "normal"}'

# 4. Check Supabase has data
curl -H "apikey: YOUR_KEY" \
     https://your-project.supabase.co/rest/v1/vision_events?select=*&limit=5
```

---

## ✅ Success Criteria

You'll know it's working when:

1. **Vision Events:**
   - Terminal shows: `📸 [VisionScheduler] Capturing`
   - Backend logs: `POST /api/vision/jobs`
   - Supabase: `SELECT * FROM vision_events` returns rows

2. **AI Suggestions:**
   - Terminal shows: `🤖 [AI] Received X suggestions`
   - UI shows: Suggestions in the floating window
   - Supabase: `SELECT * FROM ai_suggestions` returns rows

3. **Active Vision Events:**
   - Created alongside vision_events
   - Same timestamp and context
   - Supabase: `SELECT * FROM active_vision_events` returns rows

---

## 🚨 Common Mistakes

1. ❌ Forgetting to enable vision in Settings
2. ❌ Not switching between apps enough (need 3+ switches)
3. ❌ Backend not running
4. ❌ Wrong user ID in API calls
5. ❌ Supabase .env credentials wrong
6. ❌ OpenAI API key not set (for AI suggestions)

---

## 💡 Pro Tips

1. **Enable logging:**
   - Run `npm run dev` (not `npm start`)
   - Keep terminal visible to see logs
   - Open DevTools in suggestions window

2. **Test one feature at a time:**
   - Start with vision only
   - Verify vision events in Supabase
   - Then test AI suggestions

3. **Use the force button:**
   - Click 🔍 button in UI to force suggestion generation
   - Helps test without waiting for batches

4. **Check backend health:**
   - Visit `http://127.0.0.1:8000/docs`
   - Try API endpoints manually
   - Check logs for errors

---

**Need more help?** Check the terminal logs and backend logs - they'll tell you exactly what's happening (or not happening)!
