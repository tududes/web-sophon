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
    console.log('=== FORMAT RESPONSE DATA ===');
    console.log('Input responseText:', responseText);
    console.log('Type:', typeof responseText);
    console.log('Length:', responseText ? responseText.length : 0);
    console.log('Is SAPIENT?', responseText && responseText.includes('::SAPIENT v:') ? 'YES' : 'NO');
    console.log('===========================');

    if (!responseText) return '<div class="no-response">No response data</div>';

    // Check if this is a SAPIENT protocol response
    if (responseText.includes('::SAPIENT v:') && responseText.includes('::END:SAPIENT::')) {
        // Display SAPIENT response as-is without warning
        console.log('Detected SAPIENT format, displaying as SAPIENT');
        return `
            <div class="raw-response-container">
                <div class="raw-response-note">📝 SAPIENT Protocol Response</div>
                <pre class="raw-response">${responseText}</pre>
            </div>
        `;
    }

    try {
        // Try to parse as JSON
        const jsonData = JSON.parse(responseText);
        return `<pre class="json-display formatted">${JSON.stringify(jsonData, null, 2)}</pre>`;
    } catch (e) {
        // Not valid JSON, show as raw text with warning
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

        // Detect image format from data URL
        let extension = 'png'; // default
        if (screenshotData.includes('data:image/jpeg')) {
            extension = 'jpg';
        } else if (screenshotData.includes('data:image/png')) {
            extension = 'png';
        } else if (screenshotData.includes('data:image/webp')) {
            extension = 'webp';
        }

        // Create filename with timestamp and correct extension
        const date = new Date(timestamp);
        const filename = `websophon-screenshot-${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}-${date.getHours().toString().padStart(2, '0')}-${date.getMinutes().toString().padStart(2, '0')}-${date.getSeconds().toString().padStart(2, '0')}.${extension}`;

        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        return { success: true, message: `Screenshot downloaded as ${extension.toUpperCase()}` };
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
        img.style.transition = 'none'; // Remove transition for instant following
    }

    const rect = img.getBoundingClientRect();
    const container = img.closest('.screenshot-container');

    // Calculate mouse position relative to the thumbnail image bounds
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Map mouse position to percentage coordinates on the original image
    // This creates a 1:1 mapping between mouse position on thumbnail and zoom area
    // Mouse at 0% across thumbnail = show 0% area of original image
    // Mouse at 100% across thumbnail = show 100% area of original image
    const x = (mouseX / rect.width) * 100;
    const y = (mouseY / rect.height) * 100;

    // Debug logging to see what's happening
    console.log('Zoom debug:', {
        clientX: e.clientX.toFixed(1),
        clientY: e.clientY.toFixed(1),
        rectLeft: rect.left.toFixed(1),
        rectTop: rect.top.toFixed(1),
        mouseX: mouseX.toFixed(1),
        mouseY: mouseY.toFixed(1),
        rectWidth: rect.width.toFixed(1),
        rectHeight: rect.height.toFixed(1),
        x: x.toFixed(1),
        y: y.toFixed(1),
        transformOrigin: `${x.toFixed(1)}% ${y.toFixed(1)}%`
    });

    // Adaptive zoom factor based on image format
    // JPEG compressed images benefit from higher zoom for better detail visibility
    const isJPEG = img.src.includes('data:image/jpeg');
    const zoomFactor = isJPEG ? 4.0 : 3.5; // Higher zoom for compressed images

    // Set transform origin to exact mouse position on the image
    // This creates a "magnifying glass" effect that follows the mouse
    img.style.transformOrigin = `${x}% ${y}%`;
    img.style.transform = `scale(${zoomFactor})`;
    img.style.zIndex = '9999';
    img.style.position = 'relative';
    img.style.borderRadius = '4px';
    img.style.boxShadow = '0 12px 48px rgba(0,0,0,0.4)';

    // Optimize rendering for different image formats
    if (isJPEG) {
        // For JPEG: Use automatic rendering with slight sharpening
        img.style.imageRendering = 'auto';
        img.style.filter = 'contrast(1.05) saturate(1.02)'; // Subtle enhancement for compressed images
    } else {
        // For PNG: Use crisp edges for pixel-perfect rendering
        img.style.imageRendering = 'crisp-edges';
    }
    img.style.backfaceVisibility = 'hidden';

    // Ensure container doesn't clip the zoomed image
    if (container) {
        container.style.overflow = 'visible';
        container.style.zIndex = '9998';
        container.style.position = 'relative';
        // Temporarily remove max-height constraint during zoom
        container.dataset.originalMaxHeight = container.style.maxHeight || '';
        container.style.maxHeight = 'none';
    }
}, 8); // Higher frequency for real-time panning feel

// Reset image zoom
export function resetImageZoom(e) {
    const img = e.target;

    console.log('Resetting zoom for image');

    img.style.transform = 'scale(1)';
    img.style.zIndex = '';
    img.style.position = '';
    img.style.transformOrigin = 'center';
    img.style.willChange = '';
    img.style.transition = '';
    img.style.borderRadius = '';
    img.style.boxShadow = '';
    img.style.imageRendering = '';
    img.style.backfaceVisibility = '';
    img.style.filter = ''; // Clear any zoom enhancement filters

    // Reset container overflow
    const container = img.closest('.screenshot-container');
    if (container) {
        container.style.overflow = '';
        container.style.zIndex = '';
        container.style.position = '';
        // Restore original max-height
        if (container.dataset.originalMaxHeight !== undefined) {
            container.style.maxHeight = container.dataset.originalMaxHeight;
            delete container.dataset.originalMaxHeight;
        }
    }
} 