import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Sourced topics.
 *
 * Until 2026-10-05 every topic was written by a model from memory in one call, and the model
 * filled in each point's "source" the same way it filled in the claim. An outside check of
 * the 17 History Unveiled VA texts then waiting for review found no point supported by any
 * source, and the first Freedom Voices quotes checked were misworded or credited to the
 * wrong speech.
 *
 * A persona whose content_guardrail is 'sourced' no longer gets topics that way. The office
 * writes them from real pages in a loop a program judges (agent-office/cron-agents/lib/
 * fh_topic_loop.py) and files the ones that pass in public.topic_candidates. Each point
 * carries the page address and the passage it rests on. This module is how the app takes
 * them. It never asks a model for a topic, and when no candidate is ready it creates none.
 */
export const SOURCED_GUARDRAIL = 'sourced';

export const NO_CANDIDATES =
    'Sourced persona: no topic candidates are ready, so no topics were created. Nothing was invented.';

export const SOURCED_ON_DEMAND =
    'This persona takes its topics from sourced candidates written by the office topic loop. The weekly run adds them; none are written on demand.';

export function isSourced(persona: { content_guardrail?: string | null }): boolean {
    return (persona.content_guardrail ?? '').trim().toLowerCase() === SOURCED_GUARDRAIL;
}

const sourcedPointSchema = z.object({
    point: z.number().int().min(1).max(4),
    claim: z.string().trim().min(1),
    source: z.string().trim().min(1),
    year: z.string(),
    url: z.string().url(),
    quote: z.string().trim().min(1),
});

export const sourcedPointsSchema = z.array(sourcedPointSchema).length(4);
export type SourcedPoint = z.infer<typeof sourcedPointSchema>;

export interface SourcedTopic {
    candidateId: string;
    title: string;
    hook: string;
    historicalPoints: SourcedPoint[];
    thumbnailPrompt?: string;
}

// topic_candidates belongs to the office and is not in the generated Database type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = Pick<SupabaseClient<any, any, any>, 'from'>;

/**
 * Up to `count` ready candidates for a persona, oldest first. A row that does not carry four
 * sourced points is skipped and reported, never repaired.
 */
export async function takeCandidates(
    supabase: Db,
    personaId: string,
    count: number,
): Promise<{ topics: SourcedTopic[]; problems: string[] }> {
    const { data, error } = await supabase
        .from('topic_candidates')
        .select('id, title, hook, historical_points, thumbnail_prompt')
        .eq('persona_id', personaId)
        .eq('status', 'ready')
        .order('created_at', { ascending: true })
        .limit(count * 2);

    if (error) {
        return { topics: [], problems: [`Topic candidates could not be read: ${error.message}`] };
    }

    const topics: SourcedTopic[] = [];
    const problems: string[] = [];
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        if (topics.length >= count) break;
        const title = typeof row.title === 'string' ? row.title.trim() : '';
        const hook = typeof row.hook === 'string' ? row.hook.trim() : '';
        const points = sourcedPointsSchema.safeParse(row.historical_points);
        if (!title || !hook || !points.success) {
            problems.push(`Topic candidate ${String(row.id)} skipped: it does not carry a title, a hook and four sourced points`);
            continue;
        }
        topics.push({
            candidateId: String(row.id),
            title,
            hook,
            historicalPoints: points.data,
            thumbnailPrompt: typeof row.thumbnail_prompt === 'string' && row.thumbnail_prompt.trim()
                ? row.thumbnail_prompt.trim()
                : undefined,
        });
    }
    return { topics, problems };
}

/** Mark a candidate used (it became a topic) or discarded (the duplicate check refused it). */
export async function settleCandidate(
    supabase: Db,
    candidateId: string,
    outcome: { topicId: string } | { discarded: true },
): Promise<void> {
    const now = new Date().toISOString();
    const patch = 'topicId' in outcome
        ? { status: 'used', used_at: now, topic_id: outcome.topicId }
        : { status: 'discarded', used_at: now };
    const { error } = await supabase
        .from('topic_candidates')
        .update(patch)
        .eq('id', candidateId)
        .eq('status', 'ready');
    if (error) {
        console.error(`Topic candidate ${candidateId} could not be settled:`, error.message);
    }
}

/**
 * The rule a script writer gets when its points came from the loop. Returns '' for a topic
 * with no source passages, so an unsourced persona's prompt is unchanged.
 */
export function sourceDiscipline(points: Array<{ quote?: string | null }>): string {
    if (!points.some(p => p.quote && p.quote.trim())) return '';
    return `
SOURCE DISCIPLINE (these points were written from real source passages, and a fact checker reads your text against them):
- Every fact, name, number, date and place in every script, caption and title must come from the points above. Add none from memory.
- You may explain, connect and react. You may not add an event, a statistic, a quotation, a cause, or a "first", "only" or "largest" that the points do not state.
- Do not put words in anyone's mouth. Quote a person only with words that appear in a point or a source passage.
- If the points are too thin for the word count, write a shorter piece.
`;
}
