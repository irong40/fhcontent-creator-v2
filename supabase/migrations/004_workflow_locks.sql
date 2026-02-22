-- Workflow execution locks
-- Prevents concurrent runs of the same cron workflow (daily-media, daily-publish, etc.)

CREATE TABLE workflow_locks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id TEXT NOT NULL UNIQUE,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_token UUID NOT NULL DEFAULT gen_random_uuid(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_workflow_locks_workflow ON workflow_locks(workflow_id);
CREATE INDEX idx_workflow_locks_expires ON workflow_locks(expires_at);

-- RLS
ALTER TABLE workflow_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users have full access to workflow_locks"
    ON workflow_locks FOR ALL TO authenticated USING (true) WITH CHECK (true);
