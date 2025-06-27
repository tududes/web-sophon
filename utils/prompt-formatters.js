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
PREVIOUS_EVALUATION_CONTEXT:
${contextJson}

Focus on detecting changes from this previous state. For example, if a field was 'false' and is now 'true', that is a significant change.
`;
    } catch (error) {
      console.error('Could not stringify previous evaluation:', error);
    }
  }

  const jsonStructureExample = `{
  "evaluation": {
    "field_name_1": {
      "result": true,
      "confidence": 0.95
    },
    "field_name_2": {
      "result": false,
      "confidence": 0.99
    }
  },
  "summary": "A brief, one-sentence summary of the evaluation findings, mentioning which fields are true."
}`;

  return `You are a web page analysis expert. Your task is to evaluate a screenshot of a web page based on a set of criteria for different fields.

CRITICAL: Respond exclusively with a single, valid JSON object. Do not include any text, notes, explanations, or markdown formatting outside of the JSON structure.

The JSON object MUST have exactly this structure with two top-level keys:

1. **"evaluation"**: An object where each key is a field name from the list below. Each field value MUST be an object with exactly these two properties:
   - **"result"**: A boolean value (true or false) indicating if the criteria are met
   - **"confidence"**: A number between 0.0 and 1.0 representing your confidence level

2. **"summary"**: A string with a concise, one-sentence summary of the overall findings

**Fields to Evaluate:**
${fieldsJson}

${previousContext}

**REQUIRED Output Format (copy this structure exactly):**
${jsonStructureExample}

**Important Notes:**
- Use "result" and "confidence" as the property names (not "boolean" or "probability")
- Confidence should be between 0.0 and 1.0 (e.g., 0.95 for 95% confident)
- Include ALL fields in the evaluation object, even if result is false
- Provide realistic confidence scores based on visual clarity
- Do not add any extra properties or change the structure

Return ONLY the JSON response now:`;
} 