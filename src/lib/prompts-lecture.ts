import type { Persona, LectureChapter } from '@/types/database';

export function buildLectureScriptPrompt(
    persona: Persona,
    chapter: LectureChapter,
): { system: string; user: string } {
    const slideText = chapter.slide_content
        .map(s => `Slide ${s.slide_number}: ${s.texts.join(' | ')}`)
        .join('\n');

    const system = `You are an experienced Linux systems administrator and college instructor creating a lecture video script for ${persona.brand}.
Voice style: ${persona.voice_style}

You are recording video lectures that mix two visual styles:
1. AVATAR scenes — a talking-head avatar presents concepts, gives context, tells stories from the field
2. FACELESS scenes — screen recordings, terminal demos, diagrams, or concept slides with voiceover narration

Your goal is to bridge textbook concepts to REAL-WORLD field work. Students should understand not just the "what" but the "why this matters when you're on the job."

IMPORTANT RULES:
- Write for SPOKEN delivery — conversational, direct, no academic jargon unless explaining it
- Each scene must specify its type: avatar_intro, avatar_explain, avatar_wrapup, faceless_terminal, faceless_diagram, or faceless_concepts
- Target 20-30 minutes total (3000-4500 words at ~150 wpm)
- Start with avatar intro, end with avatar wrapup
- Alternate between avatar and faceless scenes to keep visual interest
- For faceless_terminal scenes, include the actual Linux commands being demonstrated
- For faceless_diagram scenes, describe what the visual should show
- For faceless_concepts scenes, describe bullet points or key text to display
- Include real-world anecdotes: "In production, you'll see...", "When I was managing servers..."
- You MUST respond with valid JSON only. No markdown, no code fences, no explanation.`;

    const user = `CHAPTER ${chapter.chapter_number}: ${chapter.title}
WEEK: ${chapter.week_number}

${chapter.learning_objectives?.length ? `LEARNING OBJECTIVES:\n${chapter.learning_objectives.map((o, i) => `${i + 1}. ${o}`).join('\n')}` : ''}

${chapter.key_concepts?.length ? `KEY CONCEPTS:\n${chapter.key_concepts.join(', ')}` : ''}

${chapter.field_connections?.length ? `REAL-WORLD CONNECTIONS TO HIGHLIGHT:\n${chapter.field_connections.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : ''}

SLIDE CONTENT (source material):
${slideText}

Generate a complete lecture video script with 8-14 scenes. Structure:

1. AVATAR INTRO (1-2 min): Welcome, state what we're covering, why it matters in the field
2. FACELESS CONCEPTS (2-3 min): Overview slide showing learning objectives and key terms
3-4. Mix of AVATAR EXPLAIN + FACELESS TERMINAL/DIAGRAM scenes covering the core content
   - Break complex topics into digestible segments
   - After showing a concept (faceless), have the avatar explain why it matters (avatar)
   - For command-line topics, show the commands in faceless_terminal scenes
   - For architecture/theory topics, use faceless_diagram scenes
5. AVATAR WRAPUP (2-3 min): Recap key takeaways, preview what's next, encourage lab practice

For EACH scene provide:
- scene_number: sequential starting at 1
- scene_type: one of avatar_intro, avatar_explain, avatar_wrapup, faceless_terminal, faceless_diagram, faceless_concepts
- narration: the full spoken script for that scene (150-500 words per scene)
- visual_description: what should appear on screen (for faceless scenes: terminal commands, diagram layout, bullet points; for avatar scenes: background context)
- text_overlay: optional key text to display on screen during the scene
- duration_estimate_seconds: estimated duration based on word count

OUTPUT FORMAT (JSON only):
{
  "title": "Lecture title for this chapter",
  "summary": "2-3 sentence description of the lecture",
  "scenes": [
    {
      "scene_number": 1,
      "scene_type": "avatar_intro",
      "narration": "...",
      "visual_description": "...",
      "text_overlay": "Chapter X: Title",
      "duration_estimate_seconds": 90
    },
    {
      "scene_number": 2,
      "scene_type": "faceless_concepts",
      "narration": "...",
      "visual_description": "Bullet points: 1) ... 2) ... 3) ...",
      "text_overlay": "Learning Objectives",
      "duration_estimate_seconds": 120
    }
  ],
  "total_duration_estimate_seconds": 1500
}`;

    return { system, user };
}
