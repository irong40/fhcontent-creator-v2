/**
 * ONE-OFF: manually run the Freedom Voices weekly quote batch that the 6/14
 * Sunday cron skipped (persona was absent from AUTO_TOPIC_PERSONA_IDS).
 *
 * Mirrors /api/cron/daily-topic exactly (same buildTopicPrompt → claude →
 * insert), but:
 *   - targets Freedom Voices regardless of AUTO_TOPIC_PERSONA_IDS,
 *   - bypasses the 6-day recency guard (the 6/10 test topic would block it),
 *   - schedules 7 topics one-per-day starting TOMORROW (2026-06-16 .. 06-22),
 *     publish_at = <date>T13:00:00Z (same slot the cron uses).
 *
 * Generation is the repo's own authenticity-guarded prompt (verbatim,
 * documented, 35-60 word quotes). Topics land status='draft' with publish_date
 * set, so the existing content-generator (30 min) + daily-media (6 AM) crons
 * build the cards and the local QuoteVideoRenderer renders the loops.
 *
 * Run: cd repo && node --env-file=.env.local --import tsx src/scripts/run-fv-week.ts
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { buildTopicPrompt } from '../lib/prompts';
import { topicResponseSchema } from '../lib/schemas';
import { claude } from '../lib/claude';

const FV_ID = '2f957282-1fdf-404c-91fb-ef6c16b7b231';
const START_DATES = [
    '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19',
    '2026-06-20', '2026-06-21', '2026-06-22',
];

async function main() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Missing Supabase env');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createClient(url, key) as any;

    const { data: persona, error: pErr } = await supabase
        .from('personas').select('*').eq('id', FV_ID).single();
    if (pErr || !persona) throw new Error('FV persona not found: ' + pErr?.message);
    console.log('Persona:', persona.name, '| format:', persona.content_format);

    // recent titles so Claude avoids repeats (incl. the 6/10 Hamer test)
    const { data: existing } = await supabase
        .from('topics').select('title').eq('persona_id', FV_ID);
    const recentTopics: string[] = (existing || []).map((r: { title: string }) => r.title);
    console.log('Avoiding repeats of:', recentTopics);

    // ── generate 7 topics (same call the cron makes) ──
    const { system, user } = buildTopicPrompt(persona, recentTopics, 7);
    console.log('Calling Claude for 7 quote topics...');
    const { text, inputTokens, outputTokens } = await claude.generateContent(system, user, { maxTokens: 16000 });
    console.log(`Claude tokens in/out: ${inputTokens}/${outputTokens}`);

    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = topicResponseSchema.safeParse(JSON.parse(cleaned));
    if (!parsed.success) throw new Error('Schema validation failed: ' + JSON.stringify(parsed.error.issues?.slice(0, 3)));
    const topics = parsed.data.topics.slice(0, 7);
    console.log(`Generated ${topics.length} topics\n`);

    const existingTitles = new Set(recentTopics.map(t => t.toLowerCase().trim()));
    const summary: Array<{ date: string; title: string; words: number; source: string; year: string | number }> = [];

    for (let i = 0; i < topics.length && i < START_DATES.length; i++) {
        const t = topics[i];
        const publishDate = START_DATES[i];
        const points = t.historicalPoints as Array<{ claim: string; source: string; year: string | number }>;
        const quote = points?.[0];
        const wordCount = quote ? quote.claim.trim().split(/\s+/).length : 0;

        if (existingTitles.has(t.title.toLowerCase().trim())) {
            console.log(`[skip] "${t.title}" already exists`);
            continue;
        }
        if (wordCount < 35 || wordCount > 60) {
            console.log(`[WARN] "${t.title}" quote is ${wordCount} words (outside 35-60) — inserting anyway, REVIEW`);
        }

        const topicHash = crypto.createHash('md5').update(t.title.toLowerCase().trim()).digest('hex');
        const { data: inserted, error: insErr } = await supabase.from('topics').insert({
            persona_id: FV_ID,
            title: t.title,
            hook: t.hook,
            historical_points: t.historicalPoints,
            topic_hash: topicHash,
            voice_id: 'default',
            thumbnail_prompt: null,
            status: 'draft',
            publish_date: publishDate,
            publish_at: `${publishDate}T13:00:00Z`,
        }).select('id').single();

        if (insErr) { console.log(`[ERR] insert "${t.title}": ${insErr.message}`); continue; }
        existingTitles.add(t.title.toLowerCase().trim());
        summary.push({ date: publishDate, title: t.title, words: wordCount, source: quote?.source ?? '?', year: quote?.year ?? '?' });
        console.log(`[ok] ${publishDate}  ${t.title}  (${wordCount}w)  id=${inserted.id}`);
    }

    console.log('\n===== REVIEW THESE QUOTES BEFORE THEY PUBLISH =====');
    for (const s of summary) {
        const t = topics.find(x => x.title === s.title)!;
        const q = (t.historicalPoints as Array<{ claim: string; source: string; year: string | number }>)[0];
        console.log(`\n${s.date}  —  ${s.title}`);
        console.log(`  "${q.claim}"`);
        console.log(`  — ${q.source}, ${q.year}  (${s.words} words)`);
    }
    console.log(`\nInserted ${summary.length} topics as status=draft. content-generator + daily-media will build the cards; daily-publish ships at <date>T13:00:00Z (9 AM ET).`);
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
