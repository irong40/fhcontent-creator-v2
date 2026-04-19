/**
 * Submit St. John's Day lecture to Remotion render server.
 * Run with: npx tsx src/scripts/render-stjohns-video.ts
 */

const RENDER_SERVER = 'http://localhost:3200';
const AUDIO_URL = 'https://qjpujskwqaehxnqypxzu.supabase.co/storage/v1/object/public/media/132cfad9-504d-49b6-9f2f-8aa70fe526a3/long.mp3';

async function main() {
    // ~6.2 minutes at 0.95x speed = ~372 seconds
    // 30 fps * 372 = ~11,160 frames
    // Add intro (3s = 90f) and outro (4s = 120f)
    const fps = 30;
    const audioDurationSec = 375; // ~6:15 with slight buffer
    const introFrames = 3 * fps;
    const outroFrames = 4 * fps;
    const contentFrames = audioDurationSec * fps;
    const totalFrames = introFrames + contentFrames + outroFrames;

    const chapters = [
        {
            title: "Origins of the Patron Saints",
            startFrame: introFrames,
            durationFrames: 75 * fps, // ~75 sec
            narrationText: "The association between Freemasonry and Saint John the Baptist stretches back centuries.",
        },
        {
            title: "The Two Saints John",
            startFrame: introFrames + (75 * fps),
            durationFrames: 60 * fps,
            narrationText: "Saint John the Baptist represents zeal. Saint John the Evangelist represents wisdom.",
        },
        {
            title: "June 24th, 1717",
            startFrame: introFrames + (135 * fps),
            durationFrames: 55 * fps,
            narrationText: "Four lodges gathered at the Goose and Gridiron Ale House.",
        },
        {
            title: "Historical Celebrations",
            startFrame: introFrames + (190 * fps),
            durationFrames: 65 * fps,
            narrationText: "Grand Lodges organized processions through city streets.",
        },
        {
            title: "What It Means Today",
            startFrame: introFrames + (255 * fps),
            durationFrames: 80 * fps,
            narrationText: "An invitation to remember, examine, and celebrate.",
        },
    ];

    console.log(`Submitting render: ${totalFrames} frames (${(totalFrames / fps / 60).toFixed(1)} min)`);
    console.log(`Audio: ${AUDIO_URL}`);

    const resp = await fetch(`${RENDER_SERVER}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            compositionId: 'TrainingVideo',
            outputFileName: 'stjohns-day-lecture.mp4',
            inputProps: {
                title: "The Feast of St. John the Baptist",
                subtitle: "Why Masons Celebrate June 24th",
                chapters,
                audioUrl: AUDIO_URL,
                totalDurationFrames: totalFrames,
            },
        }),
    });

    if (!resp.ok) {
        const err = await resp.text();
        console.error('Render error:', resp.status, err);
        process.exit(1);
    }

    const result = await resp.json();
    console.log('Render job submitted!');
    console.log('Job ID:', result.jobId);
    console.log('Status URL:', result.statusUrl);

    // Poll until done
    console.log('\nPolling for completion...');
    let status = 'queued';
    while (status !== 'completed' && status !== 'failed') {
        await new Promise(r => setTimeout(r, 10000)); // 10s intervals
        const statusResp = await fetch(`${RENDER_SERVER}/status/${result.jobId}`);
        const statusData = await statusResp.json();
        status = statusData.status;
        console.log(`  Status: ${status}${statusData.renderTimeMs ? ` (${(statusData.renderTimeMs / 1000).toFixed(0)}s elapsed)` : ''}`);

        if (status === 'completed') {
            console.log('\nRender complete!');
            console.log('Video path:', statusData.videoPath);
            console.log('Video URL:', statusData.videoUrl || `${RENDER_SERVER}/videos/stjohns-day-lecture.mp4`);
            console.log('Render time:', (statusData.renderTimeMs / 1000).toFixed(0), 'seconds');
        } else if (status === 'failed') {
            console.error('\nRender failed:', statusData.error);
        }
    }
}

main();
