# Phase 1 Testing Guide - Vision Feature with AWS S3

This guide will walk you through testing all Phase 1 features of the vision system with AWS S3 storage.

---

## Prerequisites

✅ Migrations 15 and 16 have been run (you mentioned these are done)
✅ AWS account with S3 access
✅ AWS credentials with S3 permissions

---

## Step 1: AWS S3 Setup

### 1.1 Create S3 Bucket

1. Go to AWS S3 Console: https://s3.console.aws.amazon.com/s3/buckets
2. Click **"Create bucket"**
3. Configure:
   - **Bucket name**: `squire-screenshots` (or your preferred name)
   - **Region**: `us-east-1` (or your preferred region)
   - **Block Public Access**: ✅ Keep all enabled (bucket should be private)
   - **Bucket Versioning**: Optional (disabled is fine)
   - **Tags**: Optional
   - **Default encryption**: ✅ Enable SSE-S3 (recommended)

4. Click **"Create bucket"**

### 1.2 Create IAM User for Squire

1. Go to IAM Console: https://console.aws.amazon.com/iam/home
2. Click **"Users"** → **"Create user"**
3. User name: `squire-app`
4. **Access type**: Programmatic access
5. Click **"Next: Permissions"**
6. Click **"Attach policies directly"**
7. Search for and select: **"AmazonS3FullAccess"** (or create a custom policy - see below)
8. Click **"Next"** → **"Create user"**
9. **IMPORTANT**: Download the credentials CSV or copy:
   - Access Key ID
   - Secret Access Key

### 1.3 (Optional) Custom IAM Policy

For better security, create a custom policy that only allows access to your squire bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::squire-screenshots",
        "arn:aws:s3:::squire-screenshots/*"
      ]
    }
  ]
}
```

---

## Step 2: Configure Backend Environment

### 2.1 Update `.env` file

Edit `squire-backend/.env` and add:

```bash
# AWS S3 Configuration
AWS_ACCESS_KEY_ID=AKIA...your-access-key...
AWS_SECRET_ACCESS_KEY=your-secret-key-here
AWS_REGION=us-east-1
AWS_S3_BUCKET=squire-screenshots

# Supabase (already configured)
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-supabase-key

# OpenAI (for Phase 2 - not needed yet)
# OPENAI_API_KEY=sk-...

# Server
PORT=8000
HOST=127.0.0.1
DEBUG=true
```

### 2.2 Install/Update Dependencies

```bash
cd squire-backend
pip install boto3
# Or reinstall all:
pip install -r requirements.txt
```

---

## Step 3: Start Backend

```bash
cd squire-backend
python main.py
```

You should see:
```
✅ S3 client initialized for bucket: squire-screenshots
🚀 Starting Squire Backend API...
```

---

## Step 4: Test API Endpoints

### 4.1 Health Check

Test that S3 is connected:

```bash
curl http://localhost:8000/api/vision/health
```

**Expected response:**
```json
{
  "status": "ok",
  "service": "vision",
  "s3_status": "connected",
  "bucket": "squire-screenshots"
}
```

❌ If `s3_status: "disconnected"`:
- Check AWS credentials in `.env`
- Verify bucket name matches
- Check AWS credentials have S3 permissions

### 4.2 Test App Preferences API

**Get all preferences (should be empty initially):**
```bash
curl http://localhost:8000/api/vision/preferences/550e8400-e29b-41d4-a716-446655440000
```

**Expected:** `[]` (empty array)

**Create a preference:**
```bash
curl -X PUT http://localhost:8000/api/vision/preferences/550e8400-e29b-41d4-a716-446655440000/VSCode \
  -H "Content-Type: application/json" \
  -d '{
    "allow_ocr": true,
    "allow_vision": true,
    "allow_screenshots": true
  }'
```

**Expected response:**
```json
{
  "success": true,
  "data": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "app_name": "VSCode",
    "allow_ocr": true,
    "allow_vision": true,
    "allow_screenshots": true,
    ...
  }
}
```

**Get preferences again:**
```bash
curl http://localhost:8000/api/vision/preferences/550e8400-e29b-41d4-a716-446655440000
```

**Expected:** Should now show the VSCode preference

### 4.3 Test S3 Screenshot Upload

Create a test image:
```bash
# Create a simple test image
convert -size 100x100 xc:blue test_screenshot.png
# Or on Mac:
# Use Preview to create a simple PNG image
```

Upload to S3:
```bash
curl -X POST http://localhost:8000/api/vision/screenshots/upload/550e8400-e29b-41d4-a716-446655440000 \
  -F "file=@test_screenshot.png"
```

**Expected response:**
```json
{
  "success": true,
  "screenshot_id": "abc-123-def-456",
  "url": "https://squire-screenshots.s3.us-east-1.amazonaws.com/550e8400-.../2025/10/abc-123.png",
  "storage_path": "550e8400-.../2025/10/abc-123.png",
  "size_bytes": 12345
}
```

**Verify in AWS Console:**
1. Go to S3 bucket: https://s3.console.aws.amazon.com/s3/buckets/squire-screenshots
2. Navigate through folders: `{user_id}/2025/10/`
3. You should see the uploaded screenshot

### 4.4 Test Presigned URL Generation

```bash
curl "http://localhost:8000/api/vision/screenshots/presigned-url?storage_path=550e8400-.../2025/10/abc-123.png&expiration=3600"
```

**Expected response:**
```json
{
  "success": true,
  "url": "https://squire-screenshots.s3.us-east-1.amazonaws.com/...?X-Amz-Expires=3600...",
  "expires_in": 3600
}
```

Copy the URL and paste it in your browser - you should see the screenshot!

---

## Step 5: Test Frontend Settings UI

### 5.1 Start Electron App

```bash
cd electron-app
npm start
```

### 5.2 Open Settings Window

Use one of these methods:
- Press `Cmd+,` (Mac) / `Ctrl+,` (Windows/Linux)
- Press `Cmd+Shift+S` (global shortcut)
- Menu → Squire → Settings

### 5.3 Test Settings UI

**Expected behavior:**

1. **Initial state**:
   - Settings window opens
   - Shows "Loading detected apps..." or "No apps detected yet"

2. **Populate apps**:
   - Switch between different apps (Chrome, VSCode, Terminal, etc.)
   - Go back to settings window
   - Click **"Refresh Apps"** button
   - Apps should now appear in the list

3. **Test toggles**:
   - Click OCR toggle for an app → should turn green
   - Click Vision toggle → should turn purple
   - Click Screenshots toggle → should turn blue
   - Check backend logs for: `✅ Updated preference for {app_name}`

4. **Test quick actions**:
   - Click **"Enable All OCR"** → all OCR toggles should turn on
   - Click **"Disable All"** → all toggles should turn off
   - Click **"Enable Vision (All)"** → all Vision + Screenshots toggles on

5. **Test search**:
   - Type app name in search box
   - Only matching apps should be visible

6. **Test stats**:
   - Footer should show:
     - Total Apps: X
     - OCR Enabled: Y
     - Vision Enabled: Z
   - Numbers should update as you toggle preferences

---

## Step 6: Verify Database

Check that preferences were saved to Supabase:

1. Go to Supabase dashboard: https://supabase.com/dashboard
2. Navigate to: Table Editor → `user_app_preferences`
3. You should see rows for each app you configured

**SQL Query to check:**
```sql
SELECT app_name, allow_ocr, allow_vision, allow_screenshots
FROM user_app_preferences
WHERE user_id = '550e8400-e29b-41d4-a716-446655440000';
```

---

## Step 7: Test Persistence

1. Configure some app preferences in Settings UI
2. **Close the Electron app completely** (Cmd+Q)
3. Restart the Electron app
4. Open Settings (Cmd+,)
5. Click **"Refresh Apps"**
6. **Verify**: Previously configured preferences should be restored

---

## Troubleshooting

### Issue: `s3_status: "disconnected"`

**Solution:**
1. Verify `.env` has correct AWS credentials
2. Check bucket name matches exactly
3. Test AWS CLI access:
   ```bash
   aws s3 ls s3://squire-screenshots
   ```
4. Verify IAM user has S3 permissions

### Issue: Settings window shows no apps

**Solution:**
1. Switch between different applications
2. Click "Refresh Apps" in settings
3. Check Electron console logs (View → Developer → Developer Tools)
4. Verify `detectedApps` set is populated in main.js

### Issue: Toggles don't persist

**Solution:**
1. Check backend is running
2. Check backend logs for errors during PUT requests
3. Verify Supabase connection is working
4. Test API endpoints directly with curl

### Issue: Screenshot upload fails

**Solution:**
1. Check AWS credentials are correct
2. Verify bucket exists and is accessible
3. Check IAM user has `PutObject` permission
4. Look for error in backend logs

### Issue: Presigned URL doesn't work

**Solution:**
1. Make sure the storage_path parameter is URL-encoded
2. Check the file actually exists in S3
3. Verify presigned URL hasn't expired

---

## Success Checklist

Phase 1 is working correctly if:

- ✅ Backend starts without S3 errors
- ✅ `/api/vision/health` shows `s3_status: "connected"`
- ✅ Can create/update app preferences via API
- ✅ Can upload screenshot to S3 via API
- ✅ Can generate presigned URL for screenshot
- ✅ Settings UI opens with keyboard shortcut
- ✅ Apps appear in settings after switching
- ✅ Toggles update and persist to database
- ✅ Quick actions work (Enable All, etc.)
- ✅ Preferences survive app restart
- ✅ Screenshots appear in S3 bucket
- ✅ Database shows preferences in `user_app_preferences` table

---

## Next Steps

Once all tests pass:

✅ **Phase 1 Complete!**

Ready for **Phase 2**:
- VisionScheduler (smart screenshot capture)
- VisionJobManager (vision processing)
- Vision API integration (GPT-4 Vision)
- Merge vision context with suggestions

---

## Quick Reference

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/vision/health` | GET | Check S3 connection |
| `/api/vision/preferences/{user_id}` | GET | Get all preferences |
| `/api/vision/preferences/{user_id}/{app}` | GET | Get app preference |
| `/api/vision/preferences/{user_id}/{app}` | PUT | Update preference |
| `/api/vision/screenshots/upload/{user_id}` | POST | Upload screenshot |
| `/api/vision/screenshots/presigned-url` | GET | Get presigned URL |

### Environment Variables

```bash
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_REGION=us-east-1
AWS_S3_BUCKET=squire-screenshots
SUPABASE_URL=your-url
SUPABASE_ANON_KEY=your-key
```

### Keyboard Shortcuts

- `Cmd+,` or `Ctrl+,` - Open Settings
- `Cmd+Shift+S` - Open Settings (alternative)

---

**Questions?** Check the detailed setup docs:
- `squire-backend/VISION_SETUP.md`
- `VISION_PHASE1_COMPLETE.md`
