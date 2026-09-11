import { config } from 'dotenv';
import { writeFile } from 'node:fs/promises';
import { getOrEnqueueLocalInference, LocalInferencePendingError } from '../src/lib/local-inference-queue';

config({ path: '.env.local', quiet: true });
const request = {
    requestKey: 'deployment-smoke-2026-09-11-v1',
    system: 'Write one short caption using only the supplied facts. Return JSON. This is a review draft.',
    user: 'Synthetic test: SAI documents visible site conditions with aerial photographs. Photographs do not certify safety.',
    maxTokens: 200,
    schema: { type: 'object', properties: { caption: { type: 'string' } }, required: ['caption'], additionalProperties: false },
};
async function main() {
    try {
        const result = await getOrEnqueueLocalInference(request);
        const report = { checkedAt: new Date().toISOString(), provider: 'ollama', model: 'qwen3:8b', boundary: 'Synthetic hosted Supabase queue job, actual host worker and loopback Ollama. No topic, content, media or publishing mutation.', ...result };
        await writeFile('docs/local-inference-hosted-smoke-2026-09-11.json', JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report, null, 2));
    } catch (error) {
        if (error instanceof LocalInferencePendingError) {
            console.log(JSON.stringify({ status: 'queued', jobId: error.jobId }));
            return;
        }
        throw error;
    }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Hosted smoke failed'); process.exitCode = 1; });
