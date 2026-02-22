import { createAdminClient } from '@/lib/supabase/server';

const LOCK_TTL_MINUTES = 15;

/**
 * Attempts to acquire an exclusive lock for a workflow.
 * Returns a lock_token (UUID) on success, or null if the workflow is already locked.
 */
export async function acquireLock(workflowId: string): Promise<string | null> {
    const supabase = createAdminClient();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LOCK_TTL_MINUTES * 60 * 1000);

    // Clean expired locks for this workflow first
    await supabase
        .from('workflow_locks')
        .delete()
        .eq('workflow_id', workflowId)
        .lt('expires_at', now.toISOString());

    // Try to insert a new lock — UNIQUE constraint on workflow_id prevents duplicates
    const lockToken = crypto.randomUUID();
    const { error } = await supabase
        .from('workflow_locks')
        .insert({
            workflow_id: workflowId,
            lock_token: lockToken,
            locked_at: now.toISOString(),
            expires_at: expiresAt.toISOString(),
        });

    if (error) {
        // 23505 = unique_violation — another lock exists
        if (error.code === '23505') {
            return null;
        }
        console.error(`Failed to acquire lock for ${workflowId}:`, error.message);
        return null;
    }

    return lockToken;
}

/**
 * Releases a workflow lock. Only succeeds if the provided token matches.
 */
export async function releaseLock(workflowId: string, lockToken: string): Promise<void> {
    const supabase = createAdminClient();
    await supabase
        .from('workflow_locks')
        .delete()
        .eq('workflow_id', workflowId)
        .eq('lock_token', lockToken);
}

/**
 * Removes all locks that have exceeded the 15-minute TTL.
 * Called from check-status cron to prevent stale locks from blocking workflows.
 */
export async function cleanStaleLocks(): Promise<number> {
    const supabase = createAdminClient();
    const now = new Date().toISOString();

    const { data } = await supabase
        .from('workflow_locks')
        .select('id')
        .lt('expires_at', now);

    const count = data?.length ?? 0;

    if (count > 0) {
        await supabase
            .from('workflow_locks')
            .delete()
            .lt('expires_at', now);
    }

    return count;
}
