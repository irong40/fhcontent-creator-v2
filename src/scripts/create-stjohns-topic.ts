/**
 * Create St. John's Day lecture topic + long-form content piece.
 * Run with: npx tsx src/scripts/create-stjohns-topic.ts
 */

import { createClient } from '@supabase/supabase-js';

const PERSONA_ID = '172b4758-c368-4a13-9584-9f4201035b77';

const SCRIPT = `Brethren and friends of the Craft, welcome.

Today we turn our attention to one of the most significant dates on the Masonic calendar — June the twenty-fourth, the Feast of Saint John the Baptist. If you have ever wondered why Freemasons gather on this particular day, or why our lodges are so often dedicated to the Holy Saints John, then this lecture is for you.

Let us begin where the tradition itself begins — not in a lodge room, but in the pages of history.

The association between Freemasonry and Saint John the Baptist stretches back centuries. In the operative stonemason guilds of medieval Europe, it was common practice for trade guilds to adopt patron saints. The stonemasons chose two — Saint John the Baptist, whose feast falls on June the twenty-fourth, and Saint John the Evangelist, whose feast falls on December the twenty-seventh.

These were not arbitrary choices. The two feasts sit near the summer and winter solstices — the longest and shortest days of the year. For builders who worked by the light of the sun, these astronomical turning points held deep practical and symbolic meaning. The summer solstice represented the height of light, industry, and labor. The winter solstice represented reflection, rest, and the promise of returning light.

In Masonic philosophy, this duality became a powerful teaching tool. Saint John the Baptist represents the fiery zeal of faith, the voice crying in the wilderness, calling men to moral reform. Saint John the Evangelist represents the gentle, contemplative wisdom of divine love and spiritual knowledge. Together, they form the two parallel lines that appear in our symbolism — the boundaries within which a Mason should walk, guided by the point within the circle.

Now, the historical record gives us a remarkable coincidence — or perhaps, as some Brethren might suggest, something more than coincidence. On June the twenty-fourth, seventeen seventeen, four lodges in London gathered at the Goose and Gridiron Ale House and formed what we now recognize as the first Grand Lodge of England. They chose Saint John the Baptist's Day for this momentous event.

Whether this was deliberate symbolism or simply a convenient date when working men could gather, the effect was the same. The Feast of Saint John the Baptist became permanently woven into the founding mythology of organized Freemasonry. From that day forward, June the twenty-fourth carried a double significance — the ancient patron saint's day and the birthday of the Grand Lodge system itself.

Throughout the eighteenth and nineteenth centuries, Masonic celebrations of Saint John's Day were major public events. Grand Lodges would organize processions through city streets, with Brethren wearing their regalia and carrying the banners of their lodges. Churches would host special sermons for the Fraternity. Festive boards followed, with toasts, orations, and the installation of newly elected officers.

In colonial America, these celebrations were especially prominent. George Washington himself participated in Masonic observances of Saint John's Day. Records from lodges across the colonies describe elaborate feasts, public dedications of buildings, and the laying of cornerstones — all timed to coincide with the Feast of Saint John.

The tradition of installing lodge officers on or near Saint John's Day persists in many jurisdictions to this day. It serves as a natural turning point in the Masonic year — a moment to reflect on the labors of the past twelve months and to charge the incoming officers with the responsibilities of leadership.

So what should Saint John's Day mean to us as modern Freemasons?

First, it is an invitation to remember our history. When we observe June the twenty-fourth, we participate in an unbroken chain of tradition linking us to the stonemasons of medieval Europe, to the founding Brethren of seventeen seventeen, and to every generation of Masons who have gathered on this day to celebrate the Craft.

Second, it is a call to self-examination. Saint John the Baptist's message was one of preparation and moral reformation. As Masons, we are taught to use the working tools to shape ourselves into better men. The Feast Day asks us — what rough edges remain? What further labor is required?

Third, it is an occasion for brotherly love. Whether your lodge holds a festive board, a special communication, a Table Lodge, or simply gathers for fellowship — the Feast of Saint John is a time to strengthen the bonds that unite us as Brothers.

And finally, it is a reminder of balance. The two Saints John, standing at the solstices, teach us that a well-lived life requires both zeal and contemplation, both action and reflection, both the burning light of summer and the quiet wisdom of winter.

Brethren, as June the twenty-fourth approaches, I encourage you to mark the day with intention. Attend your lodge's observance if one is held. Read a piece of Masonic history. Reach out to a Brother you haven't spoken with in some time. And take a moment to reflect on what the Craft means to you and what you mean to the Craft.

The Feast of Saint John the Baptist has endured for centuries because it speaks to something essential in Freemasonry — the pursuit of light, the practice of virtue, and the fellowship of good men striving to become better.

May the blessing of the Holy Saints John attend you, Brethren. Thank you for your time and attention.`;

async function main() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Create topic
    // Generate a hash for dedup
    const crypto = await import('crypto');
    const topicHash = crypto.createHash('md5')
        .update('The Feast of St. John the Baptist: Why Masons Celebrate June 24th')
        .digest('hex')
        .substring(0, 16);

    const { data: topic, error: topicErr } = await supabase.from('topics').insert({
        persona_id: PERSONA_ID,
        topic_hash: topicHash,
        voice_id: 'onwK4e9ZLuTAKqWW03F9', // Daniel — authoritative male
        title: "The Feast of St. John the Baptist: Why Masons Celebrate June 24th",
        hook: "Every June 24th, Freemasons around the world pause to honor a tradition older than the United States itself.",
        historical_points: [
            "Origins of St. John the Baptist as patron saint of Masonry",
            "The significance of the two Saints John in Masonic tradition",
            "The summer solstice connection and the Holy Saints John parallel",
            "How Grand Lodges historically celebrated the Feast Day",
            "The 1717 Grand Lodge formation on St. Johns Day",
            "Modern observances: installation of officers, festive boards, rededication",
        ],
        status: 'approved',
    }).select().single();

    if (topicErr) {
        console.error('Topic error:', topicErr.message);
        process.exit(1);
    }
    console.log('Topic created:', topic.id);

    // Create long-form content piece
    const { data: piece, error: pieceErr } = await supabase.from('content_pieces').insert({
        topic_id: topic.id,
        piece_type: 'long',
        piece_order: 1,
        script: SCRIPT,
        caption_long: "Every June 24th, Freemasons honor a tradition older than America itself — the Feast of St. John the Baptist. Learn why this date matters to the Craft, from medieval stonemason guilds to the founding of the Grand Lodge in 1717. #Freemasonry #StJohnsDay #MasonicHistory #PastMaster #NorthEastCorner",
        caption_short: "Why do Masons celebrate June 24th? The answer goes back centuries. #Freemasonry #StJohnsDay",
        status: 'ready',
    }).select().single();

    if (pieceErr) {
        console.error('Piece error:', pieceErr.message);
        process.exit(1);
    }

    const wordCount = SCRIPT.split(/\s+/).length;
    console.log('Content piece created:', piece.id);
    console.log(`Script: ${wordCount} words (~${Math.round(wordCount / 150)} min at 150 wpm)`);
}

main();
