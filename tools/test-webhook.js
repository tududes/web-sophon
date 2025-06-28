#!/usr/bin/env node

// Test script for webhook functionality
import { testDiscordWebhook, fireFieldWebhook } from '../cloud_runner/utils/webhook-utils.js';

// Get webhook URL from command line argument
const webhookUrl = process.argv[2];

if (!webhookUrl) {
    console.error('Usage: node test-webhook.js <webhook-url>');
    console.error('Example: node test-webhook.js https://discord.com/api/webhooks/123/abc');
    process.exit(1);
}

async function runTests() {
    console.log('Testing WebSophon webhook functionality...\n');
    console.log('Webhook URL:', webhookUrl);
    console.log('\n');

    // Test 1: Basic Discord webhook test
    console.log('Test 1: Testing webhook connectivity...');
    const testResult = await testDiscordWebhook(webhookUrl, '🚀 WebSophon webhook integration test!');

    if (testResult.success) {
        console.log('✅ Webhook test successful!');
        console.log(`   Status: ${testResult.status} ${testResult.statusText}`);
    } else {
        console.log('❌ Webhook test failed!');
        console.log(`   Error: ${testResult.error}`);
    }

    console.log('\n---\n');

    // Test 2: Field webhook with TRUE result
    console.log('Test 2: Testing field webhook (TRUE result)...');
    const fieldResultTrue = await fireFieldWebhook(
        'test_field',
        webhookUrl,
        null, // No custom payload, will use Discord format if applicable
        [true, 0.95], // Result: true, Confidence: 95%
        { domain: 'example.com', jobId: 'test-job-123' }
    );

    if (fieldResultTrue.success) {
        console.log('✅ Field webhook (TRUE) sent successfully!');
        console.log(`   Status: ${fieldResultTrue.httpStatus}`);
    } else {
        console.log('❌ Field webhook (TRUE) failed!');
        console.log(`   Error: ${fieldResultTrue.error}`);
    }

    console.log('\n---\n');

    // Test 3: Field webhook with FALSE result
    console.log('Test 3: Testing field webhook (FALSE result)...');
    const fieldResultFalse = await fireFieldWebhook(
        'another_test_field',
        webhookUrl,
        null, // No custom payload, will use Discord format if applicable
        [false, 0.72], // Result: false, Confidence: 72%
        { domain: 'test.com', jobId: 'test-job-456' }
    );

    if (fieldResultFalse.success) {
        console.log('✅ Field webhook (FALSE) sent successfully!');
        console.log(`   Status: ${fieldResultFalse.httpStatus}`);
    } else {
        console.log('❌ Field webhook (FALSE) failed!');
        console.log(`   Error: ${fieldResultFalse.error}`);
    }

    console.log('\n---\n');

    // Test 4: Custom payload test (only for Discord webhooks)
    if (webhookUrl.includes('discord.com/api/webhooks')) {
        console.log('Test 4: Testing webhook with custom Discord payload...');
        const customPayload = JSON.stringify({
            username: 'WebSophon Custom Test',
            content: '🎨 Custom formatted message!',
            embeds: [{
                title: 'Custom Embed Test',
                description: 'This tests custom Discord payload formatting',
                color: 0xff6b6b, // Red color
                fields: [
                    { name: 'Test Type', value: 'Custom Payload', inline: true },
                    { name: 'Timestamp', value: new Date().toLocaleString(), inline: true }
                ]
            }]
        });

        const customResult = await fireFieldWebhook(
            'custom_field',
            webhookUrl,
            customPayload,
            [true, 0.88],
            { domain: 'custom.test', jobId: 'custom-123' }
        );

        if (customResult.success) {
            console.log('✅ Custom webhook sent successfully!');
            console.log(`   Status: ${customResult.httpStatus}`);
        } else {
            console.log('❌ Custom webhook failed!');
            console.log(`   Error: ${customResult.error}`);
        }

        console.log('\n---\n');
    }

    console.log('All tests completed!');
}

// Run the tests
runTests().catch(error => {
    console.error('Test runner error:', error);
    process.exit(1);
}); 