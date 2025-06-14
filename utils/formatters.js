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
        return `<pre class="json-display formatted">${JSON.stringify(jsonData, null, 2)}</pre>`;
    } catch (e) {
        // Not valid JSON, show as raw text with better formatting
        return `
            <div class="raw-response-container">
                <div class="raw-response-note">⚠️ Raw response (not valid JSON)</div>
                <pre class="raw-response">${responseText}</pre>
            </div>
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

// Throttle function for performance
function throttle(func, limit) {
    let inThrottle;
    return function () {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

// Handle image zoom with mouse position (throttled for performance)
export const handleImageZoom = throttle(function (e) {
    const img = e.target;

    // Only apply zoom to thumbnail images in history
    if (!img.classList.contains('history-screenshot-thumbnail')) {
        return;
    }

    // Add will-change for performance if not already set
    if (!img.style.willChange) {
        img.style.willChange = 'transform';
        img.style.transition = 'transform 0.1s ease-out';
    }

    const rect = img.getBoundingClientRect();

    // Calculate mouse position relative to image (more precise)
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

    // Set transform origin to mouse position and apply high zoom for fine print reading
    img.style.transformOrigin = `${x}% ${y}%`;
    img.style.transform = 'scale(6)'; // 6x zoom for reading fine print
    img.style.zIndex = '9999';
    img.style.position = 'relative';
    img.style.borderRadius = '4px';
    img.style.boxShadow = '0 8px 32px rgba(0,0,0,0.3)';

    // Ensure container doesn't clip the zoomed image
    const container = img.closest('.screenshot-container');
    if (container) {
        container.style.overflow = 'visible';
        container.style.zIndex = '9998';
    }
}, 12); // ~80fps for smoother tracking

// Reset image zoom
export function resetImageZoom(e) {
    const img = e.target;

    img.style.transform = 'scale(1)';
    img.style.zIndex = '';
    img.style.position = '';
    img.style.transformOrigin = 'center';
    img.style.willChange = '';
    img.style.transition = '';
    img.style.borderRadius = '';
    img.style.boxShadow = '';

    // Reset container overflow
    const container = img.closest('.screenshot-container');
    if (container) {
        container.style.overflow = '';
        container.style.zIndex = '';
    }
} 