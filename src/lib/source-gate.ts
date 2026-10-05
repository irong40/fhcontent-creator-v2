import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The source gate, asked before anything leaves.
 *
 * The database refuses to move a topic toward publication unless its newest outside source
 * check is a pass (supabase/migrations/20261004232349_topic_source_gate.sql). A Codex review
 * on 2026-10-05 found that the publish step posted first and updated the topic's status
 * afterwards, so that refusal came too late to stop a post. This asks the same question up
 * front, through public.topic_source_cleared, the database function the rule lives in.
 *
 * It fails closed. If the question cannot be asked, nothing is published.
 */
export const SOURCE_CHECK_REQUIRED = 'Source check required';

export const SOURCED_NO_QUICK_POST =
    'This persona publishes only topics that passed a source check. Quick Post is off for it.';

export const SOURCED_NO_LECTURE =
    'This persona takes its topics from sourced candidates. A lecture script written by a model is not one of them.';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = Pick<SupabaseClient<any, any, any>, 'rpc'>;

export async function sourceCleared(
    supabase: Db,
    topicId: string,
): Promise<{ cleared: true } | { cleared: false; reason: string }> {
    const { data, error } = await supabase.rpc('topic_source_cleared', { p_topic: topicId });
    if (error) {
        return {
            cleared: false,
            reason: `${SOURCE_CHECK_REQUIRED}: the source check could not be read (${error.message}). Nothing was published.`,
        };
    }
    if (data !== true) {
        return {
            cleared: false,
            reason: `${SOURCE_CHECK_REQUIRED}: this topic has no passing source check. Nothing was published.`,
        };
    }
    return { cleared: true };
}
