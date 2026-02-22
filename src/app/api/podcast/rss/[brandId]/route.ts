import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function formatRfc822Date(isoDate: string): string {
    return new Date(isoDate).toUTCString();
}

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ brandId: string }> },
) {
    const { brandId } = await params;

    const supabase = createAdminClient();

    // Fetch brand info
    const { data: brand, error: brandError } = await supabase
        .from('brands')
        .select('*')
        .eq('id', brandId)
        .single();

    if (brandError || !brand) {
        return new Response('<error>Brand not found</error>', {
            status: 404,
            headers: { 'Content-Type': 'application/xml' },
        });
    }

    // Fetch published podcast episodes for this brand
    const { data: episodes, error: episodeError } = await supabase
        .from('podcast_episodes')
        .select('*')
        .eq('brand_id', brandId)
        .eq('status', 'published')
        .order('published_at', { ascending: false });

    if (episodeError) {
        return new Response('<error>Failed to fetch episodes</error>', {
            status: 500,
            headers: { 'Content-Type': 'application/xml' },
        });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://example.com';
    const feedUrl = `${siteUrl}/api/podcast/rss/${brandId}`;
    const channelTitle = `${brand.name} Podcast`;
    const channelDescription = brand.vertical
        ? `${brand.name} — exploring ${brand.vertical}`
        : `The official podcast of ${brand.name}`;

    // Fetch file sizes for enclosure tags (podcast spec requires byte length)
    const fileSizes = new Map<string, number>();
    await Promise.all(
        (episodes || []).map(async (ep) => {
            if (!ep.audio_url) return;
            try {
                const head = await fetch(ep.audio_url, { method: 'HEAD' });
                const len = head.headers.get('content-length');
                if (len) fileSizes.set(ep.id, parseInt(len, 10));
            } catch { /* fallback to 0 */ }
        }),
    );

    const items = (episodes || []).map(ep => {
        const description = ep.script
            ? escapeXml(ep.script.substring(0, 400) + (ep.script.length > 400 ? '...' : ''))
            : '';
        const duration = ep.duration_seconds ? formatDuration(ep.duration_seconds) : '0:00';
        const pubDate = ep.published_at ? formatRfc822Date(ep.published_at) : formatRfc822Date(ep.created_at);
        const fileSize = fileSizes.get(ep.id) || 0;

        return `    <item>
      <title>${escapeXml(ep.title)}</title>
      <description>${description}</description>
      <enclosure url="${escapeXml(ep.audio_url || '')}" type="audio/mpeg" length="${fileSize}" />
      <guid isPermaLink="false">${escapeXml(ep.rss_guid)}</guid>
      <pubDate>${pubDate}</pubDate>
      <itunes:duration>${duration}</itunes:duration>
      <itunes:episode>${escapeXml(ep.id)}</itunes:episode>
      <itunes:explicit>false</itunes:explicit>
    </item>`;
    });

    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(channelTitle)}</title>
    <description>${escapeXml(channelDescription)}</description>
    <language>en-us</language>
    <link>${escapeXml(siteUrl)}</link>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <itunes:author>${escapeXml(brand.name)}</itunes:author>
    <itunes:category text="Education">
      <itunes:category text="History" />
    </itunes:category>
    <itunes:explicit>false</itunes:explicit>
    <itunes:type>episodic</itunes:type>
${items.join('\n')}
  </channel>
</rss>`;

    return new Response(rssXml, {
        status: 200,
        headers: {
            'Content-Type': 'application/rss+xml; charset=utf-8',
            'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
        },
    });
}
