/**
 * COO Daily Publish Report
 *
 * After the last publish cycle completes (all topics resolved),
 * generates a summary report and writes it to the publish_reports table.
 *
 * The COO daily standup trigger reads this table each morning.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Log newly published topics to the publish_reports table for COO consumption.
 */
export async function logPublishReport(
    supabase: SupabaseClient,
    publishedTopicIds: string[],
): Promise<number> {
    if (publishedTopicIds.length === 0) return 0;

    let logged = 0;

    for (const topicId of publishedTopicIds) {
        // Fetch topic with persona and pieces
        const { data: topic } = await supabase
            .from('topics')
            .select('id, title, source_verified, requires_review, persona_id, personas(name)')
            .eq('id', topicId)
            .single();

        if (!topic) continue;

        // Fetch all pieces to tally platform results
        const { data: pieces } = await supabase
            .from('content_pieces')
            .select('published_platforms')
            .eq('topic_id', topicId);

        const published: Set<string> = new Set();
        const failed: Set<string> = new Set();

        if (pieces) {
            for (const piece of pieces) {
                const platforms = (piece.published_platforms || {}) as Record<string, { status: string }>;
                for (const [platform, ps] of Object.entries(platforms)) {
                    if (ps.status === 'published') published.add(platform);
                    if (ps.status === 'failed') failed.add(platform);
                }
            }
        }

        const persona = topic.personas as unknown as { name: string } | null;

        const { error } = await supabase.from('publish_reports').insert({
            persona_id: topic.persona_id,
            topic_id: topic.id,
            topic_title: topic.title,
            platforms_published: Array.from(published),
            platforms_failed: Array.from(failed),
            source_verified: topic.source_verified ?? false,
            required_review: topic.requires_review ?? false,
        });

        if (error) {
            console.error(`Failed to log publish report for topic ${topicId}:`, error.message);
        } else {
            logged++;
            console.log(`[COO Report] ${persona?.name || 'Unknown'} → "${topic.title}" → ${published.size} platforms published, ${failed.size} failed`);
        }
    }

    return logged;
}

/**
 * Get today's publish report for COO standup consumption.
 */
export async function getTodaysPublishReport(supabase: SupabaseClient) {
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
        .from('publish_reports')
        .select('*')
        .eq('report_date', today)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Failed to fetch publish report:', error.message);
        return [];
    }

    return data || [];
}
