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
- End with call to action (follow for more)

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

OUTPUT FORMAT (JSON only):
{
  "pieces": [
    {"pieceType": "long", "script": "...", "captionLong": "...", "captionShort": "...", "thumbnailPrompt": "..."},
    {"pieceType": "short_1", "script": "...", "captionLong": "...", "captionShort": "...", "thumbnailPrompt": "..."},
    {"pieceType": "short_2", "script": "...", "captionLong": "...", "captionShort": "...", "thumbnailPrompt": "..."},
    {"pieceType": "short_3", "script": "...", "captionLong": "...", "captionShort": "...", "thumbnailPrompt": "..."},
    {"pieceType": "short_4", "script": "...", "captionLong": "...", "captionShort": "...", "thumbnailPrompt": "..."},
    {"pieceType": "carousel", "script": "...", "captionLong": "...", "captionShort": "...", "carouselSlides": [{"slide": 1, "text": "...", "imagePrompt": "..."}, ...], "musicTrack": "inspirational"}
  ]
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
