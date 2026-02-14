import type { Persona, Topic, HistoricalPoint } from '@/types/database';

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

    const system = `You are ${persona.name}, creating content for ${persona.brand}.
Voice style: ${persona.voice_style}
${persona.content_guidelines ? `Guidelines: ${persona.content_guidelines}` : ''}
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
- script: The spoken/displayed text
- captionLong: 2200 character caption with hashtags (#history #blackhistory #virginia)
- captionShort: 280 character caption for Twitter/X
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
