#!/bin/bash

# Test script to verify token persistence and validation
API_URL="https://runner.websophon.ai"

echo "🔍 WebSophon Token Persistence Test"
echo "==================================="

# Test with the current token from logs
TOKEN="wst_99c1fb48e24e99b4e9d7f6c2b8a1e5f3d9c6b2a8e4f1d7c3b9a5e2f8d4c1b7a3e6"

echo -e "\n📊 Test 1: Check token stats..."
STATS_RESPONSE=$(curl -s -X GET "$API_URL/auth/token/stats" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json")

echo "Response: $STATS_RESPONSE"

if echo "$STATS_RESPONSE" | grep -q "expiresAt"; then
    echo "✅ Token is valid and active"
    
    # Extract expiry time
    EXPIRES_AT=$(echo "$STATS_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('expiresAt', 'unknown'))" 2>/dev/null)
    if [ "$EXPIRES_AT" != "unknown" ]; then
        EXPIRES_DATE=$(python3 -c "import datetime; print(datetime.datetime.fromtimestamp($EXPIRES_AT/1000).strftime('%Y-%m-%d %H:%M:%S'))" 2>/dev/null)
        echo "📅 Token expires: $EXPIRES_DATE"
        
        # Check time remaining
        NOW=$(date +%s)
        TIME_REMAINING=$(( ($EXPIRES_AT / 1000) - $NOW ))
        HOURS_REMAINING=$(( $TIME_REMAINING / 3600 ))
        echo "⏰ Time remaining: $HOURS_REMAINING hours"
    fi
else
    echo "❌ Token validation failed"
    echo "Response details: $STATS_RESPONSE"
fi

echo -e "\n🧪 Test 2: Test cloud runner connectivity..."
TEST_RESPONSE=$(curl -s -X POST "$API_URL/test" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"test": "connectivity"}')

echo "Test response: $TEST_RESPONSE"

if echo "$TEST_RESPONSE" | grep -q "success.*true"; then
    echo "✅ Cloud runner connectivity test passed"
else
    echo "❌ Cloud runner connectivity test failed"
fi

echo -e "\n📋 Summary:"
echo "- Token format: ${TOKEN:0:20}..."
echo "- Server URL: $API_URL"
echo "- Test completed at: $(date)" 