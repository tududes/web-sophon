// Utility to clean up empty fields from storage

export async function cleanupEmptyFields() {
    try {
        // Get all storage data
        const allData = await chrome.storage.local.get(null);

        let cleanedCount = 0;
        const updates = {};

        // Find all field keys (fields_domain)
        for (const [key, value] of Object.entries(allData)) {
            if (key.startsWith('fields_') && Array.isArray(value)) {
                const cleanedFields = value.filter(field => {
                    // Keep only fields with both name and description
                    const hasName = field.name && field.name.trim();
                    const hasDescription = field.description && field.description.trim();

                    if (!hasName || !hasDescription) {
                        cleanedCount++;
                        console.log(`Removing empty field from ${key}:`, field);
                        return false;
                    }
                    return true;
                });

                // Only update if we removed fields
                if (cleanedFields.length !== value.length) {
                    updates[key] = cleanedFields;
                }
            }
        }

        // Apply updates if any
        if (Object.keys(updates).length > 0) {
            await chrome.storage.local.set(updates);
            console.log(`Cleaned up ${cleanedCount} empty fields from ${Object.keys(updates).length} domains`);
        } else {
            console.log('No empty fields found to clean up');
        }

        return { success: true, cleanedCount, domainsAffected: Object.keys(updates).length };
    } catch (error) {
        console.error('Error cleaning up empty fields:', error);
        return { success: false, error: error.message };
    }
}

// Run cleanup on extension update or install
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'update' || details.reason === 'install') {
        console.log('Running empty fields cleanup...');
        const result = await cleanupEmptyFields();
        console.log('Cleanup result:', result);
    }
}); 