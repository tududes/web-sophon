# WebSophon Interaction Guide

## History Event Interactions

### Expanding/Collapsing Events
- **Click anywhere** on the event header, status, or fields to expand/collapse
- Look for the **▶** indicator that shows expand/collapse state
- The following areas are **interactive** and won't collapse the event when clicked:
  - Screenshots (click to zoom)
  - Request/Response data sections
  - Any text that can be selected/copied

### Screenshot Interactions
- **Download** screenshots using the 💾 Download button above each image
- **Hover** over screenshots to zoom in 2x with mouse-following magnification
- **Move mouse** around while hovering to explore all areas of the zoomed image
- Screenshots won't collapse the parent event when interacted with
- Filenames include timestamp: `websophon-screenshot-YYYY-MM-DD-HH-MM-SS.png`

### Request/Response Debugging
- **Click the section headers** to expand/collapse request or response data
- **Section headers** have a colored background that changes on hover
- **JSON responses** are automatically formatted with proper indentation
- **Non-JSON responses** show as raw text with a warning indicator
- **All text is selectable** for easy copying to clipboard
- These sections are independent - won't affect the parent event state

### Request Cancellation
- **Pending requests** show a red "Cancel Request" button
- **Click Cancel** to abort webhook requests that are taking too long
- **Cancelled requests** are marked in history as "Request cancelled by user"
- **Multiple pending requests** can be cancelled independently

### Field Last Results
- Each field shows its **last evaluation** with time ago (e.g., "Last: TRUE 5 minutes ago")
- **Color-coded**: Green for TRUE, Red for FALSE
- **Click to jump** directly to that event in history
- Automatically handles filtering and scrolling
- The target event will **pulse** to draw attention

### Visual Indicators
- **Cursor changes** show what's clickable:
  - Pointer cursor for expand/collapse areas
  - Zoom cursor for screenshots
  - Text cursor for selectable content
- **Hover effects** on all interactive elements
- **Smooth transitions** for better user experience

## Pending Request Handling

### Long-Running Webhooks
- Events appear immediately with **"⏳ Waiting for response..."** status
- Screenshot and request data are available right away
- Response section shows pending indicator
- Events automatically update when response arrives
- Multiple requests can run concurrently

### Visual Indicators for Pending Events
- **Pulsing blue status**: Shows active webhook processing
- **Blue pending section**: Highlights where response will appear
- **Auto-refresh**: No need to reload - updates appear automatically
- **5-minute timeout**: Requests can run up to 300 seconds

## Tips for Effective Debugging

1. **Start from Fields**: Click a field's last result to quickly find its event
2. **Monitor Pending**: Watch for events updating in real-time
3. **Download Screenshots**: Save images locally for detailed analysis
4. **Zoom and Explore**: Hover over screenshots and move mouse to examine all areas
5. **Check Request Data**: Confirm the correct fields were sent
6. **Review Response**: JSON formatted nicely, raw text shown for errors
7. **Cancel if Needed**: Don't wait for slow webhooks - cancel and retry
8. **Compare Events**: Keep multiple events expanded to compare results

## Keyboard Shortcuts (Future Feature)
- `Esc` - Collapse all expanded events
- `Ctrl/Cmd + F` - Focus search in history
- `Space` - Toggle expand/collapse on selected event 