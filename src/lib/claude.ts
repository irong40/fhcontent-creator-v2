/**
 * Claude (Anthropic) API Client
 * Uses the official @anthropic-ai/sdk package
 */

import Anthropic from '@anthropic-ai/sdk';

class ClaudeClient {
    private client: Anthropic;

    constructor() {
        this.client = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY || '',
        });
    }

    async testConnection(): Promise<{ ok: boolean; error?: string }> {
        try {
            await this.client.messages.create({
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 10,
                messages: [{ role: 'user', content: 'Hi' }],
            });
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
        }
    }

    async generateContent(
        systemPrompt: string,
        userPrompt: string,
        options?: { model?: string; maxTokens?: number }
    ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
        const response = await this.client.messages.create({
            model: options?.model || 'claude-sonnet-4-5-20250929',
            max_tokens: options?.maxTokens || 4096,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
        });

        const textBlock = response.content.find(b => b.type === 'text');
        return {
            text: textBlock?.type === 'text' ? textBlock.text : '',
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
        };
    }
}

export const claude = new ClaudeClient();
