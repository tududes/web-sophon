#!/usr/bin/env node

/**
 * OpenRouter InternVL3 14B Test Script
 * Tests the WebSophon LLM integration with OpenRouter's free vision model
 */

const fs = require('fs');
const path = require('path');

// Configuration from your request payload
const CONFIG = {
    apiKey: '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',
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'opengvlab/internvl3-14b:free',
    domain: 'x.com',
    url: 'https://x.com/elonmusk',
    fields: [
        {
            name: 'is_crazy',
            criteria: 'Let me know if Elon is behaing erraitc with his latest tweet at the top of the page'
        },
        {
            name: 'bullish_on_btc',
            criteria: 'Elon mentioned BTC or any other crypto'
        }
    ]
};

// System prompt template from WebSophon
function generateSystemPrompt(fields) {
    return `Your job is very important and the results you provide will serve as a gatekeeper for actions taken in an automated system. You will behave as a highly accurate frame-by-frame screenshot processing engine, where you will be passed an image and a set of one or more fields accompanied by a value for each which is the key criteria necessary to evaluate for a boolean true or false value according to your image analysis.

You will respond in pure parseable JSON string from start to finish without any markdown containing all original field(s), each accompanied by an array of the resulting boolean, and resulting probability represented by a floating point number between 0 and 1 that your analysis resulted in a boolean that is 100% correct according to the screenshot. Then at the end of the json response, you will append an additional field named "reason" which will contain a brief explanation of what you saw in the image and the state of the screenshot.

Here are the fields and their criteria for evaluation:
${JSON.stringify(fields, null, 2)}`;
}

// Enhanced JSON parsing logic (from the fixes)
function parseMarkdownJSON(content) {
    console.log('Parsing LLM response content...');

    // First, try to extract JSON from markdown code blocks if present
    let jsonContent = content;

    // Check if content is wrapped in markdown code blocks
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
    const codeBlockMatch = content.match(codeBlockRegex);
    if (codeBlockMatch) {
        jsonContent = codeBlockMatch[1].trim();
        console.log('✅ Extracted JSON from markdown code blocks');
    }

    // If no code blocks, try to find JSON object directly
    if (!codeBlockMatch) {
        const jsonObjectRegex = /\{[\s\S]*\}/;
        const jsonMatch = content.match(jsonObjectRegex);
        if (jsonMatch) {
            jsonContent = jsonMatch[0];
            console.log('✅ Extracted JSON object from content');
        }
    }

    try {
        const responseData = JSON.parse(jsonContent);
        console.log('✅ Successfully parsed JSON response');
        return {
            success: true,
            data: responseData,
            extractedJson: jsonContent
        };
    } catch (contentParseError) {
        console.error('❌ Failed to parse LLM content as JSON:', contentParseError.message);
        return {
            success: false,
            error: 'Failed to parse LLM response as JSON',
            raw_content: content,
            attempted_json: jsonContent,
            parse_error: contentParseError.message
        };
    }
}

// Convert image file to base64
function imageToBase64(imagePath) {
    try {
        const imageBuffer = fs.readFileSync(imagePath);
        const base64String = imageBuffer.toString('base64');
        const mimeType = path.extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
        return `data:${mimeType};base64,${base64String}`;
    } catch (error) {
        throw new Error(`Failed to read image file: ${error.message}`);
    }
}

// Main test function
async function testOpenRouterIntegration(imagePath) {
    console.log('🚀 Starting OpenRouter InternVL3 14B Integration Test');
    console.log('=====================================');

    try {
        // Check if image file exists
        if (!fs.existsSync(imagePath)) {
            throw new Error(`Screenshot file not found: ${imagePath}`);
        }

        console.log(`📷 Screenshot: ${imagePath}`);
        console.log(`🔗 API URL: ${CONFIG.apiUrl}`);
        console.log(`🤖 Model: ${CONFIG.model}`);
        console.log(`🌐 Domain: ${CONFIG.domain}`);
        console.log(`📊 Fields: ${CONFIG.fields.length}`);
        console.log('');

        // Convert image to base64
        console.log('📸 Converting screenshot to base64...');
        const base64Image = imageToBase64(imagePath);
        const imageSize = Math.round(base64Image.length / 1024);
        console.log(`✅ Image converted (${imageSize}KB base64)`);
        console.log('');

        // Generate system prompt
        console.log('📝 Generating system prompt...');
        const systemPrompt = generateSystemPrompt(CONFIG.fields);
        console.log('✅ System prompt generated');
        console.log('System prompt preview:');
        console.log(systemPrompt.substring(0, 200) + '...');
        console.log('');

        // Prepare API request
        console.log('🔧 Preparing OpenRouter API request...');
        const requestPayload = {
            model: CONFIG.model,
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'Please analyze this screenshot according to the field criteria provided in the system prompt.'
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: base64Image
                            }
                        }
                    ]
                }
            ],
            max_tokens: 1000,
            temperature: 0.1
        };

        console.log('✅ Request payload prepared');
        console.log(`📊 Payload size: ${Math.round(JSON.stringify(requestPayload).length / 1024)}KB`);
        console.log('');

        // Send request to OpenRouter
        console.log('🌐 Sending request to OpenRouter...');
        const startTime = Date.now();

        const response = await fetch(CONFIG.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.apiKey}`,
                'HTTP-Referer': 'https://github.com/chrisk/tv-eyes',
                'X-Title': 'WebSophon - Screenshot Analysis'
            },
            body: JSON.stringify(requestPayload)
        });

        const responseTime = Date.now() - startTime;
        console.log(`⏱️  Response received in ${responseTime}ms`);

        // Handle response
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter API Error ${response.status}: ${response.statusText}\n${errorText}`);
        }

        const responseData = await response.text();
        console.log('✅ Response received successfully');
        console.log('');

        // Parse the response
        console.log('🔍 Parsing OpenRouter response...');
        let llmData;
        try {
            llmData = JSON.parse(responseData);
        } catch (error) {
            throw new Error(`Failed to parse OpenRouter response: ${error.message}`);
        }

        console.log(`📋 Provider: ${llmData.provider || 'Unknown'}`);
        console.log(`🎯 Model used: ${llmData.model || CONFIG.model}`);
        console.log(`💰 Token usage: ${llmData.usage ? `${llmData.usage.total_tokens} total (${llmData.usage.prompt_tokens} prompt + ${llmData.usage.completion_tokens} completion)` : 'Not provided'}`);
        console.log('');

        // Extract content from response
        let content = '';
        if (llmData.choices && llmData.choices[0] && llmData.choices[0].message) {
            content = llmData.choices[0].message.content;
        } else {
            throw new Error('Unexpected OpenRouter response format - no content found');
        }

        console.log('📝 Raw LLM Content:');
        console.log('-------------------');
        console.log(content);
        console.log('-------------------');
        console.log('');

        // Parse the field results using enhanced parsing
        console.log('🔧 Parsing field results...');
        const parseResult = parseMarkdownJSON(content);

        if (!parseResult.success) {
            console.error('❌ Failed to parse field results:', parseResult.error);
            console.log('Raw content:', parseResult.raw_content);
            console.log('Attempted JSON:', parseResult.attempted_json);
            return false;
        }

        const fieldResults = parseResult.data;
        console.log('✅ Field results parsed successfully');
        console.log('');

        // Analyze field results
        console.log('📊 FIELD ANALYSIS RESULTS');
        console.log('==========================');

        let fieldsProcessed = 0;
        const processedFields = [];

        for (const [fieldName, fieldResult] of Object.entries(fieldResults)) {
            if (fieldName !== 'reason' && Array.isArray(fieldResult) && fieldResult.length >= 1) {
                fieldsProcessed++;
                const result = fieldResult[0]; // boolean result
                const probability = fieldResult.length > 1 ? fieldResult[1] : null;
                const percentage = probability ? Math.round(probability * 100) : null;

                processedFields.push({
                    name: fieldName,
                    result: result,
                    probability: probability,
                    percentage: percentage
                });

                const statusIcon = result ? '🟢' : '🔴';
                const confidenceText = percentage ? ` (${percentage}% confidence)` : '';
                console.log(`${statusIcon} ${fieldName}: ${result ? 'TRUE' : 'FALSE'}${confidenceText}`);

                // Check field configuration
                const fieldConfig = CONFIG.fields.find(f => f.name === fieldName);
                if (fieldConfig) {
                    console.log(`   📋 Criteria: "${fieldConfig.criteria}"`);
                } else {
                    console.log(`   ⚠️  No field configuration found for "${fieldName}"`);
                }
                console.log('');
            }
        }

        // Show reason
        if (fieldResults.reason) {
            console.log('💭 ANALYSIS REASONING:');
            console.log(fieldResults.reason);
            console.log('');
        }

        // Summary
        console.log('📈 SUMMARY');
        console.log('===========');
        console.log(`✅ Fields processed: ${fieldsProcessed}`);
        console.log(`⏱️  Total time: ${responseTime}ms`);
        console.log(`🤖 Model: ${CONFIG.model} (Nineteen on Bittensor)`);
        console.log(`💰 Cost: FREE (${llmData.usage ? llmData.usage.total_tokens + ' tokens' : 'N/A'})`);
        console.log('');

        // Test webhook scenarios
        console.log('🔗 WEBHOOK SCENARIOS');
        console.log('=====================');
        processedFields.forEach(field => {
            const triggerScenario = field.result ? 'TRUE' : 'FALSE';
            console.log(`${field.name}: Would fire webhook on ${triggerScenario} result`);
        });
        console.log('');

        console.log('🎉 OpenRouter Integration Test SUCCESSFUL!');
        return {
            success: true,
            results: fieldResults,
            processedFields: processedFields,
            responseTime: responseTime,
            tokenUsage: llmData.usage
        };

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// CLI execution
if (require.main === module) {
    const imagePath = process.argv[2] || 'websophon-screenshot-2025-06-13-22-06-31.png';

    console.log('🔍 WebSophon OpenRouter Integration Test');
    console.log('========================================');
    console.log('');

    if (!imagePath) {
        console.log('Usage: node test-openrouter-integration.js <screenshot.png>');
        process.exit(1);
    }

    testOpenRouterIntegration(imagePath)
        .then(result => {
            if (result.success) {
                console.log('✅ All tests passed!');
                process.exit(0);
            } else {
                console.log('❌ Tests failed!');
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('💥 Unexpected error:', error);
            process.exit(1);
        });
}

module.exports = { testOpenRouterIntegration, parseMarkdownJSON }; 