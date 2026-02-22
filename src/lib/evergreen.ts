import { createAdminClient } from '@/lib/supabase/server';

/**
 * Evergreen Fallback Logic
 *
 * When no topic is scheduled for a given persona on a given date,
 * this selects a previously published evergreen topic and re-schedules it.
 *
 * Selection criteria:
 * - is_evergreen = true
 * - status = 'published' (already has content ready)
 * - Least recently published (LRU)
 */

interface EvergreenResult {
    persona_id: string;
    persona_name: string;
    topic_id: string | null;
    topic_title: string | null;
    action: 'scheduled' | 'no_evergreen' | 'already_scheduled';
}

/**
 * Check each active persona. If they have no topic scheduled for `targetDate`,
 * find an evergreen topic and schedule it.
 */
export async function fillEvergreenGaps(targetDate: string): Promise<EvergreenResult[]> {
    const supabase = createAdminClient();
    const results: EvergreenResult[] = [];

    // Get all active personas
    const { data: personas } = await supabase
        .from('personas')
        .select('id, name')
        .eq('is_active', true);

    if (!personas || personas.length === 0) return results;

    for (const persona of personas) {
        // Check if persona already has a scheduled topic for this date
        const { count } = await supabase
            .from('topics')
            .select('*', { count: 'exact', head: true })
            .eq('persona_id', persona.id)
            .eq('publish_date', targetDate)
            .in('status', ['scheduled', 'publishing', 'published']);

        if (count && count > 0) {
            results.push({
                persona_id: persona.id,
                persona_name: persona.name,
                topic_id: null,
                topic_title: null,
                action: 'already_scheduled',
            });
            continue;
        }

        // Find the least recently published evergreen topic for this persona
        const { data: evergreen } = await supabase
            .from('topics')
            .select('id, title')
            .eq('persona_id', persona.id)
            .eq('is_evergreen', true)
            .eq('status', 'published')
            .order('published_at', { ascending: true, nullsFirst: true })
            .limit(1);

        if (!evergreen || evergreen.length === 0) {
            results.push({
                persona_id: persona.id,
                persona_name: persona.name,
                topic_id: null,
                topic_title: null,
                action: 'no_evergreen',
            });
            continue;
        }

        const topic = evergreen[0];

        // Re-schedule this evergreen topic for the target date
        await supabase
            .from('topics')
            .update({
                publish_date: targetDate,
                status: 'scheduled',
            })
            .eq('id', topic.id);

        results.push({
            persona_id: persona.id,
            persona_name: persona.name,
            topic_id: topic.id,
            topic_title: topic.title,
            action: 'scheduled',
        });
    }

    return results;
}
