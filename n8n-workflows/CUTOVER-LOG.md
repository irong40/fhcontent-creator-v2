# WF-5 Cutover Log

## Parallel Run Start
- Date: [PENDING — activate WF-5 in n8n UI and record timestamp here]
- WF-5 activated: PENDING
- Vercel check-status cron: ACTIVE (*/10 * * * *)
- Expected parallel run end: 48 hours after start

## Comparison Criteria
1. pipeline_runs rows with workflow_id=WF-5 increment every 10 minutes
2. content_pieces status updates match between n8n-triggered and Vercel-triggered executions
3. No duplicate updates (both systems call same route -- idempotency required)
4. Error rates comparable (check pipeline_errors)

## Verification Queries

### Count WF-5 executions in last 24h
```sql
SELECT COUNT(*) as wf5_runs, MIN(started_at), MAX(started_at)
FROM pipeline_runs
WHERE workflow_id = 'WF-5'
  AND started_at > NOW() - INTERVAL '24 hours';
-- Expected: ~144 runs (every 10 min for 24h)
-- Accept: 130-144 (allows for brief outages)
```

### Check error rate
```sql
SELECT COUNT(*) as errors
FROM pipeline_errors
WHERE workflow_name = 'WF-5'
  AND occurred_at > NOW() - INTERVAL '24 hours';
```

### Check content piece status updates
```sql
SELECT status, COUNT(*)
FROM content_pieces
WHERE updated_at > NOW() - INTERVAL '24 hours'
GROUP BY status;
```

## 24-Hour Check
- WF-5 run count: [N] / 144 expected
- Errors: [N]
- Content pieces updated: [N]
- Issues observed: [none / describe]

## 48-Hour Check
- WF-5 run count: [N] / 288 expected
- Errors: [N]
- Content pieces updated: [N]
- Parity confirmed: [YES / NO]
- Issues observed: [none / describe]

## Cutover Decision
- Human approved: [PENDING]
- Date: [PENDING]

## Cutover Completed
- Date: [PENDING]
- check-status cron removed from vercel.json: [PENDING]
- Deployed to Vercel: [PENDING]
- WF-5 is now sole owner of status polling: [PENDING]
