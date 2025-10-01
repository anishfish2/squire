# Knowledge Graph Triggers - Complete Flow

## 🎯 Single Trigger: Every OCR Capture

**The knowledge graph is updated on EVERY successful OCR job completion.**

---

## 📊 Complete Flow Diagram

```
User Activity
    ↓
Screenshot Captured (Electron: ocr-manager.js)
    ↓
POST /api/ai/ocr/queue/context (ai.py:1595)
    ↓
Job Created in ocr_events table
    ↓
OCR Worker picks up job (ocr_job_manager.py:139)
    ↓
_process_job() runs (line 165)
    ↓
PaddleOCR extracts text (line 180)
    ↓
LLM extracts meaningful_context (line 186)
    ↓
LLM extracts session_context (line 202)
    ↓
_post_process_job() runs (line 299)
    ↓
┌─────────────────────────────────────┐
│ _update_knowledge_graph() (line 305) │ ← YOU ARE HERE
└─────────────────────────────────────┘
    ↓
LLM analyzes context (line 419)
    ↓
Extracts insights: habits, skills, goals, workflows, preferences, patterns
    ↓
Creates knowledge nodes (line 473)
    ↓
Creates relationships between nodes (line 505)
    ↓
✅ Knowledge graph updated!
```

---

## 🔍 What Triggers OCR Capture?

### **From Electron App (`ocr-manager.js:197-313`)**

OCR is triggered by:

1. **App Switch** (every time you switch apps)
   ```javascript
   triggerReason: 'app_switch'
   ```

2. **Significant Content Change** (when screen content changes > 20%)
   ```javascript
   triggerReason: 'content_change'
   ```

3. **Time-based** (every 30 seconds if no other triggers)
   ```javascript
   triggerReason: 'time_based'
   ```

4. **Activity Resume** (after being idle)
   ```javascript
   triggerReason: 'activity_resumed'
   ```

---

## 📝 What Gets Extracted?

### **Step 1: OCR Text Extraction**
- Raw text lines from screen
- Stored in `ocr_events.ocr_text`

### **Step 2: Meaningful Context (LLM Call #1)**
From `ai.py:152-186`:
```python
"Summarize what the user is doing based on this screen content"
```
**Result:** Human-readable summary like:
- "Debugging React useState hook in App.jsx"
- "Reading TypeScript documentation about generics"
- "Writing Python unit tests for authentication"

### **Step 3: Session Context (LLM Call #2)**
From `ai.py:189-234`:
```python
"What type of work is this? What domain?"
```
**Result:** Classification like:
```json
{
  "context_type": "debugging",
  "domain": "web_development",
  "activity_summary": "Fixing useState error in React component"
}
```

### **Step 4: Knowledge Extraction (LLM Call #3)**
From `ocr_job_manager.py:374-416`:
```python
"Extract knowledge graph insights about work patterns, habits, and expertise"
```
**Result:** Structured insights like:
```json
{
  "habits": [
    {"description": "Uses console.log for debugging", "confidence": 0.8}
  ],
  "skills": [
    {"description": "Proficient with React hooks", "proficiency": "advanced", "confidence": 0.7}
  ],
  "goals": [
    {"description": "Building authentication system", "timeframe": "short", "confidence": 0.6}
  ],
  "workflows": [
    {"description": "Tests code in browser console before implementing", "confidence": 0.8}
  ],
  "preferences": [
    {"description": "Uses VS Code dark theme", "confidence": 0.9}
  ],
  "patterns": [
    {"description": "Debugs by adding print/log statements", "confidence": 0.7}
  ]
}
```

---

## 🎛️ Filtering & Conditions

### **Knowledge Nodes Are Created When:**

1. ✅ OCR text is captured
2. ✅ Meaningful context is successfully extracted (not empty)
3. ✅ LLM returns valid insights JSON
4. ✅ Confidence score > 0.6 (line 454)
5. ✅ Max 2 items per category (line 452: `items[:2]`)

### **Knowledge Nodes Are NOT Created When:**

1. ❌ No OCR text captured
2. ❌ No meaningful context extracted
3. ❌ LLM fails to respond or returns invalid JSON
4. ❌ Confidence score ≤ 0.6
5. ❌ No insights found (empty arrays)

---

## ⏱️ Frequency

### **Typical Usage:**
- **App switches:** ~5-10 times per hour → 5-10 OCR captures
- **Content changes:** ~10-20 times per hour → 10-20 OCR captures
- **Time-based:** ~2 times per hour → 2 OCR captures

**Total:** ~15-30 OCR captures per hour

### **Knowledge Node Creation:**
- Not every OCR creates nodes (depends on content)
- Estimate: ~5-15 new/updated nodes per hour during active work
- Duplicate nodes are merged (upsert_knowledge_node handles this)

---

## 🔄 Node Lifecycle

### **New Node Created:**
```sql
INSERT INTO knowledge_nodes (
    user_id,
    node_type: "skill",
    content: {"description": "Uses React hooks", "proficiency": "advanced"},
    weight: 0.7
)
```

### **Existing Node Updated (Upsert Logic):**
From `supabase/migrations/005_create_knowledge_nodes.sql:44-103`:
- If similar node exists (MD5 hash match):
  - Weight increases: `weight + (new_weight * 0.1)` capped at 10.0
  - Access count increments
  - Source events appended
- If no match:
  - New node created

### **Example Weight Evolution:**
```
Day 1: "Uses React hooks" → weight: 0.7
Day 2: Same observed → weight: 0.77 (0.7 + 0.7*0.1)
Day 3: Same observed → weight: 0.847
Week 1: Same observed 10+ times → weight: ~1.5
Month 1: Weight approaches ~3.0 (established pattern)
```

---

## 🔗 Relationship Creation

### **Relationships Are Created When:**
- Multiple nodes created in same OCR batch
- Node types match relationship rules:
  - `skill` → `tool` (relationship: "uses")
  - `goal` → `skill` (relationship: "requires")
  - `workflow` → `tool` (relationship: "uses")
  - `habit` → `workflow` (relationship: "follows")
  - `pattern` → `skill` (relationship: "demonstrates")

### **Example:**
```
OCR captures screen showing:
"Writing React component in VS Code"

Creates:
1. Node: skill - "Proficient with React"
2. Node: tool - "Uses VS Code"

Relationship:
skill(React) -[uses]-> tool(VS Code)
```

---

## 🎯 Summary

**Trigger:** Every OCR capture (15-30 times/hour)

**Process:**
1. Capture screen
2. Extract text
3. Generate meaningful context
4. Extract knowledge insights
5. Create/update nodes (if insights found)
6. Create relationships (if multiple nodes)

**Result:** Knowledge graph continuously learns about:
- What you work on (skills, tools)
- How you work (habits, workflows, patterns)
- What you're trying to achieve (goals)
- What you prefer (preferences)

**The graph gets smarter over time as patterns reinforce and weights increase!**
