import type { Persona, Topic, HistoricalPoint, PieceType } from '@/types/database';

export type RemixField = 'script' | 'caption_long' | 'caption_short' | 'thumbnail_prompt' | 'carousel_slides';

export function buildTopicPrompt(
    persona: Persona,
    recentTopics: string[],
    count: number,
): { system: string; user: string } {
    const system = `You are generating content topics for ${persona.name}, ${persona.brand}.
Your voice: ${persona.voice_style}
${persona.content_guidelines ? `Guidelines: ${persona.content_guidelines}` : ''}
You MUST respond with valid JSON only. No markdown, no code fences, no explanation.`;

    const user = `EXPERTISE AREAS:
${persona.expertise_areas.join('\n')}

TOPICS TO AVOID (already published):
${recentTopics.length > 0 ? recentTopics.join('\n') : 'None yet'}

Generate exactly ${count} unique historical topic(s) about African American history in Virginia.

For each topic, provide:
1. title: Compelling, specific title (include year if applicable)
2. hook: Opening line that grabs attention (question or surprising fact)
3. historicalPoints: Exactly 4 verifiable historical facts
   - Each must have: point (1-4), claim, source, year
4. thumbnailPrompt: A vivid prompt for AI image generation

OUTPUT FORMAT (JSON only):
{
  "topics": [
    {
      "title": "...",
      "hook": "...",
      "historicalPoints": [
        {"point": 1, "claim": "...", "source": "...", "year": "..."},
        {"point": 2, "claim": "...", "source": "...", "year": "..."},
        {"point": 3, "claim": "...", "source": "...", "year": "..."},
        {"point": 4, "claim": "...", "source": "...", "year": "..."}
      ],
      "thumbnailPrompt": "..."
    }
  ]
}

REQUIREMENTS:
- Each topic must be historically accurate and verifiable
- Include specific names, dates, and places
- Vary time periods (colonial, antebellum, reconstruction, civil rights, modern)
- Vary geographic regions within Virginia
- Avoid topics similar to the "TOPICS TO AVOID" list`;

    return { system, user };
}

export function buildContentPrompt(
    persona: Persona,
    topic: Topic,
): { system: string; user: string } {
    const points = topic.historical_points as HistoricalPoint[];

    const system = `You are a content writer creating scripts for ${persona.brand}.
Voice style: ${persona.voice_style}
${persona.content_guidelines ? `Guidelines: ${persona.content_guidelines}` : ''}

IMPORTANT RULES:
- NEVER mention the creator's name ("${persona.name}") anywhere in scripts or captions. Write in first person without self-identifying by name.
- NEVER use a corrective/contrarian pattern like "No, it wasn't X — it was actually Y" or "You might think X, but that's wrong." Instead, lead with the truth directly as a compelling statement or surprising fact.

You MUST respond with valid JSON only. No markdown, no code fences, no explanation.`;

    const user = `TOPIC: ${topic.title}
HOOK: ${topic.hook}

HISTORICAL POINTS:
${points.map(p => `${p.point}. ${p.claim} (Source: ${p.source}, ${p.year})`).join('\n')}

Generate content for 6 pieces:

## 1. LONG VIDEO (2-4 minutes)
- Cover all 4 historical points
- Start with the hook
- Conversational but authoritative tone
- 500-800 words
- End with call to action (follow for more)${persona.newsletter_cta ? `\n- IMPORTANT: For the long video captionLong, append this newsletter CTA before the hashtags: "${persona.newsletter_cta}"` : ''}

## 2-5. SHORT VIDEOS (30 seconds each)
- Short 1: Deep dive on Point 1
- Short 2: Deep dive on Point 2
- Short 3: Deep dive on Point 3
- Short 4: Deep dive on Point 4
- 60-100 words each
- Each starts with attention-grabbing opening
- Each ends with "Follow for more untold history"

## 6. CAROUSEL (8-10 slides)
- Slide 1: Hook/Title
- Slides 2-5: One point per slide (visual-friendly text)
- Slides 6-7: Additional context or quotes
- Slide 8: Call to action
- Include imagePrompt for each slide

FOR EACH PIECE, PROVIDE:
- script: The spoken/displayed text (NEVER include the creator's name)
- captionLong: 2200 character caption ending with 3-5 hashtags using this formula:
  * 1-2 broad reach: #BlackHistory #BlackExcellence #BlackHistoryMonth #BlackCulture
  * 1-2 niche educational: #BlackHistoryFacts #BlackHistory365 #HistoryTok #LearnOnTikTok #RealBlackHistory
  * 1 discovery: #DidYouKnow #FYP #Viral
  Example: "#BlackHistory #BlackHistoryFacts #DidYouKnow #BlackExcellence #HistoryTok"
- captionShort: 280 character caption for Twitter/X (include 2-3 of the same hashtags)
- thumbnailPrompt: Prompt for AI thumbnail generation

For each piece, also include a "musicTrack" field with a mood string for background music (e.g., "inspirational", "upbeat", "dramatic", "reflective", "triumphant"). Pick a mood that matches the piece's tone and content.

OUTPUT FORMAT (JSON only):
{
  "pieces": [
    {"pieceType": "long", "script": "...", "captionLong": "...", "captionShort": "...", "thumbnailPrompt": "...", "musicTrack": "dramatic"},
    {"pieceType": "short_1", "script": "...", "captionLong": "...", "captionShort": "...", "thumbnailPrompt": "...", "musicTrack": "upbeat"},
    {"pieceType": "short_2", "script": "...", "captionLong": "...", "captionShort": "...", "thumbnailPrompt": "...", "musicTrack": "reflective"},
    {"pieceType": "short_3", "script": "...", "captionLong": "...", "captionShort": "...", "thumbnailPrompt": "...", "musicTrack": "triumphant"},
    {"pieceType": "short_4", "script": "...", "captionLong": "...", "captionShort": "...", "thumbnailPrompt": "...", "musicTrack": "inspirational"},
    {"pieceType": "carousel", "script": "...", "captionLong": "...", "captionShort": "...", "carouselSlides": [{"slide": 1, "text": "...", "imagePrompt": "..."}, ...], "musicTrack": "inspirational"}
  ]
}`;

    return { system, user };
}

export function buildCarouselSlidesPrompt(
    topic: Topic,
    researchContent: HistoricalPoint[],
    brandTone: string,
): { system: string; user: string } {
    const system = `You are a visual content strategist creating carousel slides for social media.
Voice/tone: ${brandTone}

IMPORTANT RULES:
- Each slide must be visually focused — short, punchy text that works on a 1080x1080 image.
- Cite primary sources where applicable (inline, e.g. "— Library of Congress, 1922").
- NEVER use a corrective/contrarian pattern. Lead with the truth directly.
- You MUST respond with valid JSON only. No markdown, no code fences, no explanation.`;

    const user = `TOPIC: ${topic.title}
HOOK: ${topic.hook}

HISTORICAL POINTS:
${researchContent.map(p => `${p.point}. ${p.claim} (Source: ${p.source}, ${p.year})`).join('\n')}

Generate 8-10 carousel slides following this structure:
- Slide 1: Hook/Title slide — attention-grabbing headline
- Slides 2-5: One historical point per slide with visual-friendly text
- Slides 6-7: Additional context, quotes, or deeper analysis
- Slide 8-10: Call to action / follow for more / source credits

For each slide provide:
- slide_number: sequential number starting at 1
- title: bold headline for the slide (3-8 words)
- subtitle: optional secondary line
- body: the main text content (1-3 sentences, concise)
- image_prompt: a vivid, detailed prompt for AI image generation that matches the slide content. Style: historical, photorealistic, cinematic lighting, no text overlay.

OUTPUT FORMAT (JSON only):
{
  "slides": [
    {"slide_number": 1, "title": "...", "subtitle": "...", "body": "...", "image_prompt": "..."},
    ...
  ]
}`;

    return { system, user };
}

export function buildPodcastScriptPrompt(
    topic: Topic,
    longFormScript: string,
    brandName: string,
    ctaTemplate: string,
): { system: string; user: string } {
    const points = topic.historical_points as HistoricalPoint[];

    const system = `You are an expert podcast scriptwriter for ${brandName}. You transform short video scripts into engaging, long-form podcast narratives that sound natural when read aloud via text-to-speech.

IMPORTANT RULES:
- Write for SPOKEN delivery — use conversational language, natural pauses (marked with "..."), and rhetorical questions
- NEVER include stage directions, speaker labels, or non-spoken text
- NEVER mention the host's name — write in first person
- Target 20-35 minutes of spoken content (approximately 3000-5000 words at 150 wpm)
- Mark exactly ONE mid-roll call-to-action insertion point as [MID_ROLL_CTA] between segments 2 and 3

You MUST respond with valid JSON only. No markdown, no code fences, no explanation.`;

    const user = `TOPIC: ${topic.title}
HOOK: ${topic.hook}

HISTORICAL POINTS:
${points.map(p => `${p.point}. ${p.claim} (Source: ${p.source}, ${p.year})`).join('\n')}

ORIGINAL SHORT SCRIPT (2-4 min):
${longFormScript}

CTA TEMPLATE (for outro):
${ctaTemplate}

Expand this into a full podcast episode with the following structure:

1. INTRO (2-3 min): Welcome, tease what's coming, hook the listener with a surprising fact or question
2. SEGMENT 1 — Setting the Scene (5-8 min): Historical context, time period, geography, social conditions
3. SEGMENT 2 — The Story Unfolds (5-8 min): Key events, people involved, turning points
[MID_ROLL_CTA] goes here
4. SEGMENT 3 — Impact & Legacy (5-8 min): Consequences, how it changed things, connections to later events
5. OUTRO (2-3 min): Recap key takeaways, reflect on relevance today, CTA using the template above

REQUIREMENTS:
- Every historical claim must come from the provided points — do NOT fabricate facts
- Expand with vivid storytelling: describe settings, imagine what people might have felt, draw connections
- Use transitions between segments ("Now let's talk about...", "But here's where it gets interesting...")
- Include 2-3 rhetorical questions per segment to keep listeners engaged
- The [MID_ROLL_CTA] marker must appear exactly once, on its own line

OUTPUT FORMAT (JSON only):
{
  "title": "Episode title",
  "script": "Full podcast script text with [MID_ROLL_CTA] marker",
  "description": "2-3 sentence episode description for RSS feed"
}`;

    return { system, user };
}

export function buildNewsletterDraftPrompt(
    persona: Persona,
    topic: Topic,
    longFormScript: string,
): { system: string; user: string } {
    const points = topic.historical_points as HistoricalPoint[];

    const system = `You are a newsletter writer for ${persona.brand}.
Voice style: ${persona.voice_style}
${persona.content_guidelines ? `Guidelines: ${persona.content_guidelines}` : ''}

You write compelling Substack newsletters that expand on video content with deeper analysis, additional context, and reader-friendly formatting.

IMPORTANT RULES:
- NEVER mention the creator's name ("${persona.name}"). Write in first person.
- Format for Substack: use markdown headings (##), bold, italics, blockquotes for source citations.
- Include a compelling subject line that drives opens.
- You MUST respond with valid JSON only. No markdown, no code fences, no explanation.`;

    const user = `TOPIC: ${topic.title}
HOOK: ${topic.hook}

HISTORICAL POINTS:
${points.map(p => `${p.point}. ${p.claim} (Source: ${p.source}, ${p.year})`).join('\n')}

ORIGINAL VIDEO SCRIPT:
${longFormScript}

${persona.newsletter_cta ? `NEWSLETTER CTA: ${persona.newsletter_cta}` : ''}

Transform this into a Substack newsletter post. Structure:

1. SUBJECT LINE: Compelling email subject (50-70 chars) that creates curiosity
2. PREVIEW TEXT: First line shown in email preview (100-140 chars)
3. BODY:
   - Opening hook (different angle from the video)
   - Deep dive into the historical points with additional context
   - Pull quotes from primary sources using blockquotes
   - "Why This Matters Today" section connecting history to present
   - Closing paragraph with CTA to watch the video and share
4. If a newsletter CTA was provided above, incorporate it naturally at the end

OUTPUT FORMAT (JSON only):
{
  "subject": "...",
  "previewText": "...",
  "body": "Full newsletter in markdown format...",
  "estimatedReadTime": 5
}`;

    return { system, user };
}

const REMIX_MAX_TOKENS: Record<RemixField, number> = {
    script: 2048,
    caption_long: 1024,
    caption_short: 1024,
    thumbnail_prompt: 512,
    carousel_slides: 2048,
};

const REMIX_FIELD_LABELS: Record<RemixField, string> = {
    script: 'script (spoken text)',
    caption_long: 'long caption (up to 2200 characters, ending with 3-5 hashtags)',
    caption_short: 'short caption (up to 280 characters for Twitter/X, with 2-3 hashtags)',
    thumbnail_prompt: 'thumbnail image generation prompt',
    carousel_slides: 'carousel slides (array of slide objects with slide number, text, and imagePrompt)',
};

const REMIX_OUTPUT_FORMAT: Record<RemixField, string> = {
    script: '{ "script": "..." }',
    caption_long: '{ "captionLong": "..." }',
    caption_short: '{ "captionShort": "..." }',
    thumbnail_prompt: '{ "thumbnailPrompt": "..." }',
    carousel_slides: '{ "carouselSlides": [{"slide": 1, "text": "...", "imagePrompt": "..."}, ...] }',
};

export function buildRemixPrompt(
    persona: Persona,
    topic: Topic,
    pieceType: PieceType,
    field: RemixField,
    currentValue: string,
): { system: string; user: string; maxTokens: number } {
    const points = topic.historical_points as HistoricalPoint[];

    const system = `You are a content writer creating scripts for ${persona.brand}.
Voice style: ${persona.voice_style}
${persona.content_guidelines ? `Guidelines: ${persona.content_guidelines}` : ''}

IMPORTANT RULES:
- NEVER mention the creator's name ("${persona.name}") anywhere in scripts or captions. Write in first person without self-identifying by name.
- NEVER use a corrective/contrarian pattern like "No, it wasn't X — it was actually Y" or "You might think X, but that's wrong." Instead, lead with the truth directly as a compelling statement or surprising fact.

You MUST respond with valid JSON only. No markdown, no code fences, no explanation.`;

    const user = `TOPIC: ${topic.title}
HOOK: ${topic.hook}
PIECE TYPE: ${pieceType}

HISTORICAL POINTS:
${points.map(p => `${p.point}. ${p.claim} (Source: ${p.source}, ${p.year})`).join('\n')}

CURRENT ${REMIX_FIELD_LABELS[field].toUpperCase()}:
${currentValue}

Generate a FRESH, meaningfully DIFFERENT version of the ${REMIX_FIELD_LABELS[field]} only. Keep the same tone and quality but vary the approach, wording, or structure.

OUTPUT FORMAT (JSON only):
${REMIX_OUTPUT_FORMAT[field]}`;

    return { system, user, maxTokens: REMIX_MAX_TOKENS[field] };
}
