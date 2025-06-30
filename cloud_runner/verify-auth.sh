#!/bin/bash

# Cloud Runner Authentication Verification Script
# This script tests that all endpoints properly require authentication tokens

set -e

# Configuration
CLOUD_RUNNER_URL="${1:-https://runner.websophon.tududes.com}"

echo "🔐 Verifying Cloud Runner Authentication"
echo "========================================"
echo "Testing URL: $CLOUD_RUNNER_URL"
echo

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_pass() {
    echo -e "${GREEN}✅ PASS: $1${NC}"
}

print_fail() {
    echo -e "${RED}❌ FAIL: $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ️  INFO: $1${NC}"
}

# Test function
test_endpoint() {
    local endpoint="$1"
    local expected_status="$2"
    local description="$3"
    
    print_info "Testing $endpoint"
    
    # Test without authentication token
    response=$(curl -s -w "%{http_code}" -o /dev/null "$CLOUD_RUNNER_URL$endpoint" || echo "000")
    
    if [ "$response" = "$expected_status" ]; then
        print_pass "$description - returned $response as expected"
        return 0
    else
        print_fail "$description - returned $response, expected $expected_status"
        return 1
    fi
}

echo "🚫 Testing endpoints WITHOUT authentication token (should all be rejected):"
echo "-----------------------------------------------------------------------"

# Test protected endpoints without auth token - should all return 401
test_endpoint "/jobs" "401" "GET /jobs without token"
test_endpoint "/job" "401" "POST /job without token"
test_endpoint "/test" "401" "POST /test without token"
test_endpoint "/auth/token/stats" "401" "GET /auth/token/stats without token"

echo
echo "🔓 Testing public endpoints (should work without token):"
echo "-------------------------------------------------------"

# Test public endpoints - should work
test_endpoint "/" "200" "GET / (public endpoint)"
test_endpoint "/captcha/challenge" "200" "GET /captcha/challenge (public endpoint)"

echo
echo "🔐 Testing invalid endpoints (should be blocked):"
echo "------------------------------------------------"

# Test invalid endpoints - should return 404
test_endpoint "/invalid" "404" "GET /invalid (should be blocked)"
test_endpoint "/admin" "404" "GET /admin (should be blocked)"
test_endpoint "/config" "404" "GET /config (should be blocked)"

echo
echo "📋 Summary:"
echo "----------"
print_info "All protected endpoints should return 401 (Unauthorized) without a valid token"
print_info "All public endpoints should return 200 (OK)"
print_info "All invalid endpoints should return 404 (Not Found)"
print_info ""
print_info "If any tests failed, the authentication system needs to be fixed!"

echo
echo "💡 To get a valid token for testing authenticated endpoints:"
echo "   1. Complete the CAPTCHA challenge at $CLOUD_RUNNER_URL/auth"
echo "   2. Use the token in Authorization: Bearer <token> header"
echo "   3. Test with: curl -H 'Authorization: Bearer <token>' $CLOUD_RUNNER_URL/jobs" 