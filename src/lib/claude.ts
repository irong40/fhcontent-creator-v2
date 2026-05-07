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

    /**
     * Audits a generated image against a persona's subject constraint.
     * Returns `{ pass: true }` if the image satisfies the constraint, or
     * `{ pass: false, reason }` if it does not. Uses Haiku for cost efficiency
     * (~$0.001 per image at current pricing).
     *
     * On API error or ambiguous response, defaults to `{ pass: false }` so the
     * piece is held for manual review rather than auto-publishing a violation.
     */
    async auditImageSubjects(
        imageBuffer: ArrayBuffer,
        constraint: string,
        mediaType: 'image/png' | 'image/jpeg' = 'image/png',
    ): Promise<{ pass: boolean; reason?: string }> {
        try {
            const base64 = Buffer.from(imageBuffer).toString('base64');
            const response = await this.client.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 200,
                system:
                    'You audit generated images against editorial constraints. Reply with strict JSON only: ' +
                    '{"pass": boolean, "reason": "short explanation if pass=false, omit if pass=true"}. ' +
                    'When in doubt, fail closed (pass=false) so a human can review.',
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'image',
                                source: { type: 'base64', media_type: mediaType, data: base64 },
                            },
                            {
                                type: 'text',
                                text: `CONSTRAINT:\n${constraint}\n\nDoes this image satisfy the constraint? Reply JSON only.`,
                            },
                        ],
                    },
                ],
            });

            const textBlock = response.content.find(b => b.type === 'text');
            const raw = textBlock?.type === 'text' ? textBlock.text : '';
            const match = raw.match(/\{[\s\S]*\}/);
            if (!match) return { pass: false, reason: 'audit returned non-JSON' };

            const parsed = JSON.parse(match[0]) as { pass: boolean; reason?: string };
            return { pass: parsed.pass === true, reason: parsed.reason };
        } catch (e) {
            return {
                pass: false,
                reason: `audit error: ${e instanceof Error ? e.message : 'unknown'}`,
            };
        }
    }
}

export const claude = new ClaudeClient();
