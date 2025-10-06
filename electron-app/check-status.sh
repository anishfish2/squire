#!/bin/bash

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 Squire Status Check"
echo "===================="
echo ""

# Check 1: Backend running
echo -n "1. Backend running... "
if curl -s http://127.0.0.1:8000/docs > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Running${NC}"
else
    echo -e "${RED}✗ NOT running${NC}"
    echo "   → Start with: cd ../squire-backend && python -m uvicorn main:app --reload"
    exit 1
fi

# Check 2: User session exists
echo -n "2. User session... "
USER_ID="550e8400-e29b-41d4-a716-446655440000"
RESPONSE=$(curl -s http://127.0.0.1:8000/api/activity/current-session/$USER_ID)
if [ -z "$RESPONSE" ] || [ "$RESPONSE" == "null" ]; then
    echo -e "${YELLOW}⚠ No active session${NC}"
    echo "   → Start Electron app to create session"
else
    echo -e "${GREEN}✓ Active${NC}"
fi

# Check 3: App preferences loaded
echo -n "3. App preferences... "
PREFS=$(curl -s http://127.0.0.1:8000/api/vision/preferences/$USER_ID)
if [ "$PREFS" == "[]" ] || [ -z "$PREFS" ]; then
    echo -e "${YELLOW}⚠ No apps configured${NC}"
    echo "   → Open Settings in Electron app and enable vision for apps"
else
    COUNT=$(echo $PREFS | grep -o "app_name" | wc -l | xargs)
    VISION_ENABLED=$(echo $PREFS | grep -o '"allow_vision":true' | wc -l | xargs)
    echo -e "${GREEN}✓ $COUNT apps, $VISION_ENABLED with vision enabled${NC}"
fi

# Check 4: Vision events in Supabase
echo ""
echo "📊 Database Status:"
echo "   → Check Supabase manually:"
echo "   SELECT COUNT(*) FROM vision_events;"
echo "   SELECT COUNT(*) FROM ai_suggestions;"
echo ""

# Check 5: Electron app running
echo -n "4. Electron app... "
if pgrep -f "electron" > /dev/null; then
    echo -e "${GREEN}✓ Running${NC}"
else
    echo -e "${YELLOW}⚠ Not running${NC}"
    echo "   → Start with: npm run dev"
fi

echo ""
echo "🎯 Next Steps:"
echo "1. If backend not running: cd ../squire-backend && python -m uvicorn main:app --reload"
echo "2. If Electron not running: npm run dev"
echo "3. Enable vision: Open Settings (Cmd+Shift+S) → Toggle 'Vision Feature' ON"
echo "4. Enable per-app: Settings → Find an app → Toggle 'Vision' ON"
echo "5. Test: Switch between apps and wait 10 seconds"
echo ""
echo "📖 Full guide: See DEBUGGING_EMPTY_DATA.md"
