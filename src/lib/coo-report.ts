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
        .select('*, personas(name)')
        .eq('report_date', today)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Failed to fetch publish report:', error.message);
        return [];
    }

    return data || [];
}

/**
 * Get today's total cost from cost_tracking.
 */
async function getTodaysCost(supabase: SupabaseClient): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
        .from('cost_tracking')
        .select('cost_usd')
        .gte('created_at', `${today}T00:00:00Z`)
        .lt('created_at', `${today}T23:59:59Z`);

    if (!data) return 0;
    return data.reduce((sum, row) => sum + (row.cost_usd || 0), 0);
}

/**
 * Build and send the COO Daily Publish Report email via Resend.
 * Called once per day after the overnight pipeline resolves.
 */
export async function sendCooPublishReport(supabase: SupabaseClient): Promise<boolean> {
    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.NOTIFICATION_EMAIL;
    if (!apiKey || !to) {
        console.warn('[COO Report] RESEND_API_KEY or NOTIFICATION_EMAIL not set — email skipped');
        return false;
    }

    const reports = await getTodaysPublishReport(supabase);
    const todayCost = await getTodaysCost(supabase);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const dateKey = new Date().toISOString().split('T')[0];

    const published = reports.filter(r => r.platforms_published && r.platforms_published.length > 0);
    const failed = reports.filter(r => r.platforms_failed && r.platforms_failed.length > 0 && (!r.platforms_published || r.platforms_published.length === 0));
    const reviewNeeded = reports.filter(r => r.required_review);

    const statusBadge = (ok: boolean) => ok
        ? '<span style="color:#2d7a3a;font-weight:600;">PUBLISHED</span>'
        : '<span style="color:#c44a1a;font-weight:600;">FAILED</span>';

    const tableRows = reports.map(r => {
        const persona = (r.personas as unknown as { name: string } | null)?.name ?? 'Unknown';
        const pubPlatforms = (r.platforms_published ?? []).join(', ') || '—';
        const failPlatforms = (r.platforms_failed ?? []).join(', ') || '—';
        const isOk = (r.platforms_published?.length ?? 0) > 0;
        const needsReview = r.required_review
            ? '<span style="color:#dfae62;font-weight:600;">REVIEW NEEDED</span>'
            : '<span style="color:#64607a;">Auto-approved</span>';

        return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e8ddd0;">${persona}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e8ddd0;">${r.topic_title}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e8ddd0;">${statusBadge(isOk)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e8ddd0;font-size:9.5pt;">${pubPlatforms}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e8ddd0;font-size:9.5pt;color:#c44a1a;">${failPlatforms}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e8ddd0;">${needsReview}</td>
        </tr>`;
    }).join('');

    const alertSection = reviewNeeded.length > 0 ? `
    <div style="background:#fff8e8;border-left:4px solid #dfae62;padding:12px 16px;margin:16px 0;">
      <strong style="color:#2b0a3d;">Action Required:</strong>
      ${reviewNeeded.map(r => `<br>&bull; <em>${r.topic_title}</em> — unverified source, awaiting your review before next publish cycle`).join('')}
    </div>` : '';

    const noContentSection = reports.length === 0 ? `
    <div style="background:#fff0ef;border-left:4px solid #c44a1a;padding:12px 16px;margin:16px 0;">
      <strong style="color:#c44a1a;">No content published today.</strong> Check the pipeline — daily-media or daily-publish may have stalled.
    </div>` : '';

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Georgia,'Times New Roman',serif;font-size:11pt;line-height:1.5;color:#1a1a1a;background:#ffffff;max-width:800px;margin:0 auto;padding:24px;">

  <!-- HEADER -->
  <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;border-bottom:3px solid #dfae62;margin-bottom:24px;">
    <div>
      <div style="font-size:18pt;font-weight:700;color:#2b0a3d;letter-spacing:0.5px;">Faith &amp; Harmony LLC</div>
      <div style="font-size:9pt;color:#753679;font-style:italic;">Veteran-Owned Professional Services</div>
    </div>
    <div style="text-align:right;font-size:8.5pt;color:#64607a;line-height:1.6;">
      Hampton Roads, Virginia<br>
      (757) 843-8772<br>
      info@faithandharmonyllc.com
    </div>
  </div>

  <!-- META -->
  <div style="display:flex;justify-content:space-between;margin-bottom:16px;font-size:9.5pt;color:#64607a;">
    <div><strong>Document:</strong> COO Daily Publish Report<br><strong>Date:</strong> ${today}<br><strong>Prepared by:</strong> Content Command Center</div>
    <div style="text-align:right;"><strong>Classification:</strong> <span style="color:#c44a1a;font-weight:600;text-transform:uppercase;">Internal</span><br><strong>Report ID:</strong> CPR-${dateKey}</div>
  </div>
  <div style="font-size:14pt;font-weight:700;color:#2b0a3d;text-transform:uppercase;letter-spacing:1px;margin-bottom:20px;">COO Daily Publish Report — ${dateKey}</div>

  <!-- SUMMARY STATS -->
  <div style="display:flex;gap:16px;margin-bottom:20px;">
    <div style="flex:1;background:#f5f0fa;border-radius:6px;padding:12px 16px;text-align:center;">
      <div style="font-size:22pt;font-weight:700;color:#2b0a3d;">${published.length}</div>
      <div style="font-size:9pt;color:#753679;">Topics Published</div>
    </div>
    <div style="flex:1;background:#fff0ef;border-radius:6px;padding:12px 16px;text-align:center;">
      <div style="font-size:22pt;font-weight:700;color:#c44a1a;">${failed.length}</div>
      <div style="font-size:9pt;color:#c44a1a;">Topics Failed</div>
    </div>
    <div style="flex:1;background:#fff8e8;border-radius:6px;padding:12px 16px;text-align:center;">
      <div style="font-size:22pt;font-weight:700;color:#dfae62;">${reviewNeeded.length}</div>
      <div style="font-size:9pt;color:#b5850a;">Needs Review</div>
    </div>
    <div style="flex:1;background:#f0faf4;border-radius:6px;padding:12px 16px;text-align:center;">
      <div style="font-size:22pt;font-weight:700;color:#2d7a3a;">$${todayCost.toFixed(2)}</div>
      <div style="font-size:9pt;color:#2d7a3a;">Today's AI Cost</div>
    </div>
  </div>

  ${noContentSection}
  ${alertSection}

  <!-- TOPIC TABLE -->
  ${reports.length > 0 ? `
  <h2 style="font-size:12pt;color:#2b0a3d;border-bottom:1px solid #dfae62;padding-bottom:4px;margin:20px 0 10px 0;">Publish Results</h2>
  <table style="width:100%;border-collapse:collapse;font-size:10pt;">
    <thead>
      <tr>
        <th style="background:#2b0a3d;color:#fff;padding:8px 12px;text-align:left;font-size:9.5pt;">Persona</th>
        <th style="background:#2b0a3d;color:#fff;padding:8px 12px;text-align:left;font-size:9.5pt;">Topic</th>
        <th style="background:#2b0a3d;color:#fff;padding:8px 12px;text-align:left;font-size:9.5pt;">Status</th>
        <th style="background:#2b0a3d;color:#fff;padding:8px 12px;text-align:left;font-size:9.5pt;">Published To</th>
        <th style="background:#2b0a3d;color:#fff;padding:8px 12px;text-align:left;font-size:9.5pt;">Failed</th>
        <th style="background:#2b0a3d;color:#fff;padding:8px 12px;text-align:left;font-size:9.5pt;">Source</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>` : ''}

  <!-- FOOTER -->
  <div style="border-top:2px solid #dfae62;padding-top:10px;margin-top:40px;display:flex;justify-content:space-between;font-size:8pt;color:#64607a;">
    <div>Faith &amp; Harmony LLC &mdash; faithandharmonyllc.com
      <div style="font-size:7.5pt;color:#b5a99a;margin-top:4px;">Internal use only. Automated report generated by Content Command Center.</div>
    </div>
    <div style="text-align:right;">&copy; 2026 Faith &amp; Harmony LLC<br>All rights reserved.</div>
  </div>

</body>
</html>`;

    try {
        const subject = reports.length > 0
            ? `[COO Report] ${dateKey} — ${published.length} published, ${failed.length} failed${reviewNeeded.length > 0 ? `, ${reviewNeeded.length} need review` : ''}`
            : `[COO Report] ${dateKey} — No content published today`;

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
            console.error(`[COO Report] Resend error ${response.status}: ${await response.text()}`);
            return false;
        }

        console.log(`[COO Report] Sent: ${published.length} published, ${failed.length} failed, ${reviewNeeded.length} review needed`);
        return true;
    } catch (e) {
        console.error('[COO Report] Failed to send email:', e);
        return false;
    }
}
