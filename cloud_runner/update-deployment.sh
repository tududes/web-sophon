#!/bin/bash

# Update Cloud Runner Deployment Script
# This script pulls the latest code and restarts the cloud runner

set -e

echo "🔄 Updating WebSophon Cloud Runner Deployment"
echo "=============================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if we can access the deployment directory
DEPLOY_DIR="/root/tv-eyes"
if [ ! -d "$DEPLOY_DIR" ]; then
    DEPLOY_DIR="/home/ubuntu/tv-eyes"
    if [ ! -d "$DEPLOY_DIR" ]; then
        DEPLOY_DIR="/opt/tv-eyes"
        if [ ! -d "$DEPLOY_DIR" ]; then
            print_error "Could not find deployment directory. Please run this script on the server where tv-eyes is deployed."
            exit 1
        fi
    fi
fi

print_status "Found deployment directory: $DEPLOY_DIR"

# Change to deployment directory
cd "$DEPLOY_DIR"

# Pull latest changes
print_status "Pulling latest changes from repository..."
git pull origin main

# Change to cloud_runner directory
cd cloud_runner

# Check if docker-compose is running
if docker-compose ps | grep -q "Up"; then
    print_status "Stopping existing containers..."
    docker-compose down
fi

# Build and start with latest code
print_status "Building and starting updated containers..."
docker-compose up -d --build

# Wait a moment for containers to start
sleep 5

# Check status
if docker-compose ps | grep -q "Up"; then
    print_status "✅ Cloud runner updated successfully!"
    print_status "📊 Container status:"
    docker-compose ps
    
    print_status "📜 Recent logs:"
    docker-compose logs --tail=20
else
    print_error "❌ Failed to start containers. Check logs:"
    docker-compose logs
    exit 1
fi

echo
print_status "🎉 Deployment update complete!"
print_warning "The /jobs endpoint should now be available with proper authentication." 