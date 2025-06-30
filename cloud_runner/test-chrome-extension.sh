#!/bin/bash

# Test script that simulates Chrome Extension requests to Cloud Runner
# Based on captured real request data

API_URL="https://runner.websophon.ai"

echo "🧪 WebSophon Chrome Extension Test Suite"
echo "======================================="

# Check if token is provided as argument
if [ -z "$1" ]; then
    echo ""
    echo "⚠️  No authentication token provided!"
    echo ""
    echo "To get a valid token:"
    echo "1. Open https://runner.websophon.ai/auth in your browser"
    echo "2. Complete the CAPTCHA"
    echo "3. Use the Chrome extension to authenticate"
    echo "4. The extension will retrieve the token"
    echo ""
    echo "OR from the Chrome extension:"
    echo "1. Click '🔐 Authenticate with Cloud Runner'"
    echo "2. Complete the CAPTCHA in the popup"
    echo "3. Check the extension console for the token"
    echo ""
    echo "Usage: $0 <token>"
    echo "Example: $0 wst_4ba9dd354f49..."
    echo ""
    exit 1
fi

TOKEN="$1"
echo "Using token: ${TOKEN:0:20}..."

# Test 1: Check token stats (like extension does after auth)
echo -e "\n📊 Test 1: Checking token stats..."
STATS_RESPONSE=$(curl -s -X GET "$API_URL/auth/token/stats" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: */*" \
  -H "Accept-Encoding: gzip, deflate, br, zstd" \
  -H "Accept-Language: en-US,en;q=0.9" \
  -H "Content-Type: application/json" \
  -H "DNT: 1" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0")

echo "$STATS_RESPONSE" | python3 -m json.tool

# Check if token is valid
if echo "$STATS_RESPONSE" | grep -q "error"; then
    echo "❌ Token appears to be invalid or expired!"
    exit 1
fi

# Test 2: Submit a minimal job (without full session data)
echo -e "\n\n📸 Test 2: Submitting a minimal job..."

MINIMAL_JOB='{
  "url": "https://example.com",
  "domain": "example.com",
  "sessionData": {
    "localStorage": {},
    "sessionStorage": {},
    "url": "https://example.com",
    "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0",
    "viewport": {
      "deviceScaleFactor": 2,
      "height": 776,
      "width": 1488
    },
    "cookies": []
  },
  "llmConfig": {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022",
    "apiKey": "test-api-key"
  },
  "fields": [
    {
      "id": "test_field",
      "name": "Test Field",
      "criteria": "Is this a test?",
      "webhookEnabled": true,
      "webhookUrl": "https://discord.com/api/webhooks/1382235389414080512/iRHjKytmkMg-lGnvQlfzxoYClkd7nLLb1IeqpFoKDLncU6jZWFC3f9CHZkWaYcFQjH9X",
      "webhookPayload": "",
      "webhookTrigger": true,
      "webhookMinConfidence": 80
    }
  ],
  "previousEvaluation": null,
  "captureSettings": {
    "refreshPageToggle": false,
    "captureDelay": "0",
    "fullPageCaptureToggle": false
  }
}'

JOB_RESPONSE=$(curl -s -X POST "$API_URL/job" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: */*" \
  -H "Accept-Encoding: gzip, deflate, br, zstd" \
  -H "Accept-Language: en-US,en;q=0.9" \
  -H "Content-Type: application/json" \
  -H "DNT: 1" \
  -H "Origin: chrome-extension://oiikgdchicbkiijccechdniphgffbpbm" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0" \
  -d "$MINIMAL_JOB")

echo "$JOB_RESPONSE" | python3 -m json.tool

# Extract job ID if successful
JOB_ID=$(echo "$JOB_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('jobId', ''))" 2>/dev/null)

if [ -n "$JOB_ID" ]; then
    echo -e "\n\n✅ Job created with ID: $JOB_ID"
    
    # Test 3: Poll job status (like extension does)
    echo -e "\n⏳ Test 3: Polling job status..."
    
    for i in {1..10}; do
        echo -n "  Attempt $i: "
        STATUS=$(curl -s -X GET "$API_URL/job/$JOB_ID" \
          -H "Authorization: Bearer $TOKEN" \
          -H "Accept: */*" \
          -H "Accept-Encoding: gzip, deflate, br, zstd" \
          -H "Accept-Language: en-US,en;q=0.9" \
          -H "Content-Type: application/json" \
          -H "DNT: 1" \
          -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0")
        
        STATE=$(echo "$STATUS" | python3 -c "import sys, json; print(json.load(sys.stdin).get('state', 'unknown'))" 2>/dev/null)
        echo "State = $STATE"
        
        if [ "$STATE" = "complete" ]; then
            echo -e "\n\n📥 Test 4: Fetching results..."
            curl -s -X GET "$API_URL/job/$JOB_ID/results" \
              -H "Authorization: Bearer $TOKEN" \
              -H "Accept: */*" \
              -H "Accept-Encoding: gzip, deflate, br, zstd" \
              -H "Accept-Language: en-US,en;q=0.9" \
              -H "Content-Type: application/json" \
              -H "DNT: 1" \
              -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0" | python3 -m json.tool
            break
        fi
        
        sleep 5
    done
else
    echo -e "\n❌ Failed to create job"
fi

echo -e "\n\n✅ Test complete!" 