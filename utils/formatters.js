// Utility functions for formatting data

// Get human-readable time ago
export function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    const intervals = {
        year: 31536000,
        month: 2592000,
        week: 604800,
        day: 86400,
        hour: 3600,
        minute: 60
    };

    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInUnit);
        if (interval >= 1) {
            return interval === 1 ? `1 ${unit} ago` : `${interval} ${unit}s ago`;
        }
    }

    return 'just now';
}

// Format response data for display
export function formatResponseData(responseText) {
    if (!responseText) return '<div class="no-response">No response data</div>';

    try {
        // Try to parse as JSON
        const jsonData = JSON.parse(responseText);
        return `<pre class="json-display">${JSON.stringify(jsonData, null, 2)}</pre>`;
    } catch (e) {
        // Not valid JSON, show as raw text
        return `
            <div class="raw-response-note">⚠️ Raw response (not valid JSON):</div>
            <pre class="raw-response">${responseText}</pre>
        `;
    }
}

// Download screenshot with timestamped filename
export function downloadScreenshot(screenshotData, timestamp) {
    try {
        // Create download link
        const link = document.createElement('a');
        link.href = screenshotData;

        // Create filename with timestamp
        const date = new Date(timestamp);
        const filename = `websophon-screenshot-${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}-${date.getHours().toString().padStart(2, '0')}-${date.getMinutes().toString().padStart(2, '0')}-${date.getSeconds().toString().padStart(2, '0')}.png`;

        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        return { success: true, message: 'Screenshot downloaded' };
    } catch (error) {
        console.error('Error downloading screenshot:', error);
        return { success: false, message: 'Failed to download screenshot' };
    }
}

// Handle image zoom with mouse position
export function handleImageZoom(e) {
    const img = e.target;
    const rect = img.getBoundingClientRect();

    // Calculate mouse position relative to image
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    // Set transform origin to mouse position
    img.style.transformOrigin = `${x}% ${y}%`;
    img.style.transform = 'scale(2)';
    img.style.zIndex = '1000';
    img.style.position = 'relative';
}

// Reset image zoom
export function resetImageZoom(e) {
    const img = e.target;
    img.style.transform = 'scale(1)';
    img.style.zIndex = '';
    img.style.position = '';
    img.style.transformOrigin = 'center';
} 