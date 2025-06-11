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
- **Hover** over screenshots to see the "🔍 Click to zoom" hint
- **Click and hold** to zoom in 2x
- Screenshots won't collapse the parent event when clicked
- Zoomed view includes a shadow effect for better visibility

### Request/Response Debugging
- **Click the section headers** to expand/collapse request or response data
- **Section headers** have a colored background that changes on hover
- **JSON data** is displayed in a monospace font for readability
- **Text is selectable** for easy copying
- These sections are independent - won't affect the parent event state

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
3. **Examine Screenshots**: Verify what the AI actually saw immediately
4. **Check Request Data**: Confirm the correct fields were sent
5. **Review Response**: See exactly what the webhook returned when ready
6. **Compare Events**: Keep multiple events expanded to compare results
7. **Handle Slow Webhooks**: Don't worry about timeouts - requests have 5 minutes

## Keyboard Shortcuts (Future Feature)
- `Esc` - Collapse all expanded events
- `Ctrl/Cmd + F` - Focus search in history
- `Space` - Toggle expand/collapse on selected event 