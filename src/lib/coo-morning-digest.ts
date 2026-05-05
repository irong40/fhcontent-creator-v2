/**
 * COO Morning Digest
 *
 * Sent at 7 AM ET each day, AFTER daily-topic (02:00 UTC) and daily-media (06:00 UTC)
 * have run for the day, but BEFORE daily-publish ships those topics (they're scheduled
 * for tomorrow, not today). Gives Adam a 24-hour window to read this digest and pull
 * the cord on anything weird before it actually ships.
 *
 * Sections:
 *   1. Auto-approved by COO (will publish tomorrow) — title, persona, hook
 *   2. Held for review (guardrail flagged) — title, persona, reason
 *   3. Errors from last 24h cron runs
 *   4. Today's publish queue (already-scheduled, going out today)
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export async function sendCooMorningDigest(supabase: SupabaseClient): Promise<boolean> {
    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.NOTIFICATION_EMAIL;
    if (!apiKey || !to) {
        console.warn('[Morning Digest] RESEND_API_KEY or NOTIFICATION_EMAIL not set — skipped');
        return false;
    }

    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // 1. Auto-approved by COO in the last 24h, scheduled for tomorrow
    const { data: autoApproved } = await supabase
        .from('topics')
        .select('id, title, hook, persona_id, scheduled:publish_date, personas(name, brand)')
        .gte('coo_auto_approved_at', yesterday)
        .order('coo_auto_approved_at', { ascending: false });

    // 2. Held for review
    const { data: heldForReview } = await supabase
        .from('topics')
        .select('id, title, review_reason, persona_id, personas(name, brand)')
        .eq('requires_review', true)
        .gte('created_at', yesterday)
        .order('created_at', { ascending: false });

    // 3. Today's publish queue (scheduled for today, going out)
    const { data: shippingToday } = await supabase
        .from('topics')
        .select('id, title, persona_id, personas(name, brand)')
        .in('status', ['scheduled', 'approved'])
        .eq('publish_date', today)
        .order('persona_id');

    // 4. Errors from cost_tracking? No, errors aren't in that table. Pull from any
    //    topic that errored in last 24h (status = draft after a failed flow).
    //    Conservative — just count.
    const { data: erroredTopics } = await supabase
        .from('topics')
        .select('id, title, personas(name)')
        .eq('status', 'draft')
        .gte('updated_at', yesterday);

    const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const personaName = (t: { personas?: unknown }): string => {
        const p = t.personas as { name?: string } | null;
        return p?.name ?? 'Unknown';
    };

    const autoApprovedRows = (autoApproved || []).map(t => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e8ddd0;font-weight:600;">${personaName(t)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e8ddd0;">${t.title}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e8ddd0;font-size:9.5pt;color:#64607a;font-style:italic;">${(t.hook || '').slice(0, 120)}${(t.hook || '').length > 120 ? '...' : ''}</td>
      </tr>`).join('');

    const reviewRows = (heldForReview || []).map(t => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e8ddd0;font-weight:600;">${personaName(t)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e8ddd0;">${t.title}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e8ddd0;font-size:9.5pt;color:#c44a1a;">${t.review_reason || 'Guardrail flagged'}</td>
      </tr>`).join('');

    const shippingRows = (shippingToday || []).map(t => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e8ddd0;font-weight:600;">${personaName(t)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e8ddd0;">${t.title}</td>
      </tr>`).join('');

    const noActivity = (autoApproved?.length ?? 0) === 0 && (heldForReview?.length ?? 0) === 0 && (shippingToday?.length ?? 0) === 0;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Georgia,'Times New Roman',serif;font-size:11pt;line-height:1.5;color:#1a1a1a;background:#ffffff;max-width:800px;margin:0 auto;padding:24px;">

  <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;border-bottom:3px solid #dfae62;margin-bottom:24px;">
    <div>
      <div style="font-size:18pt;font-weight:700;color:#2b0a3d;letter-spacing:0.5px;">Faith &amp; Harmony LLC</div>
      <div style="font-size:9pt;color:#753679;font-style:italic;">Veteran-Owned Professional Services</div>
    </div>
    <div style="text-align:right;font-size:8.5pt;color:#64607a;line-height:1.6;">
      Hampton Roads, Virginia<br>
      info@faithandharmonyllc.com
    </div>
  </div>

  <div style="font-size:14pt;font-weight:700;color:#2b0a3d;text-transform:uppercase;letter-spacing:1px;margin-bottom:20px;">COO Morning Digest &mdash; ${dateLabel}</div>

  <p style="color:#64607a;font-size:10pt;font-style:italic;margin-top:0;">
    Auto-approved topics ship tomorrow (${tomorrow}). You have until then to pull the cord on any of the items below.
    Reply to this email or visit /admin to override.
  </p>

  <div style="display:flex;gap:16px;margin:20px 0;">
    <div style="flex:1;background:#f0faf4;border-radius:6px;padding:12px 16px;text-align:center;">
      <div style="font-size:22pt;font-weight:700;color:#2d7a3a;">${autoApproved?.length ?? 0}</div>
      <div style="font-size:9pt;color:#2d7a3a;">Auto-Approved</div>
    </div>
    <div style="flex:1;background:#fff8e8;border-radius:6px;padding:12px 16px;text-align:center;">
      <div style="font-size:22pt;font-weight:700;color:#dfae62;">${heldForReview?.length ?? 0}</div>
      <div style="font-size:9pt;color:#b5850a;">Held for Review</div>
    </div>
    <div style="flex:1;background:#f5f0fa;border-radius:6px;padding:12px 16px;text-align:center;">
      <div style="font-size:22pt;font-weight:700;color:#2b0a3d;">${shippingToday?.length ?? 0}</div>
      <div style="font-size:9pt;color:#753679;">Shipping Today</div>
    </div>
    <div style="flex:1;background:#fff0ef;border-radius:6px;padding:12px 16px;text-align:center;">
      <div style="font-size:22pt;font-weight:700;color:#c44a1a;">${erroredTopics?.length ?? 0}</div>
      <div style="font-size:9pt;color:#c44a1a;">Errored</div>
    </div>
  </div>

  ${noActivity ? `
  <div style="background:#fff0ef;border-left:4px solid #c44a1a;padding:12px 16px;margin:16px 0;">
    <strong style="color:#c44a1a;">No activity in the last 24 hours.</strong>
    The daily-topic cron may have skipped (check AUTO_TOPIC_PERSONA_IDS env on Vercel) or all configured personas hit duplicate guards. If this persists 2 days, investigate.
  </div>` : ''}

  ${(autoApproved?.length ?? 0) > 0 ? `
  <h2 style="font-size:12pt;color:#2b0a3d;border-bottom:1px solid #dfae62;padding-bottom:4px;margin:24px 0 8px 0;">Auto-Approved by COO &mdash; Shipping ${tomorrow}</h2>
  <p style="font-size:9.5pt;color:#64607a;margin:0 0 8px 0;">These passed guardrail and were promoted to the publish queue automatically.</p>
  <table style="width:100%;border-collapse:collapse;font-size:10pt;">
    <thead><tr>
      <th style="background:#2b0a3d;color:#fff;padding:8px 12px;text-align:left;font-size:9.5pt;">Persona</th>
      <th style="background:#2b0a3d;color:#fff;padding:8px 12px;text-align:left;font-size:9.5pt;">Topic</th>
      <th style="background:#2b0a3d;color:#fff;padding:8px 12px;text-align:left;font-size:9.5pt;">Hook</th>
    </tr></thead>
    <tbody>${autoApprovedRows}</tbody>
  </table>` : ''}

  ${(heldForReview?.length ?? 0) > 0 ? `
  <h2 style="font-size:12pt;color:#b5850a;border-bottom:1px solid #dfae62;padding-bottom:4px;margin:24px 0 8px 0;">Held for Your Review</h2>
  <p style="font-size:9.5pt;color:#64607a;margin:0 0 8px 0;">Guardrail (NotebookLM) flagged these. They will NOT publish until you approve them at /admin/topics.</p>
  <table style="width:100%;border-collapse:collapse;font-size:10pt;">
    <thead><tr>
      <th style="background:#dfae62;color:#2b0a3d;padding:8px 12px;text-align:left;font-size:9.5pt;">Persona</th>
      <th style="background:#dfae62;color:#2b0a3d;padding:8px 12px;text-align:left;font-size:9.5pt;">Topic</th>
      <th style="background:#dfae62;color:#2b0a3d;padding:8px 12px;text-align:left;font-size:9.5pt;">Reason</th>
    </tr></thead>
    <tbody>${reviewRows}</tbody>
  </table>` : ''}

  ${(shippingToday?.length ?? 0) > 0 ? `
  <h2 style="font-size:12pt;color:#2b0a3d;border-bottom:1px solid #dfae62;padding-bottom:4px;margin:24px 0 8px 0;">Shipping Today</h2>
  <table style="width:100%;border-collapse:collapse;font-size:10pt;">
    <thead><tr>
      <th style="background:#2b0a3d;color:#fff;padding:8px 12px;text-align:left;font-size:9.5pt;">Persona</th>
      <th style="background:#2b0a3d;color:#fff;padding:8px 12px;text-align:left;font-size:9.5pt;">Topic</th>
    </tr></thead>
    <tbody>${shippingRows}</tbody>
  </table>` : ''}

  <div style="border-top:2px solid #dfae62;padding-top:10px;margin-top:40px;font-size:8pt;color:#64607a;">
    Faith &amp; Harmony LLC &mdash; faithandharmonyllc.com
    <div style="font-size:7.5pt;color:#b5a99a;margin-top:4px;">Automated by Content Command Center. Sent at 7 AM ET daily.</div>
  </div>

</body>
</html>`;

    const counts = {
        approved: autoApproved?.length ?? 0,
        review: heldForReview?.length ?? 0,
        shipping: shippingToday?.length ?? 0,
    };

    const subject = `[Morning Digest] ${today} — ${counts.approved} approved · ${counts.review} review · ${counts.shipping} ship today`;

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                from: process.env.RESEND_FROM_EMAIL || 'Content Command Center <noreply@faithharmony.com>',
                to,
                subject,
                html,
            }),
        });

        if (!response.ok) {
            console.error(`[Morning Digest] Resend error ${response.status}: ${await response.text()}`);
            return false;
        }

        console.log(`[Morning Digest] Sent: ${counts.approved} approved, ${counts.review} review, ${counts.shipping} shipping today`);
        return true;
    } catch (e) {
        console.error('[Morning Digest] Failed to send email:', e);
        return false;
    }
}
