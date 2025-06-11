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

## Tips for Effective Debugging

1. **Start from Fields**: Click a field's last result to quickly find its event
2. **Examine Screenshots**: Verify what the AI actually saw
3. **Check Request Data**: Confirm the correct fields were sent
4. **Review Response**: See exactly what the webhook returned
5. **Compare Events**: Keep multiple events expanded to compare results

## Keyboard Shortcuts (Future Feature)
- `Esc` - Collapse all expanded events
- `Ctrl/Cmd + F` - Focus search in history
- `Space` - Toggle expand/collapse on selected event 