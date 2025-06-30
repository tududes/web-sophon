#!/bin/bash

# WebSophon Cloud Runner Debug Test
# Run this script to test the complete flow and identify issues

echo "🔍 WebSophon Cloud Runner Debug Test"
echo "======================================="

# Test 1: Check if cloud runner is accessible
echo "Test 1: Cloud Runner Connectivity"
RUNNER_URL="https://runner.websophon.ai"
if curl -s -o /dev/null -w "%{http_code}" "$RUNNER_URL" | grep -q "200"; then
    echo "✅ Cloud runner is accessible"
else
    echo "❌ Cloud runner not accessible"
    exit 1
fi

# Test 2: Check authentication
echo -e "\nTest 2: Authentication Test"
# You would need to add your token here
echo "⚠️  Manual step: Verify you have a valid authentication token in the extension"

# Test 3: Check recent cloud runner logs
echo -e "\nTest 3: Cloud Runner Status"
ssh luminara-jitsi-donor "cd /root/web-sophon/cloud_runner && docker compose ps"

# Test 4: Check for recent job activity
echo -e "\nTest 4: Recent Job Activity"
ssh luminara-jitsi-donor "cd /root/web-sophon/cloud_runner && docker compose logs --tail=50 runner | grep -E '(Job|RESULTS|ERROR)'"

# Test 5: System health check
echo -e "\nTest 5: System Health"
ssh luminara-jitsi-donor "cd /root/web-sophon/cloud_runner && docker stats --no-stream"

echo -e "\n🎯 Debug Test Complete"
echo "If issues persist, check the extension console logs and run a manual capture while monitoring both local and remote logs." 