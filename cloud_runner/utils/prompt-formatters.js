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
 * @param {string} modelName - The name of the LLM model being used.
 * @returns {string} The formatted system prompt.
 */
export function getSystemPrompt(fields, previousEvaluation, modelName = 'assistant') {
  // Generate a clean JSON structure for the fields.
  const fieldsObject = fields.reduce((obj, field) => {
    // Use the sanitized name for the key in the JSON object.
    obj[field.name] = field.criteria;
    return obj;
  }, {});
  const fieldsJson = JSON.stringify(fieldsObject, null, 2);

  // Generate unique trace ID
  const traceId = `eval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Build previous evaluation context if available
  let previousContext = '';
  if (previousEvaluation && previousEvaluation.results && Object.keys(previousEvaluation.results).length > 0) {
    previousContext = `\n\n### Previous Evaluation Context\nThe following shows results from a previous evaluation (after confidence filtering). Use this to detect changes:\n`;

    for (const [fieldName, result] of Object.entries(previousEvaluation.results)) {
      // Only include the boolean value, no confidence scores
      if (typeof result === 'boolean') {
        // Already filtered format
        previousContext += `- "${fieldName}": ${result}\n`;
      } else {
        // Skip any non-boolean results (shouldn't happen with proper filtering)
        console.warn(`Skipping non-boolean result for field "${fieldName}":`, result);
      }
    }
  }

  return `You are an AI assistant that communicates exclusively using the SAPIENT protocol. Your task is to analyze web page screenshots and evaluate specific boolean conditions.

## SAPIENT Communication Rules:

1. **Every message starts with**: \`::SAPIENT v:1.0 [headers]::\`
   - Required headers: \`from:assistant to:user trace:[unique-id]\`
   - Optional headers: \`ref:[previous-trace]\`, \`priority:normal|high|urgent\`, \`tags:tag1,tag2\`, \`type:response|notification|error\`
   - Headers are space-separated on the same line

2. **Natural language body**:
   - Write conversationally after the header line
   - NO special formatting needed - just write naturally
   - Line breaks, quotes, colons - all are safe to use
   - Only rule: don't start a line with \`::\`

3. **Structured data blocks** (when needed):
   
   ::DATA:block_name format:json::
   {"your": "structured", "data": "here"}
   ::END:block_name::
   
   - Supported formats: \`json\`, \`yaml\`, \`text\`, \`csv\`, \`xml\`
   - Block names must be unique within the message
   - Use descriptive names like \`evaluation\`, \`field_results\`, \`error_details\`

4. **Every message ends with**: \`::END:SAPIENT::\`

## Your Task:

Analyze the screenshot and evaluate these boolean conditions:

${fieldsJson}${previousContext}

## Required Response Format:

::SAPIENT v:1.0 from:${modelName} to:websophon::
I've analyzed the screenshot for the requested fields. [Your natural language explanation of what you see in the screenshot and your evaluation reasoning goes here. Be specific about UI elements, text, colors, positions, and any other relevant details that influenced your assessment.]

::DATA:response format:json::
{
${fields.map(field => `  "${field.name}": [boolean_true_or_false, confidence_0_to_1]`).join(',\n')}
}
::END:response::
::END:SAPIENT::

Example (DO NOT copy values, evaluate based on actual screenshot):

::SAPIENT v:1.0 from:${modelName} to:websophon::
I've analyzed the trading chart screenshot. The chart shows XAUTUS (Gold) with multiple technical indicators. I can see the price is at 3,278.60 with a cyan moving average line. The HEXGO POWER indicator at the bottom shows mixed signals with both red and green dots. However, I cannot clearly identify any TF buy/sell signals on the chart, which are required for entry conditions.

::DATA:response format:json::
{
  "long_entries": [false, 0.85],
  "short_entries": [false, 0.80],
  "long_exits": [false, 0.75],
  "short_exits": [false, 0.75]
}
::END:response::
::END:SAPIENT::

Remember: Write your analysis naturally in the body. The array format is [boolean_result, confidence_level].`;
} 