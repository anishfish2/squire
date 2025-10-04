# Vision + OCR Context Integration

## Overview

The Vision feature is now **fully integrated** with the OCR-based suggestion system. The LLM now receives **both** textual context (OCR) and visual context (Vision AI) to provide richer, more contextually aware productivity suggestions.

---

## How It Works

### Before (OCR Only)

```
User switches app
  ↓
OCR extracts text from screen
  ↓
Text sent to LLM for suggestions
```

**Limitations**:
- Only sees text content
- Misses visual UI elements (buttons, layouts, images)
- Cannot understand visual context (charts, diagrams, design work)

### After (OCR + Vision)

```
User switches app
  ↓
OCR extracts text from screen
+ Vision AI analyzes screenshot
  ↓
BOTH contexts merged and sent to LLM
  ↓
Enhanced suggestions based on text + visual context
```

**Benefits**:
- Understands both text AND visual UI elements
- Can identify workflows from visual patterns
- Better context for design tools, dashboards, complex UIs
- More accurate task identification

---

## What the LLM Now Receives

### 1. **OCR Context** (Existing)
- Extracted text from screen
- Meaningful context summaries
- Application type
- Interaction context
- Extracted entities

### 2. **Vision Context** (NEW ✨)
From recent screenshots (last 3):
- **Task**: What the user is working on
- **UI Elements**: Visible buttons, menus, panels, etc.
- **Context**: Rich description of visual scene
- **Patterns**: Observed workflows and behaviors
- **Insights**: AI-generated productivity insights

### 3. **User History** (Existing)
- Historical patterns
- Skills and tools
- Common workflows
- Recent suggestions (to avoid duplicates)

---

## Example LLM Prompt Enhancement

### Before:
```
WORKFLOW SEQUENCE ANALYSIS:
App: Google Chrome - Documentation Page
Context: FastAPI documentation, code snippets visible
```

### After (with Vision):
```
WORKFLOW SEQUENCE ANALYSIS:
App: Google Chrome - Documentation Page
Context: FastAPI documentation, code snippets visible

🔮 VISION INSIGHTS (Visual Context from Screenshots):

1. Google Chrome:
   • Task: Reviewing FastAPI endpoint documentation and comparing with implementation
   • UI Elements: Browser window, Documentation page, Code snippets, Navigation sidebar, Search bar
   • Context: User is reading API documentation for vision endpoint implementation,
             multiple tabs open including GitHub and localhost
   • Patterns: Switching between documentation and code editor, copy-pasting code examples
   • Insights: User is in learning/research mode, actively implementing new features.
             May benefit from code snippet suggestions and example templates.
```

---

## Implementation Details

### Backend Changes

**File**: `squire-backend/app/routers/ai.py`

#### 1. New Function: `get_vision_context()`

```python
async def get_vision_context(user_id: str, app_name: Optional[str] = None, limit: int = 3) -> str:
    """
    Fetch recent vision insights for a user.
    Returns formatted vision context string for LLM prompt.
    """
    # Get recent vision events
    vision_events = await vision_job_manager.get_recent_vision_events(
        user_id=user_id,
        limit=limit,
        app_name=app_name
    )

    # Format vision insights for LLM prompt
    # Includes: task, UI elements, context, patterns, insights
```

#### 2. Updated: `build_batch_openai_prompt()`

**Changes**:
1. Fetches vision context for current app
2. Injects vision context into LLM prompt (between sequence and history)
3. Updates analysis instructions to emphasize vision insights

```python
# Fetch and add vision context for the current app
vision_context = ""
if request.app_sequence and request.user_id:
    latest_app = request.app_sequence[-1]
    vision_context = await get_vision_context(
        user_id=request.user_id,
        app_name=latest_app.appName,
        limit=3
    )

# Build comprehensive prompt with all context
prompt = f"""
{sequence_context}
{vision_context}  ← NEW!
{history_context}
"""
```

---

## Enhanced Analysis Instructions

The LLM now receives updated instructions:

```
ANALYSIS INSTRUCTIONS:
Analyze this complete workflow sequence using ALL available context:
1. Screen content from each app in the sequence (OCR text)
2. **Vision insights** from screenshots (UI elements, visual context, patterns)
3. User's historical patterns and preferences
4. Keystroke patterns and tool usage
5. Knowledge graph insights about user expertise
6. The progression and timing of app transitions
7. Multi-level context analysis of current state

Provide 1-3 highly intelligent suggestions that:
- **Consider both text content (OCR) and visual context (Vision insights)**
- Take into account the visual UI elements and patterns detected in screenshots
- Address the specific workflow sequence context
- Leverage the user's known expertise and patterns
```

---

## Use Cases

### 1. **Design Tools (Figma, Sketch)**

**OCR Only**:
- Sees layer names, text labels
- Limited understanding of visual design

**OCR + Vision**:
- Sees layer names + visual layout
- Understands design patterns (buttons, spacing, colors)
- Can suggest: "Your button spacing is inconsistent - try using 8px grid"

### 2. **Data Dashboards (Tableau, Grafana)**

**OCR Only**:
- Sees metric labels and numbers
- Misses chart types and trends

**OCR + Vision**:
- Sees labels + chart visuals
- Identifies: "Line chart showing upward trend in API latency"
- Can suggest: "API latency increasing 15% - investigate database queries"

### 3. **Code Editors (VSCode, IntelliJ)**

**OCR Only**:
- Sees code text
- Basic syntax understanding

**OCR + Vision**:
- Sees code + file structure + open tabs
- Identifies: "Working on auth.py, test_auth.py tab open but empty"
- Can suggest: "Write unit tests for the new authenticate() function"

### 4. **Browser Research**

**OCR Only**:
- Sees article text
- Limited context

**OCR + Vision**:
- Sees text + images + layout
- Identifies: "Reading tutorial with code examples, 3 tabs open"
- Can suggest: "Create a code snippet file with examples from all 3 tabs"

---

## Performance Considerations

### Vision Context Fetching

- **Query**: Last 3 vision events for current app
- **Indexed**: `idx_vision_events_user_app` (user_id, app_name, created_at)
- **Fast lookup**: ~5-10ms

### LLM Token Usage

- **Vision context adds**: ~200-400 tokens per event (x3 = 600-1200 tokens)
- **Total prompt size**: ~3000-5000 tokens (vs 2000-3000 before)
- **Impact**: Minimal (~$0.001-0.002 extra per suggestion)

### Vision API Costs

- **Claude 3.5 Sonnet**: $0.008-0.024/image
- **Frequency**: 30-60s per app (if vision enabled)
- **Daily usage (8 hrs, 1 app)**: ~$4-14/day

---

## Testing the Integration

### 1. **Enable Vision for an App**

```bash
# Open Squire app
open dist/mac-arm64/Squire.app

# Open Settings (Cmd+,)
# Enable "Vision" for Chrome (or your test app)
```

### 2. **Generate Vision Data**

```bash
# Switch to Chrome
# Wait 30-60 seconds for vision capture
# Check backend logs:

📸 Capturing screenshot for Chrome...
✅ Screenshot captured
🔮 Processing vision job abc-123
✅ Claude Vision analysis complete
```

### 3. **Trigger Suggestions**

```bash
# Switch between apps (Chrome → VSCode → Terminal)
# AI suggestions window should appear

# Check backend logs for vision context fetch:
🔮 Fetching vision context for user <uuid>, app: Chrome
✅ Vision context built: 3 events
```

### 4. **Verify in Database**

```sql
-- Check vision events
SELECT
  app_name,
  vision_analysis->>'task' as task,
  vision_analysis->>'insights' as insights,
  created_at
FROM vision_events
WHERE user_id = '<your-user-id>'
ORDER BY created_at DESC
LIMIT 5;
```

---

## Troubleshooting

### No Vision Context in Suggestions

**Check**:
1. Vision enabled for the app? (Settings → app → Vision toggle)
2. Vision events exist? (Query `vision_events` table)
3. Vision status = 'completed'? (Not 'failed' or 'pending')
4. Backend logs show vision fetch? (`🔮 Fetching vision context`)

**Fix**:
```sql
-- Check vision events status
SELECT status, COUNT(*)
FROM vision_events
WHERE user_id = '<uuid>'
GROUP BY status;

-- If all 'failed', check Vision API keys
-- If all 'pending', vision processing may be stuck
```

### Vision Context Not Relevant

**Issue**: Vision insights don't match current task

**Cause**: Stale vision events (from previous session)

**Fix**: Vision events are app-specific and time-ordered. The `get_vision_context()` function fetches the 3 most recent events for the **current app**. If you switched tasks within the same app, older vision events may still be included.

**Solution**: Reduce `limit` from 3 to 1 for only the latest vision insight.

---

## Future Enhancements

### 1. **Vision Caching**
- Cache vision analysis for similar screenshots
- Reduce API calls for repetitive screens
- Save ~30-50% on vision costs

### 2. **Vision History UI**
- View past vision events in Settings
- See what Squire "saw" on your screen
- Delete sensitive vision data

### 3. **Multi-App Vision Context**
- Include vision from multiple recent apps
- Better understanding of cross-app workflows
- E.g., "Copying design from Figma to implement in VSCode"

### 4. **Vision-Specific Suggestions**
- Suggestions based purely on visual patterns
- E.g., "Detected repetitive UI pattern - create a component"
- UI/UX optimization suggestions

---

## Files Modified

### Backend
- `squire-backend/app/routers/ai.py`:
  - Added `get_vision_context()` function
  - Updated `build_batch_openai_prompt()` to fetch and inject vision context
  - Enhanced analysis instructions for LLM

---

## Summary

✅ **Vision context is now merged with OCR context**

✅ **LLM receives both text and visual insights**

✅ **Suggestions are richer and more contextually aware**

✅ **Works seamlessly with existing OCR pipeline**

The vision integration is **opt-in** per app, so users can choose which apps benefit from visual analysis based on their needs and cost considerations.
