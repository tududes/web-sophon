// Shared utility functions for formatting LLM prompts.
// This file is used by both the extension and the cloud runner.

/**
 * Sanitizes a field name to be a valid JSON key and variable name.
 * Replaces spaces and invalid characters with underscores.
 * @param {string} name - The original field name.
 * @returns {string} The sanitized field name.
 */
export function sanitizeFieldName(name) {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/[^a-z0-9_]/g, ''); // Remove other invalid characters
}

/**
 * Generates the system prompt for the LLM based on the fields to evaluate.
 * @param {Array<Object>} fields - The fields to be evaluated by the LLM.
 * @param {Object} previousEvaluation - The results from the previous evaluation, for context.
 * @returns {string} The formatted system prompt.
 */
export function getSystemPrompt(fields, previousEvaluation) {
  // Generate a clean JSON structure for the fields.
  const fieldsObject = fields.reduce((obj, field) => {
    // Use the sanitized name for the key in the JSON object.
    obj[field.name] = field.criteria;
    return obj;
  }, {});
  const fieldsJson = JSON.stringify(fieldsObject, null, 2);

  // Safely stringify previous evaluation context, if available.
  let previousContext = '';
  if (previousEvaluation && previousEvaluation.results && Object.keys(previousEvaluation.results).length > 0) {
    try {
      const contextJson = JSON.stringify(previousEvaluation.results, null, 2);
      previousContext = `

You have been provided with the results of a previous evaluation for this same page.
Use this as context to determine if the state has changed.

<<DATA:previous_evaluation>>
${contextJson}
<<END:previous_evaluation>>

Focus on detecting changes from this previous state. For example, if a field was 'false' and is now 'true', that is a significant change.
`;
    } catch (error) {
      console.error('Could not stringify previous evaluation:', error);
    }
  }

  return `You are a web page analysis expert using the SAPIENT protocol for structured communication. Your task is to evaluate a screenshot of a web page based on specific field criteria.

=== SAPIENT/1.0 BEGIN ===
From: websophon-analyzer
To: websophon-extension
Type: field_evaluation
Priority: normal

Analyze the provided screenshot and evaluate each field according to its criteria.

Fields to evaluate:
<<DATA:field_criteria>>
${fieldsJson}
<<END:field_criteria>>
${previousContext}
For each field, determine:
1. Boolean result (true/false) - does the screenshot meet the criteria?
2. Confidence level (0.0 to 1.0) - how certain are you?

Provide your evaluation in a DATA block, followed by a natural language explanation of your findings.

Example response format:
=== SAPIENT/1.0 BEGIN ===
From: websophon-analyzer
To: websophon-extension
Type: field_evaluation_response

I've analyzed the screenshot for the requested fields. Here's what I found:

<<DATA:evaluation>>
{
  "field_name_1": {
    "result": true,
    "confidence": 0.95
  },
  "field_name_2": {
    "result": false,
    "confidence": 0.90
  }
}
<<END:evaluation>>

The screenshot shows a trading chart with clear buy signals visible. The green TF indicator on the rightmost candle confirms the long entry condition is met, while the price position above the MATRIX trend line supports this evaluation. No short entry signals are present as the momentum indicators remain bullish.

=== SAPIENT/1.0 END ===

Now analyze the provided screenshot:
=== SAPIENT/1.0 END ===`;
} 