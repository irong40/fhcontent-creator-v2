/**
 * Bridge: Part 107 quiz shorts (rendered in D:\Projects\sai-training) → content_pieces
 * under the Sentinel Aerial "Field Ops" persona, so daily-publish distributes
 * them to SAI's configured platforms (YouTube 30796 + Facebook page
 * 899526466587385). This is the app-routed replacement for the old ad-hoc
 * "schedule straight to Blotato" manifest batches.
 *
 * For each eligible quiz question it: uploads the rendered MP4 to Supabase
 * Storage (public `media` bucket) → creates a topic + one content_piece
 * (piece_type short_1, video_url = the public URL, captions from the question's
 * SEO/hook) → staggers publish_at across `--per-day` slots so nothing bursts.
 *
 * Idempotent: a topic is keyed by topic_hash = `quiz-<id>`; re-runs skip
 * questions already ingested.
 *
 * Run (dry run — prints the plan, writes nothing):
 *   npx tsx --env-file=.env.local src/scripts/ingest-quiz.ts --module 2 --template B
 * Commit (uploads + inserts):
 *   npx tsx --env-file=.env.local src/scripts/ingest-quiz.ts --module 2 --template B --commit
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const SAI_PERSONA_ID = '40e0ee29-e867-4c28-ab71-87e9729a83af'; // Sentinel Aerial Field Ops
const SAI_TREE = 'D:/Projects/sai-training';
const BANK = path.join(SAI_TREE, 'quiz-bank', 'questions.json');
const QUIZ_DIR = path.join(SAI_TREE, 'out', 'quiz');

// Daily slots, in ET, converted to UTC (EDT = UTC-4 in July). Matches the
// original quiz cadence (9:00 / 13:30 / 18:00 ET). Publishing to a fresh page
// stays at 3/day per the anti-spam rule.
const SLOTS = [
    { utc: '13:00', et: '09:00' },
    { utc: '17:30', et: '13:30' },
    { utc: '22:00', et: '18:00' },
];

interface QuizQuestion {
    id: string;
    module: number;
    question: string;
    hook: string;
    status: string;
    seo: { title: string; description: string };
}

const args = process.argv.slice(2);
const argVal = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const MODULE = argVal('--module', '2');
const TEMPLATE = argVal('--template', 'B').toUpperCase();
const PER_DAY = Math.max(1, Math.min(SLOTS.length, parseInt(argVal('--per-day', '3'), 10)));
const COMMIT = args.includes('--commit');
// Default start = tomorrow (UTC date), so nothing fires the same day it's staged.
const START = argVal('--start', new Date(Date.now() + 864e5).toISOString().split('T')[0]);

/** UTC publish_at for the Nth grid position (PER_DAY slots per day from START). */
function slotAt(index: number): { date: string; at: string; timeET: string } {
    const day = Math.floor(index / PER_DAY);
    const slot = SLOTS[index % PER_DAY];
    const base = new Date(`${START}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() + day);
    const date = base.toISOString().split('T')[0];
    const at = `${date}T${slot.utc}:00Z`;
    return { date, at, timeET: slot.et };
}

/** Slot allocator that skips slots already occupied by existing topics for the
 *  persona. Without this, a partial rerun re-issued day-one slots to the
 *  remaining questions and stacked 6 posts on one day (Codex review
 *  2026-07-18, Major 5). */
function makeSlotAllocator(occupiedAt: Set<string>) {
    let index = 0;
    return () => {
        for (;;) {
            const slot = slotAt(index++);
            const key = new Date(slot.at).toISOString();
            if (!occupiedAt.has(key)) return slot;
        }
    };
}

async function main() {
    const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
        process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    );

    const bank = JSON.parse(readFileSync(BANK, 'utf8')) as { questions: QuizQuestion[] };
    const eligible = bank.questions.filter(
        (q) => String(q.module) === MODULE && existsSync(path.join(QUIZ_DIR, `${q.id}-${TEMPLATE}.mp4`)),
    );

    const missing = bank.questions.filter(
        (q) => String(q.module) === MODULE && !existsSync(path.join(QUIZ_DIR, `${q.id}-${TEMPLATE}.mp4`)),
    );
    if (missing.length) {
        console.warn(`⚠ ${missing.length} module-${MODULE} question(s) have no ${TEMPLATE} render (skipped): ${missing.map((q) => q.id).join(', ')}`);
    }

    console.log(`\n${COMMIT ? '=== COMMIT ===' : '=== DRY RUN (no writes) ==='}`);
    console.log(`Module ${MODULE}, template ${TEMPLATE}, ${eligible.length} eligible, ${PER_DAY}/day from ${START}\n`);

    // Slots already taken by ANY existing topic for this persona (previous
    // runs, other modules) — new items fill the gaps instead of colliding.
    const { data: existingTopics } = await sb
        .from('topics')
        .select('publish_at')
        .eq('persona_id', SAI_PERSONA_ID)
        .not('publish_at', 'is', null);
    const occupiedAt = new Set(
        (existingTopics ?? []).map((t: { publish_at: string }) => new Date(t.publish_at).toISOString()),
    );
    const nextSlot = makeSlotAllocator(occupiedAt);

    let created = 0, skipped = 0, repaired = 0;

    for (const q of eligible) {
        const topicHash = `quiz-${q.id}`;
        const { data: existing } = await sb.from('topics').select('id').eq('topic_hash', topicHash).maybeSingle();
        if (existing) {
            // Repair path (Codex review 2026-07-18, Major 4): a prior run may
            // have created the topic but died before the content piece. Such a
            // topic will be marked failed by daily-publish ("no content
            // pieces") — recreate the missing piece instead of skipping.
            const { data: piece } = await sb
                .from('content_pieces').select('id').eq('topic_id', existing.id).limit(1).maybeSingle();
            if (piece) {
                console.log(`↷ skip (already ingested): ${q.id}`);
                skipped++;
                continue;
            }
            console.log(`⚠ ${q.id}: topic exists but piece missing — repairing`);
            if (COMMIT) {
                const ok = await uploadAndInsertPiece(sb, q, existing.id);
                if (ok) repaired++;
            }
            continue;
        }

        const slot = nextSlot();

        console.log(`• ${q.id} → ${slot.date} ${slot.timeET} ET`);
        console.log(`    title: ${q.seo.title.slice(0, 70)}`);

        if (!COMMIT) continue;

        // 1. Topic (Field Ops persona), scheduled at its slot. Created first so
        //    a mid-run death leaves a repairable orphan (rerun recreates the
        //    piece) rather than an orphaned storage object.
        const { data: topic, error: tErr } = await sb.from('topics').insert({
            persona_id: SAI_PERSONA_ID,
            title: q.seo.title,
            hook: q.hook,
            historical_points: [],
            topic_hash: topicHash,
            voice_id: 'quiz-prerendered',
            publish_date: slot.date,
            publish_at: slot.at,
            publish_time: slot.timeET,
            status: 'scheduled',
        }).select('id').single();
        if (tErr || !topic) { console.error(`    ✗ topic insert failed: ${tErr?.message}`); continue; }

        // 2. Upload the MP4 + insert the content piece.
        const ok = await uploadAndInsertPiece(sb, q, topic.id);
        if (!ok) continue;

        console.log(`    ✓ scheduled`);
        created++;
    }

    console.log(`\n${COMMIT ? 'Created' : 'Would create'} ${COMMIT ? created : eligible.length - skipped}, skipped ${skipped}, repaired ${repaired}.`);
    if (!COMMIT) console.log('Re-run with --commit to upload + schedule.');
}

/** Upload the question's rendered MP4 to public storage and attach the single
 *  content piece to `topicId`. Shared by the create and repair paths so a
 *  partially-ingested question always converges to the same final state. */
async function uploadAndInsertPiece(
    sb: ReturnType<typeof createClient>,
    q: QuizQuestion,
    topicId: string,
): Promise<boolean> {
    const localFile = path.join(QUIZ_DIR, `${q.id}-${TEMPLATE}.mp4`);
    const storagePath = `quiz/${q.id}-${TEMPLATE}.mp4`;
    const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL!.trim()}/storage/v1/object/public/media/${storagePath}`;

    const bytes = readFileSync(localFile);
    const { error: upErr } = await sb.storage.from('media').upload(storagePath, bytes, {
        contentType: 'video/mp4',
        upsert: true,
    });
    if (upErr) { console.error(`    ✗ upload failed: ${upErr.message}`); return false; }

    const { error: pErr } = await sb.from('content_pieces').insert({
        topic_id: topicId,
        piece_type: 'short_1',
        piece_order: 1,
        video_url: publicUrl,
        caption_long: q.seo.description,
        caption_short: q.hook,
        status: 'ready',
    });
    if (pErr) { console.error(`    ✗ piece insert failed: ${pErr.message}`); return false; }
    return true;
}

main().catch((e) => { console.error(e); process.exit(1); });
