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

// Open screenshot in new tab
export function openScreenshotInNewTab(screenshotData) {
    try {
        // Create a new tab with the image
        const newTab = window.open();
        if (newTab) {
            // Set page title
            newTab.document.title = 'WebSophon Screenshot';

            // Style the page for better viewing
            newTab.document.body.style.margin = '0';
            newTab.document.body.style.padding = '0';
            newTab.document.body.style.backgroundColor = '#1a1a1a';
            newTab.document.body.style.display = 'flex';
            newTab.document.body.style.justifyContent = 'center';
            newTab.document.body.style.alignItems = 'center';
            newTab.document.body.style.minHeight = '100vh';

            // Create and add the image
            const img = newTab.document.createElement('img');
            img.src = screenshotData;
            img.style.maxWidth = '100%';
            img.style.maxHeight = '100vh';
            img.style.objectFit = 'contain';
            img.style.cursor = 'zoom-in';

            // Add click to toggle zoom
            let zoomed = false;
            img.addEventListener('click', () => {
                if (zoomed) {
                    img.style.maxWidth = '100%';
                    img.style.maxHeight = '100vh';
                    img.style.cursor = 'zoom-in';
                } else {
                    img.style.maxWidth = 'none';
                    img.style.maxHeight = 'none';
                    img.style.cursor = 'zoom-out';
                }
                zoomed = !zoomed;
            });

            newTab.document.body.appendChild(img);
        } else {
            console.error('Failed to open new tab - popup may be blocked');
            return { success: false, message: 'Failed to open new tab - check popup blocker' };
        }

        return { success: true, message: 'Screenshot opened in new tab' };
    } catch (error) {
        console.error('Error opening screenshot:', error);
        return { success: false, message: 'Failed to open screenshot' };
    }
} 