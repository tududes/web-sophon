// SAPIENT Protocol Parser v1.0
// Shared implementation for both local extension and cloud runner

export class SAPIENTParser {
    constructor() {
        // Compiled regex patterns
        this.HEADER_PATTERN = /^::SAPIENT v:(\S+)\s*(.*?)::$/;
        this.BLOCK_START_PATTERN = /^::(\w+):(\w+)(?:\s+(.*))?::$/;
        this.BLOCK_END_PATTERN = /^::END:(\w+)::$/;
        this.MESSAGE_END_PATTERN = /^::END:SAPIENT::$/;
        this.KEY_VALUE_PATTERN = /(\w+):([^:\s]+(?:\s+[^:\s]+)*?)(?=\s+\w+:|$)/g;
    }

    /**
     * Parse a SAPIENT message
     * @param {string} content - The raw message content
     * @returns {Object|null} Parsed message or null if not SAPIENT format
     */
    parse(content) {
        // Quick check if it's SAPIENT format
        if (!content.includes('::SAPIENT v:')) {
            return null;
        }

        const lines = content.split('\n');
        const result = {
            version: '',
            headers: {},
            body: [],
            blocks: {},
            raw: content
        };

        let state = 'EXPECT_HEADER';
        let currentBlock = null;
        let currentBlockType = null;
        let blockContentLines = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (state === 'EXPECT_HEADER') {
                const headerMatch = line.match(this.HEADER_PATTERN);
                if (headerMatch) {
                    result.version = headerMatch[1];
                    result.headers = this.parseKeyValuePairs(headerMatch[2] || '');
                    state = 'IN_BODY';
                }
            } else if (state === 'IN_BODY') {
                if (line.startsWith('::')) {
                    // Check for message end
                    if (this.MESSAGE_END_PATTERN.test(line)) {
                        state = 'COMPLETE';
                        break;
                    }

                    // Check for block start
                    const blockMatch = line.match(this.BLOCK_START_PATTERN);
                    if (blockMatch) {
                        const [_, blockType, blockName, metadataStr] = blockMatch;
                        currentBlock = blockName;
                        currentBlockType = blockType;
                        blockContentLines = [];

                        result.blocks[blockName] = {
                            type: blockType,
                            metadata: this.parseKeyValuePairs(metadataStr || ''),
                            content: ''
                        };

                        state = 'IN_BLOCK';
                        continue;
                    }
                }

                // Regular body content
                result.body.push(line);
            } else if (state === 'IN_BLOCK') {
                const endMatch = line.match(this.BLOCK_END_PATTERN);
                if (endMatch && endMatch[1] === currentBlock) {
                    // End of current block
                    result.blocks[currentBlock].content = blockContentLines.join('\n');
                    currentBlock = null;
                    currentBlockType = null;
                    blockContentLines = [];
                    state = 'IN_BODY';
                } else {
                    // Block content
                    blockContentLines.push(line);
                }
            }
        }

        // Finalize body
        result.body = result.body.join('\n').trim();

        // If we didn't find a valid SAPIENT message, return null
        if (!result.version) {
            return null;
        }

        return result;
    }

    /**
     * Parse space-separated key:value pairs
     * @param {string} text - The text containing key:value pairs
     * @returns {Object} Parsed key-value pairs
     */
    parseKeyValuePairs(text) {
        const pairs = {};
        if (!text) return pairs;

        // Reset regex state
        this.KEY_VALUE_PATTERN.lastIndex = 0;

        let match;
        while ((match = this.KEY_VALUE_PATTERN.exec(text)) !== null) {
            const key = match[1];
            const value = match[2].trim();
            pairs[key] = value;
        }

        return pairs;
    }

    /**
     * Extract field evaluations and reasoning from SAPIENT message
     * @param {Object} sapientMessage - Parsed SAPIENT message
     * @returns {Object} Normalized response with evaluation and reason/summary
     */
    extractEvaluationData(sapientMessage) {
        const normalized = {
            evaluation: {},
            summary: ''
        };

        // Look for evaluation data block
        for (const [blockName, block] of Object.entries(sapientMessage.blocks)) {
            if (block.type === 'DATA' && (blockName === 'evaluation' || blockName === 'field_results')) {
                try {
                    const evalData = JSON.parse(block.content);

                    // Convert to our standard format [boolean, confidence]
                    for (const [fieldName, fieldData] of Object.entries(evalData)) {
                        if (fieldData && typeof fieldData === 'object' &&
                            'result' in fieldData && 'confidence' in fieldData) {
                            normalized.evaluation[fieldName] = [
                                fieldData.result,
                                fieldData.confidence
                            ];
                        }
                    }
                } catch (e) {
                    console.error('Failed to parse evaluation data:', e);
                }
            } else if (block.type === 'DATA' && blockName === 'reasoning') {
                // Some LLMs might put reasoning in a data block
                normalized.summary = block.content.trim();
            }
        }

        // The body often contains the reasoning/summary
        if (!normalized.summary && sapientMessage.body) {
            normalized.summary = sapientMessage.body;
        }

        // Convert evaluation object to our array format
        const arrayFormat = {};
        for (const [fieldName, value] of Object.entries(normalized.evaluation)) {
            arrayFormat[fieldName] = value;
        }

        // Return in the expected format with summary
        return {
            ...arrayFormat,
            summary: normalized.summary
        };
    }
}

/**
 * Convenience function to parse SAPIENT and extract evaluation data
 * @param {string} content - Raw SAPIENT message
 * @returns {Object|null} Extracted evaluation data or null
 */
export function parseSAPIENTResponse(content) {
    const parser = new SAPIENTParser();
    const sapientMessage = parser.parse(content);

    if (!sapientMessage) {
        return null;
    }

    return parser.extractEvaluationData(sapientMessage);
}

/**
 * Build a simple SAPIENT message
 * @param {Object} options - Message options
 * @returns {string} SAPIENT formatted message
 */
export function buildSAPIENTMessage(options = {}) {
    const {
        from = 'user',
        to = 'assistant',
        body = '',
        trace = Date.now().toString(),
        blocks = []
    } = options;

    let message = `::SAPIENT v:1.0 from:${from} to:${to} trace:${trace}::\n`;

    if (body) {
        message += body + '\n';
    }

    for (const block of blocks) {
        const metaPairs = Object.entries(block.metadata || {})
            .map(([k, v]) => `${k}:${v}`)
            .join(' ');

        message += `\n::${block.type}:${block.name}${metaPairs ? ' ' + metaPairs : ''}::\n`;
        message += block.content;
        message += `\n::END:${block.name}::\n`;
    }

    message += '::END:SAPIENT::';
    return message;
} 