const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 7113;

// In-memory store for jobs. In production, use a persistent store like Redis.
const jobs = {};

app.use(cors()); // Enable CORS for all routes
app.use(bodyParser.json({ limit: '10mb' })); // Increase limit for larger payloads

/**
 * Endpoint to submit a new capture job.
 * The extension will send the target URL and session data here.
 */
app.post('/job', (req, res) => {
    const { sessionData, llmConfig, fields, previousEvaluation } = req.body;

    if (!sessionData || !sessionData.url) {
        return res.status(400).json({ error: 'Session data with a URL is required' });
    }
    if (!llmConfig || !fields) {
        return res.status(400).json({ error: 'LLM config and fields are required' });
    }

    const jobId = uuidv4();
    jobs[jobId] = {
        id: jobId,
        status: 'pending',
        createdAt: new Date().toISOString(),
        screenshotData: null,
        llmResponse: null,
        error: null,
    };

    console.log(`[${jobId}] Job created for URL: ${sessionData.url}`);

    res.status(202).json({ jobId });

    processJob(jobId, { sessionData, llmConfig, fields, previousEvaluation });
});

/**
 * Endpoint to check the status of a capture job.
 * The extension will poll this endpoint using the jobId.
 */
app.get('/job/:id', (req, res) => {
    const jobId = req.params.id;
    const job = jobs[jobId];

    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    console.log(`[${jobId}] Status check: ${job.status}`);
    res.status(200).json(job);
});

/**
 * Endpoint to test the cloud runner connection and payload handling.
 */
app.post('/test', (req, res) => {
    const { testData } = req.body;
    console.log('Received test request with data:', testData);

    if (!testData) {
        return res.status(400).json({ success: false, error: 'No testData received.' });
    }

    // "Decrypt" and "re-encrypt" the data (for now, just a simple transformation)
    const processedData = `Runner processed: ${testData}`;

    res.status(200).json({
        success: true,
        message: 'Cloud runner is running and processed the test data successfully.',
        receivedData: testData,
        processedData: processedData
    });
});

/**
 * Processes the capture job using Puppeteer.
 * This function runs in the background.
 */
async function processJob(jobId, jobData) {
    const job = jobs[jobId];
    const { sessionData, llmConfig, fields, previousEvaluation } = jobData;
    let browser;

    try {
        console.log(`[${jobId}] Launching Puppeteer...`);
        job.status = 'launching_browser';
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();

        console.log(`[${jobId}] Setting up browser environment...`);
        job.status = 'setting_environment';

        // Set User Agent
        if (sessionData.userAgent) {
            await page.setUserAgent(sessionData.userAgent);
        }

        // Set Viewport
        if (sessionData.viewport) {
            await page.setViewport(sessionData.viewport);
        }

        // Set Cookies
        if (sessionData.cookies && sessionData.cookies.length > 0) {
            await page.setCookie(...sessionData.cookies);
        }

        // Set Local & Session Storage
        await page.evaluateOnNewDocument((storage) => {
            for (const [key, value] of Object.entries(storage.localStorage)) {
                window.localStorage.setItem(key, value);
            }
            for (const [key, value] of Object.entries(storage.sessionStorage)) {
                window.sessionStorage.setItem(key, value);
            }
        }, { localStorage: sessionData.localStorage, sessionStorage: sessionData.sessionStorage });


        console.log(`[${jobId}] Navigating to ${sessionData.url}...`);
        job.status = 'navigating';
        await page.goto(sessionData.url, { waitUntil: 'networkidle2' });

        console.log(`[${jobId}] Taking screenshot...`);
        job.status = 'capturing';
        const screenshotBuffer = await page.screenshot({ fullPage: true });
        const base64Image = screenshotBuffer.toString('base64');
        job.screenshotData = `data:image/png;base64,${base64Image}`;

        console.log(`[${jobId}] Sending to LLM...`);
        job.status = 'analyzing';
        const llmResponse = await callLlmService(base64Image, llmConfig, fields, previousEvaluation);
        job.llmResponse = llmResponse;

        job.status = 'complete';
        job.completedAt = new Date().toISOString();
        console.log(`[${jobId}] Job completed successfully.`);

    } catch (error) {
        console.error(`[${jobId}] Error processing job:`, error);
        job.status = 'failed';
        job.error = error.message;
        job.completedAt = new Date().toISOString();
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

async function callLlmService(base64Image, llmConfig, fields, previousEvaluation) {
    // This function mimics the structure of the extension's LLMService
    const systemPrompt = getSystemPrompt(fields, previousEvaluation);

    const requestPayload = {
        model: llmConfig.model || 'gpt-4-vision-preview',
        messages: [
            { role: 'system', content: systemPrompt },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Please analyze this screenshot.' },
                    { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } }
                ]
            }
        ],
        max_tokens: llmConfig.maxTokens || 1000,
        temperature: llmConfig.temperature || 0.1,
    };

    const response = await fetch(llmConfig.apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${llmConfig.apiKey}`,
        },
        body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API Error ${response.status}: ${errorText}`);
    }

    const responseData = await response.json();
    // Extract the content from the typical OpenAI response structure
    if (responseData.choices && responseData.choices[0] && responseData.choices[0].message) {
        let content = responseData.choices[0].message.content;
        content = content.replace(/^```json\s*|```\s*$/g, ''); // Trim markdown fences
        try {
            return JSON.parse(content);
        } catch (e) {
            // If parsing fails, return the raw content string
            return { raw_content: content, parse_error: e.message };
        }
    }

    return responseData; // Fallback to returning the full response
}

function getSystemPrompt(fields, previousEvaluation) {
    const fieldsJson = JSON.stringify(fields, null, 2);
    let previousContext = previousEvaluation ? `\nPREVIOUS EVALUATION CONTEXT:\n${JSON.stringify(previousEvaluation, null, 2)}` : '';

    return `Analyze this screenshot and return JSON with your evaluation for each field.

For each field, return: "field_name": [boolean_result, confidence_0_to_1]

Fields to evaluate:
${fieldsJson}${previousContext}

Response format:
{
  "field_name": [true, 0.95],
  "reason": "Brief explanation"
}

Return only JSON.`;
}

app.listen(port, () => {
    console.log(`Cloud runner listening on port ${port}`);
});
