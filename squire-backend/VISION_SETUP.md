# Vision Feature Setup Guide

This guide walks you through setting up the vision feature for Squire, including database migrations and Supabase Storage configuration.

## Prerequisites

- Supabase project already set up
- Database migrations 001-014 already applied
- Supabase Storage enabled

## Step 1: Run Database Migrations

1. Run the migration helper script:
   ```bash
   cd squire-backend
   ./apply_vision_migrations.sh
   ```

2. Copy the output SQL and paste it into your Supabase SQL Editor:
   - Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/sql
   - Paste and run the SQL

3. Verify tables were created:
   ```sql
   SELECT table_name FROM information_schema.tables
   WHERE table_name IN ('user_app_preferences', 'vision_events');
   ```

## Step 2: Create AWS S3 Bucket

### 2.1 Create S3 Bucket

1. Go to AWS S3 Console: https://s3.console.aws.amazon.com/s3/buckets
2. Click **"Create bucket"**
3. Configure:
   - **Bucket name**: `squire-screenshots`
   - **Region**: `us-east-1` (or your preferred region)
   - **Block Public Access**: ✅ Keep all enabled (private bucket)
   - **Bucket Versioning**: Optional (disabled is fine)
   - **Default encryption**: ✅ Enable SSE-S3 (recommended)
4. Click **"Create bucket"**

### 2.2 Create IAM User

1. Go to IAM Console: https://console.aws.amazon.com/iam/home
2. Create user: `squire-app` with programmatic access
3. Attach policy: **AmazonS3FullAccess** (or custom policy below)
4. **Save credentials**: Access Key ID + Secret Access Key

### 2.3 (Optional) Custom IAM Policy

For better security:

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

## Step 3: Configure Retention Policy (Optional but Recommended)

Set up a cron job to automatically clean up old screenshots:

```sql
-- Create a scheduled function to run daily at 3 AM
-- Note: This requires pg_cron extension, enable it in Database > Extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily cleanup
SELECT cron.schedule(
    'cleanup-expired-screenshots',
    '0 3 * * *', -- Run at 3 AM daily
    $$
    SELECT soft_delete_expired_vision_events();
    $$
);
```

## Step 4: Update Environment Variables

Add the following to your `.env` file:

```bash
# AWS S3 Storage
AWS_ACCESS_KEY_ID=AKIA...your-access-key...
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
AWS_S3_BUCKET=squire-screenshots

# Vision API (for Phase 2 - choose one)
OPENAI_API_KEY=your_openai_api_key_here  # For GPT-4 Vision
# ANTHROPIC_API_KEY=your_anthropic_key  # For Claude 3.5 Vision (alternative)

# Vision feature flags
VISION_ENABLED=true
VISION_DEFAULT_MODEL=gpt-4-vision-preview  # or claude-3-5-sonnet
```

## Step 5: Verify Setup

Run this test query to ensure everything is set up correctly:

```sql
-- Test 1: Check tables exist
SELECT 'user_app_preferences' as table_name, COUNT(*) as exists
FROM information_schema.tables
WHERE table_name = 'user_app_preferences'
UNION ALL
SELECT 'vision_events', COUNT(*)
FROM information_schema.tables
WHERE table_name = 'vision_events';

-- Test 2: Insert a test preference
INSERT INTO user_app_preferences (user_id, app_name, allow_vision)
VALUES (
    (SELECT id FROM user_profiles LIMIT 1),
    'TestApp',
    true
)
ON CONFLICT (user_id, app_name) DO NOTHING;

-- Test 3: Query test preference
SELECT * FROM user_app_preferences WHERE app_name = 'TestApp';

-- Cleanup test data
DELETE FROM user_app_preferences WHERE app_name = 'TestApp';
```

## Storage Structure

Screenshots will be stored in the following structure:

```
screenshots/
  ├── {user_id}/
  │   ├── {year}/
  │   │   ├── {month}/
  │   │   │   ├── {screenshot_id}.png
  │   │   │   ├── {screenshot_id}.png
  │   │   │   └── ...
```

Example path: `screenshots/550e8400-e29b-41d4-a716-446655440000/2025/10/abc123-def456.png`

## Default App Preferences

By default:
- ✅ **OCR**: Enabled for all apps
- ❌ **Vision**: Disabled for all apps (user must opt-in)
- ❌ **Screenshots**: Disabled for all apps (user must opt-in)
- 📅 **Retention**: 30 days

Users can customize these settings per-app in the Settings UI (to be implemented next).

## Cost Considerations

### Storage Costs (Supabase)
- Free tier: 1 GB storage
- Paid: $0.021/GB/month
- Estimated usage: ~100-500 KB per screenshot
- 1000 screenshots ≈ 100-500 MB ≈ $0.002-0.01/month

### Vision API Costs
- GPT-4 Vision: ~$0.01-0.03 per image
- Claude Vision: ~$0.01-0.02 per image
- With 30s interval: ~2 images/min = 120/hour
- Cost: **$1.20-3.60/hour** ⚠️ Can be expensive!

**Recommendation**:
1. Start with vision disabled by default
2. Let users opt-in per-app
3. Use conservative capture intervals (60s+)
4. Consider implementing daily budget caps

## Troubleshooting

### Issue: Migration fails with "relation already exists"
**Solution**: Tables might already exist. Run:
```sql
DROP TABLE IF EXISTS vision_events CASCADE;
DROP TABLE IF EXISTS user_app_preferences CASCADE;
```
Then re-run the migrations.

### Issue: Storage upload fails with "Access denied"
**Solution**: Check RLS policies are correctly set up. Run the policy SQL from Step 2 again.

### Issue: Screenshots not appearing in Storage
**Solution**:
1. Verify bucket name matches `SUPABASE_STORAGE_BUCKET` in `.env`
2. Check user_id is correct in the upload path
3. Verify file MIME type is `image/png` or `image/jpeg`

## Next Steps

After completing this setup:
1. ✅ Database schema is ready
2. ✅ Storage bucket is configured
3. ⏭️ Implement Settings UI to let users configure app preferences
4. ⏭️ Implement VisionScheduler to capture screenshots
5. ⏭️ Implement VisionJobManager to process vision jobs
6. ⏭️ Integrate vision context into suggestion system
