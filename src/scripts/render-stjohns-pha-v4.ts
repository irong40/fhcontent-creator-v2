/**
 * Render the St. John's lecture (v4 script) with CogVideoX-animated backgrounds.
 *
 * Script v4: ~1,936 words at 1.0x echo voice = ~11:50 audio
 * 13 chapter sections covering Immortal 15 + full PHA arc + Virginia founding.
 */

const RENDER_SERVER = 'http://localhost:3200';
const AUDIO_URL = 'https://qjpujskwqaehxnqypxzu.supabase.co/storage/v1/object/public/media/132cfad9-504d-49b6-9f2f-8aa70fe526a3/long.mp3';

async function main() {
    const fps = 30;
    const introFrames = 3 * fps;
    const outroFrames = 5 * fps;
    // Audio is 710s (11:50)
    const audioDurationSec = 715;
    const contentFrames = audioDurationSec * fps;
    const totalFrames = introFrames + contentFrames + outroFrames;

    // 715 total seconds — 13 sections covering the v4 narrative arc
    const sections = [
        { title: "The Holy Saints John", secs: 75,
          narration: "Every Mason is called to walk between zeal and contemplation — between the two Saints John.",
          img: "mwphglva/generated/gen-two-saints-solstice.png",
          video: "mwphglva/animated/02-two-saints.mp4" },

        { title: "A Heritage Shared", secs: 25,
          narration: "We honor every Mason who has walked before us.",
          img: "mwphglva/generated/gen-1717-tavern.png",
          video: "mwphglva/animated/03-1717-tavern.mp4" },

        { title: "1775: The Immortal Fifteen", secs: 95,
          narration: "Sgt. John Batt received Prince Hall and fourteen others — the Immortal Fifteen.",
          img: "mwphglva/generated/gen-1775-military-lodge.png",
          video: "mwphglva/animated/04-1775-military.mp4" },

        { title: "Leather Dresser & Leader", secs: 40,
          narration: "A Leather Dresser and Labourer. Literate. A leader. A Mason.",
          img: "mwphglva/photos/Screenshot 2026-04-12 120554.png",
          video: "mwphglva/animated/09-prince-hall-portrait.mp4" },

        { title: "The Permit Era", secs: 60,
          narration: "For nine years, walking on Saint John's Day was one of the only recognized Masonic privileges.",
          img: "mwphglva/generated/gen-boston-procession-1780s.png",
          video: "mwphglva/animated/05-1780s-procession.mp4" },

        { title: "Petition for Freedom — 1777", secs: 50,
          narration: "January 13, 1777. A natural and unalienable right to that freedom.",
          img: "mwphglva/generated/gen-independent-chronicle-1782.png",
          video: "mwphglva/animated/06-independent-chronicle.mp4" },

        { title: "The Charter — 1784", secs: 45,
          narration: "September 29, 1784. The charter for African Lodge No. 459.",
          img: "mwphglva/generated/gen-charter-1784.png",
          video: "mwphglva/animated/07-charter-1784.mp4" },

        { title: "Saint Black's Lodge — 1782", secs: 50,
          narration: "Prince Hall's reply: firm, reasoned, unshaken. A Past Master's answer.",
          img: "mwphglva/generated/gen-independent-chronicle-1782.png",
          video: "mwphglva/animated/06-independent-chronicle.mp4" },

        { title: "Rev. Marrant's Sermon — 1789", secs: 35,
          narration: "June 24, 1789. Reverend John Marrant, America's first Black preacher.",
          img: "mwphglva/generated/gen-marrant-sermon-1789.png",
          video: "mwphglva/animated/08-marrant-sermon.mp4" },

        { title: "The Kidnapping — 1788", secs: 60,
          narration: "The three men were returned to Boston. That is what a lodge can do.",
          img: "mwphglva/generated/gen-independent-chronicle-1782.png",
          video: "mwphglva/animated/06-independent-chronicle.mp4" },

        { title: "Prince Hall's Charge — 1797", secs: 30,
          narration: "June 24, 1797. Prince Hall's famous Charge at Menotomy.",
          img: "mwphglva/photos/Screenshot 2026-04-12 120554.png",
          video: "mwphglva/animated/09-prince-hall-portrait.mp4" },

        { title: "First Institution", secs: 45,
          narration: "Before the A.M.E. Church. Before the Black press. There was Prince Hall Freemasonry.",
          img: "mwphglva/generated/gen-marrant-sermon-1789.png",
          video: "mwphglva/animated/08-marrant-sermon.mp4" },

        { title: "Schools & Leadership", secs: 35,
          narration: "Prince Hall opened a school in his own home. Brother Richard Allen. Brother Henry Weeden.",
          img: "mwphglva/photos/Screenshot 2026-04-12 120939.png",
          video: "mwphglva/animated/10-1845-universal-lodge.mp4" },

        { title: "Virginia Begins — 1845", secs: 30,
          narration: "Universal Lodge No. 10, Alexandria. Chartered August 26, 1845.",
          img: "mwphglva/photos/Screenshot 2026-04-12 120939.png",
          video: "mwphglva/animated/10-1845-universal-lodge.mp4" },

        { title: "MWPHGLVA Founded — 1865", secs: 45,
          narration: "October 29, 1865. The Most Worshipful Prince Hall Grand Lodge of Virginia.",
          img: "mwphglva/generated/gen-richmond-1865-convention.png",
          video: "mwphglva/animated/11-1865-richmond.mp4" },

        { title: "One Hundred Sixty Years", secs: 40,
          narration: "RW Anthony A. Portlock. Rev. John J. Jasper. Virginia's foundation.",
          img: "mwphglva/photos/Screenshot 2026-04-12 121229.png",
          video: "mwphglva/animated/12-virginia-marker.mp4" },

        { title: "Today's Brethren", secs: 55,
          narration: "Under MWGM George T. Cutler, Jr. — Prince Hall Masons Dedicated to Serve Humanity.",
          img: "mwphglva/photos/Screenshot 2026-04-12 120919.png",
          video: "mwphglva/animated/13-todays-brethren.mp4" },
    ];

    // Build chapter array — allow animated video or fallback to Ken Burns still
    const chapters = [];
    let cursor = 0;
    for (const s of sections) {
        chapters.push({
            title: s.title,
            startFrame: cursor,
            durationFrames: s.secs * fps,
            narrationText: s.narration,
            backgroundImageUrl: s.img,
            // Will be used if the animated MP4 exists at render time
            backgroundVideoUrl: s.video,
        });
        cursor += s.secs * fps;
    }

    console.log(`Chapters: ${chapters.length}`);
    console.log(`Content: ${(cursor / fps / 60).toFixed(2)} min`);
    console.log(`Total: ${(totalFrames / fps / 60).toFixed(2)} min`);

    const payload = {
        compositionId: 'TrainingVideo',
        outputFileName: 'stjohns-day-lecture-pha-v4.mp4',
        inputProps: {
            title: "The Feast of Saint John the Baptist",
            subtitle: "A Prince Hall Perspective",
            chapters,
            audioUrl: AUDIO_URL,
            totalDurationFrames: totalFrames,
            backgroundImageUrl: "mwphglva/generated/gen-intro-bg.png",
            brand: {
                name: "Most Worshipful Prince Hall Grand Lodge of Virginia",
                tagline: "Prince Hall Masons Dedicated to Serve Humanity",
                website: "mwphglva.org",
                ctaText: "LOOKING FOR A LODGE IN VIRGINIA? START AT MWPHGLVA.ORG",
                logoFile: "mwphglva/logo.png",
                primaryColor: "#D4AF37",
                primaryLightColor: "#F5D78E",
                bgColor: "#1A0B2E",
                bgCardColor: "#2D1B4E",
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

    let status = 'queued';
    while (status !== 'completed' && status !== 'failed') {
        await new Promise(r => setTimeout(r, 15000));
        const s = await (await fetch(`${RENDER_SERVER}/status/${jobId}`)).json();
        status = s.status;
        console.log(`  ${status}${s.renderTimeMs ? ` (${(s.renderTimeMs / 1000).toFixed(0)}s)` : ''}`);
        if (status === 'completed') {
            console.log(`\nVideo: ${s.videoPath}`);
        } else if (status === 'failed') {
            console.error('FAILED:', s.error);
        }
    }
}

main();
