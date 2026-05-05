/**
 * COO Weekly Preview
 *
 * Sent Sunday 12:00 UTC (8 AM ET), AFTER daily-topic fires its weekly batch
 * at 02:00 UTC. Shows Adam the full week's content plan in one email so he
 * has a single decision point: let it run, or pull the cord on something.
 *
 * Sections:
 *   1. Week ahead — every topic auto-approved this Sunday, grouped by persona,
 *      with publish_date Mon→Sun
 *   2. Held for review — guardrail-flagged topics that won't ship without
 *      manual approval
 *   3. Last week's recap — topics that actually published in the prior 7 days
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export async function sendCooWeeklyPreview(supabase: SupabaseClient): Promise<boolean> {
    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.NOTIFICATION_EMAIL;
    if (!apiKey || !to) {
        console.warn('[Weekly Preview] RESEND_API_KEY or NOTIFICATION_EMAIL not set — skipped');
        return false;
    }

    const nowMs = Date.now();
    const today = new Date(nowMs).toISOString().split('T')[0];
    const eightHoursAgo = new Date(nowMs - 8 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Week ahead — auto-approved in the last 8 hours (post-Sunday-batch)
    const { data: weekAhead } = await supabase
        .from('topics')
        .select('id, title, hook, publish_date, persona_id, personas(name, brand)')
        .gte('coo_auto_approved_at', eightHoursAgo)
        .order('publish_date', { ascending: true });

    // 2. Held for review (created in last 8 hours)
    const { data: heldForReview } = await supabase
        .from('topics')
        .select('id, title, review_reason, persona_id, personas(name, brand)')
        .eq('requires_review', true)
        .gte('created_at', eightHoursAgo)
        .order('persona_id');

    // 3. Last week's published recap
    const { data: lastWeekPublished } = await supabase
        .from('topics')
        .select('id, title, persona_id, published_at, personas(name)')
        .eq('status', 'published')
        .gte('published_at', sevenDaysAgo)
        .order('published_at', { ascending: false });

    const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const personaName = (t: { personas?: unknown }): string => {
        const p = t.personas as { name?: string } | null;
        return p?.name ?? 'Unknown';
    };

    type WeekTopic = NonNullable<typeof weekAhead>[number];
    const grouped = new Map<string, WeekTopic[]>();
    for (const t of (weekAhead || [])) {
        const k = personaName(t);
        if (!grouped.has(k)) grouped.set(k, []);
        grouped.get(k)!.push(t);
    }

    const dayName = (dateStr: string | null) => {
        if (!dateStr) return '—';
        const d = new Date(dateStr + 'T00:00:00Z');
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    };

    const weekAheadSections = Array.from(grouped.entries()).map(([persona, topics]) => {
        const rows = topics.map(t => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #e8ddd0;font-weight:600;width:100px;color:#753679;">${dayName(t.publish_date)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e8ddd0;">${t.title}</td>
        </tr>`).join('');
        return `
      <h3 style="font-size:11pt;color:#2b0a3d;margin:20px 0 6px 0;">${persona} &mdash; ${topics.length} topics</h3>
      <table style="width:100%;border-collapse:collapse;font-size:10pt;">${rows}</table>`;
    }).join('');

    const reviewRows = (heldForReview || []).map(t => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e8ddd0;font-weight:600;">${personaName(t)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e8ddd0;">${t.title}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e8ddd0;font-size:9.5pt;color:#c44a1a;">${t.review_reason || 'Guardrail flagged'}</td>
      </tr>`).join('');

    const recapRows = (lastWeekPublished || []).map(t => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e8ddd0;font-weight:600;width:120px;color:#64607a;font-size:9.5pt;">${dayName(t.published_at?.split('T')[0] ?? null)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e8ddd0;">${t.title}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e8ddd0;font-size:9.5pt;color:#64607a;">${personaName(t)}</td>
      </tr>`).join('');

    const noActivity = (weekAhead?.length ?? 0) === 0 && (heldForReview?.length ?? 0) === 0;

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

  <div style="font-size:14pt;font-weight:700;color:#2b0a3d;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;">COO Weekly Preview &mdash; ${dateLabel}</div>

  <p style="color:#64607a;font-size:10pt;font-style:italic;margin-top:0;">
    The week ahead. Auto-approved topics will publish on the dates shown.
    Reply to this email or visit /admin to override anything before Monday morning.
  </p>

  <div style="display:flex;gap:16px;margin:20px 0;">
    <div style="flex:1;background:#f0faf4;border-radius:6px;padding:12px 16px;text-align:center;">
      <div style="font-size:22pt;font-weight:700;color:#2d7a3a;">${weekAhead?.length ?? 0}</div>
      <div style="font-size:9pt;color:#2d7a3a;">Scheduled This Week</div>
    </div>
    <div style="flex:1;background:#fff8e8;border-radius:6px;padding:12px 16px;text-align:center;">
      <div style="font-size:22pt;font-weight:700;color:#dfae62;">${heldForReview?.length ?? 0}</div>
      <div style="font-size:9pt;color:#b5850a;">Held for Review</div>
    </div>
    <div style="flex:1;background:#f5f0fa;border-radius:6px;padding:12px 16px;text-align:center;">
      <div style="font-size:22pt;font-weight:700;color:#2b0a3d;">${lastWeekPublished?.length ?? 0}</div>
      <div style="font-size:9pt;color:#753679;">Published Last 7d</div>
    </div>
  </div>

  ${noActivity ? `
  <div style="background:#fff0ef;border-left:4px solid #c44a1a;padding:12px 16px;margin:16px 0;">
    <strong style="color:#c44a1a;">No topics generated this Sunday.</strong>
    Check the Vercel logs for daily-topic; AUTO_TOPIC_PERSONA_IDS may be empty or all configured personas failed.
  </div>` : ''}

  ${(weekAhead?.length ?? 0) > 0 ? `
  <h2 style="font-size:12pt;color:#2b0a3d;border-bottom:1px solid #dfae62;padding-bottom:4px;margin:24px 0 8px 0;">Week Ahead &mdash; Auto-Approved by COO</h2>
  ${weekAheadSections}` : ''}

  ${(heldForReview?.length ?? 0) > 0 ? `
  <h2 style="font-size:12pt;color:#b5850a;border-bottom:1px solid #dfae62;padding-bottom:4px;margin:24px 0 8px 0;">Held for Your Review</h2>
  <p style="font-size:9.5pt;color:#64607a;margin:0 0 8px 0;">Guardrail (NotebookLM) flagged these. They will NOT publish until approved at /admin/topics.</p>
  <table style="width:100%;border-collapse:collapse;font-size:10pt;">
    <thead><tr>
      <th style="background:#dfae62;color:#2b0a3d;padding:8px 12px;text-align:left;font-size:9.5pt;">Persona</th>
      <th style="background:#dfae62;color:#2b0a3d;padding:8px 12px;text-align:left;font-size:9.5pt;">Topic</th>
      <th style="background:#dfae62;color:#2b0a3d;padding:8px 12px;text-align:left;font-size:9.5pt;">Reason</th>
    </tr></thead>
    <tbody>${reviewRows}</tbody>
  </table>` : ''}

  ${(lastWeekPublished?.length ?? 0) > 0 ? `
  <h2 style="font-size:12pt;color:#2b0a3d;border-bottom:1px solid #dfae62;padding-bottom:4px;margin:24px 0 8px 0;">Last Week's Recap</h2>
  <table style="width:100%;border-collapse:collapse;font-size:10pt;">${recapRows}</table>` : ''}

  <div style="border-top:2px solid #dfae62;padding-top:10px;margin-top:40px;font-size:8pt;color:#64607a;">
    Faith &amp; Harmony LLC &mdash; faithandharmonyllc.com
    <div style="font-size:7.5pt;color:#b5a99a;margin-top:4px;">Automated by Content Command Center. Sent every Sunday at 8 AM ET.</div>
  </div>

</body>
</html>`;

    const subject = `[Weekly Preview] ${today} — ${weekAhead?.length ?? 0} scheduled · ${heldForReview?.length ?? 0} review · ${lastWeekPublished?.length ?? 0} shipped last week`;

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
            console.error(`[Weekly Preview] Resend error ${response.status}: ${await response.text()}`);
            return false;
        }

        console.log(`[Weekly Preview] Sent: ${weekAhead?.length ?? 0} scheduled, ${heldForReview?.length ?? 0} review, ${lastWeekPublished?.length ?? 0} recap`);
        return true;
    } catch (e) {
        console.error('[Weekly Preview] Failed to send email:', e);
        return false;
    }
}
