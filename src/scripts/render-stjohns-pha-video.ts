/**
 * Render the PHA-focused St. John's Day lecture video.
 * Uses Remotion's staticFile for all images (both user photos and DALL-E generated).
 * Chapter timings are precise based on script paragraph positions.
 */

const RENDER_SERVER = 'http://localhost:3200';
const AUDIO_URL = 'https://qjpujskwqaehxnqypxzu.supabase.co/storage/v1/object/public/media/132cfad9-504d-49b6-9f2f-8aa70fe526a3/long.mp3';

async function main() {
    const fps = 30;
    const introFrames = 3 * fps;
    const outroFrames = 5 * fps; // longer outro for CTA + logo
    // Audio is 514.776s (echo voice at 1.0x)
    const audioDurationSec = 515;
    const contentFrames = audioDurationSec * fps;
    const totalFrames = introFrames + contentFrames + outroFrames;

    // Chapters sized proportionally to script section lengths
    // Total content: 490s across these sections:
    // 515 total seconds distributed across sections
    const sections = [
        { title: "The Holy Saints John", secs: 70,
          narration: "The two Saints John represent the balance every Mason is called to walk.",
          bg: "mwphglva/generated/gen-two-saints-solstice.png" },
        { title: "A Heritage Shared", secs: 25,
          narration: "Every Mason shares this heritage. We honor the 1717 UGLE founding.",
          bg: "mwphglva/generated/gen-1717-tavern.png" },
        { title: "1775: Made Masons", secs: 50,
          narration: "Prince Hall and fourteen others were made Masons in Lodge 441, Irish Constitution.",
          bg: "mwphglva/generated/gen-1775-military-lodge.png" },
        { title: "The Permit Era", secs: 55,
          narration: "For nine years, walking on Saint John's Day was one of the only recognized Masonic privileges.",
          bg: "mwphglva/generated/gen-boston-procession-1780s.png" },
        { title: "Saint Black's Lodge — 1782", secs: 60,
          narration: "Prince Hall's dignified rebuttal — a Past Master's answer: firm, reasoned, unshaken.",
          bg: "mwphglva/generated/gen-independent-chronicle-1782.png" },
        { title: "The Charter — 1784", secs: 30,
          narration: "September 29, 1784. The charter for African Lodge No. 459.",
          bg: "mwphglva/generated/gen-charter-1784.png" },
        { title: "Rev. Marrant's Sermon — 1789", secs: 35,
          narration: "June 24, 1789. Reverend John Marrant delivered a celebrated sermon.",
          bg: "mwphglva/generated/gen-marrant-sermon-1789.png" },
        { title: "Prince Hall's Charge — 1797", secs: 35,
          narration: "June 24, 1797. Prince Hall delivered his famous Charge at Menotomy.",
          bg: "mwphglva/photos/Screenshot 2026-04-12 120554.png" },
        { title: "Virginia Begins — 1845", secs: 35,
          narration: "Universal Lodge No. 10, Alexandria. Chartered August 26, 1845.",
          bg: "mwphglva/photos/Screenshot 2026-04-12 120939.png" },
        { title: "MWPHGLVA Founded — 1865", secs: 45,
          narration: "October 29, 1865. The Most Worshipful Prince Hall Grand Lodge of Virginia.",
          bg: "mwphglva/generated/gen-richmond-1865-convention.png" },
        { title: "One Hundred Sixty Years", secs: 40,
          narration: "RW Anthony A. Portlock. Rev. John J. Jasper. Virginia's foundation.",
          bg: "mwphglva/photos/Screenshot 2026-04-12 121229.png" },
        { title: "Today's Brethren", secs: 35,
          narration: "Under MWGM George T. Cutler, Jr. — Dedicated to Serve Humanity.",
          bg: "mwphglva/photos/Screenshot 2026-04-12 120919.png" },
    ];

    // Build chapter array with cumulative startFrames (relative to post-intro)
    const chapters = [];
    let cursor = 0;
    for (const s of sections) {
        const dur = s.secs * fps;
        chapters.push({
            title: s.title,
            startFrame: cursor,
            durationFrames: dur,
            narrationText: s.narration,
            backgroundImageUrl: s.bg,
        });
        cursor += dur;
    }

    console.log(`Total chapters: ${chapters.length}`);
    console.log(`Content duration: ${(cursor / fps / 60).toFixed(2)} min (${cursor / fps}s)`);
    console.log(`Total video: ${(totalFrames / fps / 60).toFixed(2)} min`);

    const payload = {
        compositionId: 'TrainingVideo',
        outputFileName: 'stjohns-day-lecture-pha.mp4',
        inputProps: {
            title: "The Feast of Saint John the Baptist",
            subtitle: "A Prince Hall Perspective",
            chapters,
            audioUrl: AUDIO_URL,
            totalDurationFrames: totalFrames,
            brand: {
                name: "Most Worshipful Prince Hall Grand Lodge of Virginia",
                tagline: "Prince Hall Masons Dedicated to Serve Humanity",
                website: "mwphglva.org",
                ctaText: "LOOKING FOR A LODGE IN VIRGINIA? START AT MWPHGLVA.ORG",
                logoFile: "mwphglva/logo.png",
                primaryColor: "#D4AF37", // gold
                primaryLightColor: "#F5D78E", // light gold
                bgColor: "#1A0B2E", // deep royal purple
                bgCardColor: "#2D1B4E", // lighter royal purple
            },
        },
    };

    console.log('\nSubmitting render...');
    const resp = await fetch(`${RENDER_SERVER}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        console.error('Render error:', resp.status, await resp.text());
        process.exit(1);
    }

    const { jobId } = await resp.json();
    console.log('Job ID:', jobId);

    // Poll
    let status = 'queued';
    while (status !== 'completed' && status !== 'failed') {
        await new Promise(r => setTimeout(r, 15000));
        const s = await (await fetch(`${RENDER_SERVER}/status/${jobId}`)).json();
        status = s.status;
        console.log(`  ${status}${s.renderTimeMs ? ` (${(s.renderTimeMs / 1000).toFixed(0)}s)` : ''}`);
        if (status === 'completed') {
            console.log(`\nVideo: ${s.videoPath}`);
            console.log(`URL: ${s.videoUrl || RENDER_SERVER + '/videos/stjohns-day-lecture-pha.mp4'}`);
        } else if (status === 'failed') {
            console.error('FAILED:', s.error);
        }
    }
}

main();
