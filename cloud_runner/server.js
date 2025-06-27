import express from 'express';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer';
import cors from 'cors';
import { getSystemPrompt } from './utils/prompt-formatters.js';

const app = express();
const port = process.env.PORT || 7113;

// In-memory store for jobs and their results.
// In production, this should be a persistent store like Redis.
const jobs = {};

// --- NEW: Internal Scheduler ---
// This will run jobs on the server according to their schedule.
const jobScheduler = {
    intervalId: null,
    start: () => {
        if (jobScheduler.intervalId) return;
        console.log('[Scheduler] Starting job scheduler...');
        jobScheduler.intervalId = setInterval(async () => {
            const now = Date.now();
            for (const jobId in jobs) {
                const job = jobs[jobId];
                if (job.interval && job.status !== 'running') {
                    const lastRun = job.lastRun || 0;
                    if (now - lastRun >= job.interval * 1000) {
                        console.log(`[Scheduler] Job ${jobId} is due. Last run was at ${new Date(lastRun).toISOString()}.`);
                        job.lastRun = now;
                        // Don't await this, let it run in the background
                        processJob(jobId, job.jobData);
                    }
                }
            }
        }, 5000); // Check every 5 seconds for due jobs
    },
    stop: () => {
        if (jobScheduler.intervalId) {
            clearInterval(jobScheduler.intervalId);
            jobScheduler.intervalId = null;
            console.log('[Scheduler] Stopped job scheduler.');
        }
    }
};

// Add a simple logger middleware to see all incoming requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] Received ${req.method} request for ${req.url}`);
    next();
});

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

/**
 * Endpoint to submit or update a capture job.
 * If an interval is provided, it creates a recurring job.
 */
app.post('/job', (req, res) => {
    const {
        sessionData,
        llmConfig,
        fields,
        previousEvaluation,
        interval = null,
        domain,
        captureSettings = {} // NEW: Include capture settings
    } = req.body;

    if (!sessionData || !sessionData.url) {
        return res.status(400).json({ error: 'Session data with a URL is required' });
    }
    if (!llmConfig || !fields) {
        return res.status(400).json({ error: 'LLM config and fields are required' });
    }
    if (!domain) {
        return res.status(400).json({ error: 'Domain is required for job identification' });
    }

    // Check if a job for this domain already exists
    let jobId = Object.keys(jobs).find(id => jobs[id].domain === domain);
    const jobExists = !!jobId;

    if (!jobExists) {
        jobId = uuidv4();
        jobs[jobId] = {
            id: jobId,
            domain: domain,
            status: 'idle', // Job is waiting for its interval
            interval: interval,
            createdAt: new Date().toISOString(),
            lastRun: 0,
            jobData: { sessionData, llmConfig, fields, previousEvaluation, captureSettings },
            results: [], // Array to store results from each run
            error: null,
        };
        console.log(`[${jobId}] New recurring job created for domain ${domain} with interval ${interval}s`);
        console.log(`[${jobId}] Capture settings:`, captureSettings);
    } else {
        // Update existing job
        const job = jobs[jobId];
        job.interval = interval;
        job.jobData = { sessionData, llmConfig, fields, previousEvaluation, captureSettings };
        job.status = 'idle';
        console.log(`[${jobId}] Existing job for domain ${domain} updated with interval ${interval}s`);
        console.log(`[${jobId}] Updated capture settings:`, captureSettings);
    }

    // If it's a one-off job (no interval), run it immediately.
    if (!interval) {
        console.log(`[${jobId}] Job for ${domain} is a one-off. Running now.`);
        processJob(jobId, { sessionData, llmConfig, fields, previousEvaluation, captureSettings });
        res.status(202).json({ jobId, message: "One-off job started." });
    } else {
        res.status(201).json({ jobId, message: `Recurring job ${jobExists ? 'updated' : 'created'}.` });
    }
});

/**
 * Endpoint to get the status and accumulated results of a job.
 */
app.get('/job/:id', (req, res) => {
    const jobId = req.params.id;
    const job = jobs[jobId];

    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    // Return a summary of the job, not the full result data here
    const jobSummary = {
        id: job.id,
        domain: job.domain,
        status: job.status,
        interval: job.interval,
        createdAt: job.createdAt,
        lastRun: job.lastRun,
        resultCount: job.results.length,
    };
    console.log(`[${jobId}] Status check: ${job.status}, ${job.results.length} results pending.`);
    res.status(200).json(jobSummary);
});


/**
 * NEW: Endpoint to stop and delete a recurring job.
 */
app.delete('/job/:id', (req, res) => {
    const jobId = req.params.id;
    if (jobs[jobId]) {
        delete jobs[jobId];
        console.log(`[${jobId}] Job deleted successfully.`);
        res.status(200).json({ message: 'Job deleted successfully.' });
    } else {
        res.status(404).json({ error: 'Job not found.' });
    }
});

/**
 * NEW: Endpoint to fetch all accumulated results for a job.
 */
app.get('/job/:id/results', (req, res) => {
    const jobId = req.params.id;
    const job = jobs[jobId];
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    console.log(`[${jobId}] Fetching ${job.results.length} results.`);
    res.status(200).json({ results: job.results });
});

/**
 * NEW: Endpoint to purge results after the extension has synced them.
 */
app.post('/job/:id/purge', (req, res) => {
    const jobId = req.params.id;
    const job = jobs[jobId];
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }
    const purgedCount = job.results.length;
    job.results = []; // Clear the results array
    console.log(`[${jobId}] Purged ${purgedCount} results.`);
    res.status(200).json({ message: `Purged ${purgedCount} results.` });
});


/**
 * Endpoint to test the cloud runner connection.
 */
app.post('/test', (req, res) => {
    res.status(200).json({ success: true, message: 'Cloud runner is running.' });
});

/**
 * Processes the capture job using Puppeteer.
 * This function now appends results to the job's results array.
 */
async function processJob(jobId, jobData) {
    const job = jobs[jobId];
    if (!job) {
        console.error(`[${jobId}] Tried to process a job that does not exist.`);
        return;
    }

    // Prevent concurrent runs for the same job
    if (job.status === 'running') {
        console.warn(`[${jobId}] Job is already running. Skipping this execution.`);
        return;
    }

    const { sessionData, llmConfig, fields, captureSettings = {} } = jobData;
    let browser;

    try {
        console.log(`[${jobId}] Launching Puppeteer...`);
        job.status = 'running';
        browser = await puppeteer.launch({
            headless: true,
            executablePath: '/usr/bin/google-chrome',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        console.log(`[${jobId}] Setting up browser environment...`);

        if (sessionData.userAgent) await page.setUserAgent(sessionData.userAgent);
        if (sessionData.viewport) await page.setViewport(sessionData.viewport);
        if (sessionData.cookies && sessionData.cookies.length > 0) await page.setCookie(...sessionData.cookies);

        await page.evaluateOnNewDocument((storage) => {
            for (const [key, value] of Object.entries(storage.localStorage)) window.localStorage.setItem(key, value);
            for (const [key, value] of Object.entries(storage.sessionStorage)) window.sessionStorage.setItem(key, value);
        }, { localStorage: sessionData.localStorage, sessionStorage: sessionData.sessionStorage });

        console.log(`[${jobId}] Navigating to ${sessionData.url}...`);
        await page.goto(sessionData.url, { waitUntil: 'networkidle2' });

        // Handle page refresh if enabled (similar to local implementation)
        if (captureSettings.refreshPageToggle) {
            console.log(`[${jobId}] Refreshing page before capture (as requested by user settings)...`);
            await page.reload({ waitUntil: 'networkidle2' });
            console.log(`[${jobId}] Page refresh completed`);
        }

        // Apply capture delay if specified (similar to local implementation)
        const captureDelay = parseInt(captureSettings.captureDelay || '0');
        if (captureDelay > 0) {
            console.log(`[${jobId}] Waiting ${captureDelay} seconds before capture (as requested by user settings)...`);
            await new Promise(resolve => setTimeout(resolve, captureDelay * 1000));
            console.log(`[${jobId}] Capture delay completed`);
        }

        console.log(`[${jobId}] Taking screenshot...`);
        // Respect full page capture setting (similar to local implementation)
        const fullPageCapture = captureSettings.fullPageCaptureToggle || false;
        const screenshotBuffer = await page.screenshot({
            fullPage: fullPageCapture,
            type: 'png'
        });
        const screenshotData = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;
        console.log(`[${jobId}] Screenshot captured (full page: ${fullPageCapture}), size: ${screenshotBuffer.length} bytes`);

        console.log(`[${jobId}] Sending to LLM...`);
        // Use the job's last result as context for the next one
        let previousEvaluation = jobData.previousEvaluation; // Start with initial context
        if (job.results.length > 0) {
            const lastResult = job.results[job.results.length - 1];
            if (lastResult.llmResponse && lastResult.llmResponse.evaluation) {
                // For subsequent runs, construct the context from the 'evaluation' block of the last run.
                previousEvaluation = {
                    results: lastResult.llmResponse.evaluation
                };
            }
        }
        const { response, requestPayload } = await callLlmService(screenshotBuffer.toString('base64'), llmConfig, fields, previousEvaluation);

        // Add the new result to the job's history
        job.results.push({
            resultId: uuidv4(),
            timestamp: new Date().toISOString(),
            screenshotData: screenshotData,
            llmRequestPayload: { ...requestPayload, messages: requestPayload.messages.map(m => (m.role === 'user' ? { ...m, content: [{ type: 'text', text: 'Please analyze this screenshot.' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,REDACTED' } }] } : m)) },
            llmResponse: response,
            error: null,
            captureSettings: captureSettings // Store settings used for this capture
        });

        job.status = job.interval ? 'idle' : 'complete'; // Reset to idle for next interval
        console.log(`[${jobId}] Job run completed successfully. Total results: ${job.results.length}`);

    } catch (error) {
        console.error(`[${jobId}] Error processing job:`, error);
        job.status = 'failed';
        job.error = error.message;
        // Also add error to results history
        job.results.push({
            resultId: uuidv4(),
            timestamp: new Date().toISOString(),
            error: error.message,
            captureSettings: captureSettings
        });
    } finally {
        if (browser) {
            await browser.close();
        }
        // If it was a one-off job that's done, clean it up after a while
        if (job && !job.interval) {
            setTimeout(() => {
                if (jobs[jobId]) {
                    console.log(`[${jobId}] Deleting completed one-off job.`);
                    delete jobs[jobId];
                }
            }, 60000 * 5); // 5 minutes
        }
    }
}

async function callLlmService(base64Image, llmConfig, fields, previousEvaluation) {
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
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${llmConfig.apiKey}` },
        body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API Error ${response.status}: ${errorText}`);
    }

    const responseData = await response.json();
    let finalResponse;

    if (responseData.choices && responseData.choices[0] && responseData.choices[0].message) {
        let content = responseData.choices[0].message.content.replace(/^```json\s*|```\s*$/g, '');
        try {
            const parsedContent = JSON.parse(content);
            // Normalize the response to ensure consistent format
            finalResponse = normalizeCloudLLMResponse(parsedContent, fields);
        } catch (e) {
            finalResponse = { raw_content: content, parse_error: e.message };
        }
    } else {
        finalResponse = responseData;
    }

    return { response: finalResponse, requestPayload: requestPayload };
}

// Normalize cloud LLM response to match local parsing logic
function normalizeCloudLLMResponse(rawResponse, fields) {
    console.log('Cloud runner normalizing LLM response:', rawResponse);

    // Handle responses with "evaluation" wrapper (newer format)
    let dataToProcess = rawResponse;
    if (rawResponse.evaluation && typeof rawResponse.evaluation === 'object') {
        dataToProcess = rawResponse.evaluation;
        console.log('Cloud runner: Found evaluation wrapper, processing inner data');
    }

    const normalized = { evaluation: {} };
    const fieldNames = fields.map(f => f.name);

    for (const fieldName of fieldNames) {
        const fieldData = dataToProcess[fieldName];
        let result = null;
        let probability = null;

        if (fieldData !== undefined) {
            // Handle LLM array format: [boolean, probability]
            if (Array.isArray(fieldData) && fieldData.length >= 1) {
                result = fieldData[0];
                probability = fieldData.length > 1 ? fieldData[1] : 0.8;
            }
            // Handle {result: boolean, confidence: number} format from Gemini and other LLMs
            else if (typeof fieldData === 'object' && fieldData.result !== undefined) {
                result = fieldData.result;
                probability = fieldData.confidence || fieldData.probability || 0.8;
            }
            // Handle legacy {boolean: boolean, probability: number} format
            else if (typeof fieldData === 'object' && fieldData.boolean !== undefined) {
                result = fieldData.boolean;
                probability = fieldData.probability || 0.8;
            }
            // Handle direct boolean
            else if (typeof fieldData === 'boolean') {
                result = fieldData;
                probability = 0.8;
            }

            if (result !== null) {
                // Convert to our standard array format
                normalized.evaluation[fieldName] = [result, probability];
                console.log(`Cloud runner normalized field "${fieldName}": [${result}, ${probability}]`);
            }
        }
    }

    // Preserve summary/reason
    if (rawResponse.summary) {
        normalized.reason = rawResponse.summary;
    } else if (rawResponse.reason) {
        normalized.reason = rawResponse.reason;
    }

    console.log('Cloud runner final normalized response:', normalized);
    return normalized;
}

app.listen(port, () => {
    console.log(`Cloud runner listening on port ${port}`);
    jobScheduler.start();
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    jobScheduler.stop();
    app.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});
