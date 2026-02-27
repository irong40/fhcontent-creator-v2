-- Phase 2: Error Infrastructure + Observability Tables
-- Creates pipeline_errors, pipeline_runs, pipeline_dlq tables
-- with RLS policies and helper views.

-- ============================================================
-- 1. pipeline_errors — structured error log for workflow failures
-- ============================================================
CREATE TABLE IF NOT EXISTS pipeline_errors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_name   TEXT NOT NULL,
    node_name       TEXT,
    error_message   TEXT NOT NULL,
    execution_id    TEXT,
    correlation_id  TEXT,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pipeline_errors_workflow_time
    ON pipeline_errors (workflow_name, occurred_at DESC);
CREATE INDEX idx_pipeline_errors_correlation
    ON pipeline_errors (correlation_id)
    WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_pipeline_errors_recent
    ON pipeline_errors (occurred_at DESC);

ALTER TABLE pipeline_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role can insert pipeline_errors"
    ON pipeline_errors FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "authenticated can read pipeline_errors"
    ON pipeline_errors FOR SELECT
    TO authenticated
    USING (true);

-- ============================================================
-- 2. pipeline_runs — execution tracking and heartbeat log
-- ============================================================
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id    TEXT,
    workflow_name   TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN (
                        'started', 'completed', 'failed', 'heartbeat'
                    )),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    correlation_id  TEXT
);

CREATE INDEX idx_pipeline_runs_workflow_time
    ON pipeline_runs (workflow_name, started_at DESC);
CREATE INDEX idx_pipeline_runs_status_time
    ON pipeline_runs (status, started_at DESC);
CREATE INDEX idx_pipeline_runs_correlation
    ON pipeline_runs (correlation_id)
    WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_pipeline_runs_heartbeat
    ON pipeline_runs (started_at DESC)
    WHERE status = 'heartbeat';

ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role can insert pipeline_runs"
    ON pipeline_runs FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "service_role can update pipeline_runs"
    ON pipeline_runs FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "authenticated can read pipeline_runs"
    ON pipeline_runs FOR SELECT
    TO authenticated
    USING (true);

-- ============================================================
-- 3. pipeline_dlq — dead-letter queue for failed payloads
-- ============================================================
CREATE TABLE IF NOT EXISTS pipeline_dlq (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_name   TEXT NOT NULL,
    correlation_id  TEXT,
    payload         JSONB NOT NULL DEFAULT '{}',
    error           TEXT NOT NULL,
    failed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retry_count     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_pipeline_dlq_workflow_time
    ON pipeline_dlq (workflow_name, failed_at DESC);
CREATE INDEX idx_pipeline_dlq_correlation
    ON pipeline_dlq (correlation_id)
    WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_pipeline_dlq_retry
    ON pipeline_dlq (retry_count, failed_at DESC);
CREATE INDEX idx_pipeline_dlq_payload
    ON pipeline_dlq USING GIN (payload);

ALTER TABLE pipeline_dlq ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role can insert pipeline_dlq"
    ON pipeline_dlq FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "service_role can update pipeline_dlq"
    ON pipeline_dlq FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "authenticated can read pipeline_dlq"
    ON pipeline_dlq FOR SELECT
    TO authenticated
    USING (true);

-- ============================================================
-- 4. Helper views
-- ============================================================

-- Recent errors in the last 24 hours
CREATE OR REPLACE VIEW v_recent_pipeline_errors AS
SELECT
    id,
    workflow_name,
    node_name,
    error_message,
    execution_id,
    correlation_id,
    occurred_at
FROM pipeline_errors
WHERE occurred_at > NOW() - INTERVAL '24 hours'
ORDER BY occurred_at DESC;

-- Workflow health: last run per workflow
CREATE OR REPLACE VIEW v_workflow_health AS
SELECT DISTINCT ON (workflow_name)
    workflow_name,
    status,
    started_at,
    completed_at,
    execution_id
FROM pipeline_runs
ORDER BY workflow_name, started_at DESC;
