# Summary Display Issue Analysis

## Problem
The evaluation summary is not displaying for cloud runner results due to data structure inconsistencies between local and cloud capture responses.

## Current Data Flow

### Local Captures
1. LLMService returns: `{ field1: [...], field2: [...], summary: "..." }`
2. EventService expects summary at top level: `results.summary`
3. HistoryManager displays: `event.summary`

### Cloud Captures
1. Cloud runner returns: `{ evaluation: { field1: [...], field2: [...] }, summary: "..." }`
2. MessageService syncs and passes to EventService
3. EventService looks for `results.summary` but structure is different

## Current "Hack" Solution
```javascript
// Creating a new object to ensure summary is at top level
const resultsForEvent = {
    ...llmResponse,
    summary: llmResponse.summary || llmResponse.reason || ''
};
```

## Proper Solution Options

### Option 1: Standardize at the Source (Recommended)
Update EventService to handle both structures properly:

```javascript
// In EventService.trackEvent()
let summaryText = '';
if (results) {
    // Handle both local format (summary at top) and cloud format (nested)
    summaryText = results.summary || 
                  (results.llmResponse && results.llmResponse.summary) ||
                  '';
}
event.summary = summaryText;
```

### Option 2: Create a Data Normalization Layer
Create a dedicated function to normalize all LLM responses:

```javascript
function normalizeLLMResponse(response) {
    // Handle various response formats
    if (response.evaluation) {
        // Cloud format
        return {
            fields: response.evaluation,
            summary: response.summary || ''
        };
    } else {
        // Local format - extract fields and summary
        const { summary, ...fields } = response;
        return {
            fields: fields,
            summary: summary || ''
        };
    }
}
```

### Option 3: Update Cloud Runner Response Format
Make cloud runner return the same format as local captures by removing the evaluation wrapper.

## Recommendation
Implement Option 1 (update EventService) because:
1. Single point of change
2. Maintains backward compatibility
3. Handles all current formats
4. No need to update cloud runner or redeploy

## Implementation Plan
1. Update EventService.trackEvent() to properly extract summary from both formats
2. Remove the hack from MessageService
3. Add tests to ensure both formats work
4. Document the expected formats for future reference 