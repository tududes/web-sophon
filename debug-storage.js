// WebSophon Debug Storage Inspector
// Run this in Chrome DevTools console to inspect extension storage

async function inspectWebSophonStorage() {
    console.log('🔍 WebSophon Storage Inspector');
    console.log('================================');

    try {
        // Get sync storage
        const syncData = await chrome.storage.sync.get(null);
        console.log('📦 Chrome Sync Storage:', syncData);

        // Get local storage  
        const localData = await chrome.storage.local.get(null);
        console.log('💾 Chrome Local Storage:', localData);

        // Check for recent events
        if (localData.recentEvents) {
            console.log(`📋 Recent Events Count: ${localData.recentEvents.length}`);
            localData.recentEvents.forEach((event, index) => {
                console.log(`Event ${index + 1}:`, {
                    id: event.id,
                    timestamp: event.timestamp,
                    domain: event.domain,
                    status: event.status,
                    success: event.success,
                    httpStatus: event.httpStatus,
                    fieldsCount: event.fields?.length || 0,
                    hasScreenshot: !!event.screenshot,
                    hasRequest: !!event.request,
                    hasResponse: !!event.response
                });
            });
        } else {
            console.log('❌ No recent events found');
        }

        // Check for domain-specific fields
        const fieldKeys = Object.keys(syncData).filter(key => key.startsWith('fields_'));
        if (fieldKeys.length > 0) {
            console.log('🏷️  Domain-specific fields:');
            fieldKeys.forEach(key => {
                const domain = key.replace('fields_', '');
                const fields = syncData[key];
                console.log(`  ${domain}: ${fields.length} fields`);
                fields.forEach((field, index) => {
                    console.log(`    Field ${index + 1}: ${field.friendlyName || field.name}`);
                });
            });
        } else {
            console.log('❌ No domain-specific fields found');
        }

        // Storage size estimate
        const syncSize = JSON.stringify(syncData).length;
        const localSize = JSON.stringify(localData).length;
        console.log(`📊 Storage Sizes (approximate):`);
        console.log(`  Sync: ${(syncSize / 1024).toFixed(2)} KB`);
        console.log(`  Local: ${(localSize / 1024).toFixed(2)} KB`);

    } catch (error) {
        console.error('❌ Error inspecting storage:', error);
    }
}

// Clear all WebSophon storage (use with caution!)
async function clearWebSophonStorage() {
    if (!confirm('⚠️ This will delete ALL WebSophon data. Are you sure?')) {
        return;
    }

    try {
        await chrome.storage.sync.clear();
        await chrome.storage.local.clear();
        console.log('✅ All WebSophon storage cleared');
    } catch (error) {
        console.error('❌ Error clearing storage:', error);
    }
}

// Enable debug mode
function enableDebugMode() {
    localStorage.setItem('websophon-debug', 'true');
    console.log('🔧 Debug mode enabled. Reload the extension popup to see debug features.');
}

// Disable debug mode
function disableDebugMode() {
    localStorage.removeItem('websophon-debug');
    console.log('🔧 Debug mode disabled. Reload the extension popup.');
}

// Export functions to global scope
window.inspectWebSophonStorage = inspectWebSophonStorage;
window.clearWebSophonStorage = clearWebSophonStorage;
window.enableDebugMode = enableDebugMode;
window.disableDebugMode = disableDebugMode;

console.log('🛠️ WebSophon Debug Tools Loaded');
console.log('Available functions:');
console.log('  inspectWebSophonStorage() - View all storage data');
console.log('  clearWebSophonStorage() - Clear all data (careful!)');
console.log('  enableDebugMode() - Show debug features in popup');
console.log('  disableDebugMode() - Hide debug features'); 