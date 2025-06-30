// Test webhook payload handling
import { fireFieldWebhook } from './cloud_runner/utils/webhook-utils.js';

async function testWebhookPayload() {
    console.log('Testing webhook payload handling...\n');

    const webhookUrl = 'https://discord.com/api/webhooks/1388731353281073192/7YhxPWRQqckH97ddJq2mU2eWX3JQJcoDeZFfh4zqXCCfyN7De_gp7pzRu0eYQOLTeppL';
    const customPayload = '{ "content": "Indicators visible" }';
    const fieldName = 'indicators_visible';
    const fieldResult = [true, 0.95];
    const context = { domain: 'www.tradingview.com', jobId: 'test-job' };

    console.log('Input payload:', customPayload);
    console.log('Firing webhook...\n');

    try {
        const result = await fireFieldWebhook(
            fieldName,
            webhookUrl,
            customPayload,
            fieldResult,
            context
        );

        console.log('\nWebhook result:');
        console.log('Success:', result.success);
        console.log('HTTP Status:', result.httpStatus);
        console.log('Request payload:', result.request.payload);

        if (!result.success) {
            console.log('Error:', result.error);
        }
    } catch (error) {
        console.error('Error firing webhook:', error);
    }
}

testWebhookPayload().catch(console.error); 