// Main background service worker entry point
import { CaptureService } from './services/CaptureService.js';
import { WebhookService } from './services/WebhookService.js';
import { LLMService } from './services/LLMService.js';
import { EventService } from './services/EventService.js';
import { MessageService } from './services/MessageService.js';

// Initialize services
console.log('Initializing WebSophon background services...');

// Create service instances
const eventService = new EventService();
const captureService = new CaptureService();
const webhookService = new WebhookService(captureService, eventService);
const llmService = new LLMService(captureService, eventService);
const messageService = new MessageService(captureService, webhookService, eventService, llmService);

// Set up tab cleanup listeners
messageService.setupTabListeners();

console.log('WebSophon background services initialized successfully'); 