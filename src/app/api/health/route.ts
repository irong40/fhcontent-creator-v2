import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { blotato } from '@/lib/blotato';
import { claude } from '@/lib/claude';
import { heygen } from '@/lib/heygen';
import { elevenlabs } from '@/lib/elevenlabs';
import { openai } from '@/lib/openai';
import { gemini } from '@/lib/gemini';

interface ServiceResult {
    status: 'ok' | 'error';
    latencyMs: number;
    error?: string;
}

async function testService(name: string, fn: () => Promise<{ ok: boolean; error?: string }>): Promise<[string, ServiceResult]> {
    const start = Date.now();
    try {
        const result = await fn();
        return [name, {
            status: result.ok ? 'ok' : 'error',
            latencyMs: Date.now() - start,
            error: result.error,
        }];
    } catch (e) {
        return [name, {
            status: 'error',
            latencyMs: Date.now() - start,
            error: e instanceof Error ? e.message : 'Unknown error',
        }];
    }
}

export async function GET() {
    const results = await Promise.all([
        testService('supabase', async () => {
            const supabase = createAdminClient();
            const { error } = await supabase.from('personas').select('id', { count: 'exact', head: true });
            return { ok: !error, error: error?.message };
        }),
        testService('blotato', () => blotato.testConnection()),
        testService('claude', () => claude.testConnection()),
        testService('heygen', () => heygen.testConnection()),
        testService('elevenlabs', () => elevenlabs.testConnection()),
        testService('openai', () => openai.testConnection()),
        testService('gemini', () => gemini.testConnection()),
    ]);

    const services = Object.fromEntries(results);
    const allOk = Object.values(services).every((s) => (s as ServiceResult).status === 'ok');

    return NextResponse.json({
        status: allOk ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        services,
    });
}
