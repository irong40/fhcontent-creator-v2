import { describe, it, expect } from 'vitest';
import { buildTopicPrompt, buildContentPrompt, buildRemixPrompt } from './prompts';
import type { RemixField } from './prompts';
import type { Persona, Topic, PieceType } from '@/types/database';

const mockPersona: Persona = {
    id: '6ac9adfa-27f1-492b-98e1-f5623cb4eda2',
    name: 'Dr. Imani Carter',
    brand: 'History Unveiled VA',
    tagline: 'Uncovering untold stories',
    expertise_areas: ['Civil Rights Movement', 'African American Genealogy'],
    voice_style: 'Authoritative yet accessible',
    content_guidelines: 'Always cite primary sources',
    platform_accounts: { tiktok: '5294', instagram: '4346' },
    voice_pool: ['voice1', 'voice2'],
    profile_image_url: null,
    heygen_avatar_id: null,
    heygen_voice_id: null,
    canva_brand_kit_id: null,
    canva_carousel_template_id: null,
    blotato_template_id: null,
    brand_id: null,
    newsletter_url: null,
    newsletter_cta: null,
    image_subject_constraint: null,
    content_guardrail: null,
    guardrail_notebook_ids: null,
    facebook_page_ids: null,
    facebook_enabled: false,
    default_music_url: null,
    content_format: 'standard',
    blotato_video_enabled: false,
    style_brief: null,
    is_active: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
};

const mockTopic: Topic = {
    id: 'topic-uuid-1234',
    persona_id: mockPersona.id,
    title: "Gabriel's Rebellion of 1800",
    hook: 'Did you know the largest planned rebellion...',
    historical_points: [
        { point: 1, claim: 'Gabriel was enslaved', source: 'Court records', year: '1799' },
        { point: 2, claim: 'Over 1000 rebels', source: 'Archives', year: '1800' },
        { point: 3, claim: 'Betrayed by informants', source: 'Trial records', year: '1800' },
        { point: 4, claim: 'Gabriel was executed', source: 'State records', year: '1800' },
    ],
    topic_hash: 'abc123',
    voice_id: 'voice1',
    thumbnail_prompt: null,
    publish_date: null,
    publish_at: null,
    publish_time: '09:00:00',
    status: 'draft',
    created_at: '2025-01-01T00:00:00Z',
    topics_approved_at: null,
    content_ready_at: null,
    approved_at: null,
    published_at: null,
    error_message: null,
    retry_count: 0,
    is_evergreen: false,
    source_verified: false,
    requires_review: false,
    review_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    content_channel: 'social' as const,
    lecture_data: null,
    coo_auto_approved_at: null,
};

describe('buildTopicPrompt', () => {
    it('returns system and user strings', () => {
        const result = buildTopicPrompt(mockPersona, [], 1);
        expect(result).toHaveProperty('system');
        expect(result).toHaveProperty('user');
        expect(typeof result.system).toBe('string');
        expect(typeof result.user).toBe('string');
    });

    it('includes persona name and brand in system prompt', () => {
        const { system } = buildTopicPrompt(mockPersona, [], 1);
        expect(system).toContain('Dr. Imani Carter');
        expect(system).toContain('History Unveiled VA');
    });

    it('includes voice style in system prompt', () => {
        const { system } = buildTopicPrompt(mockPersona, [], 1);
        expect(system).toContain('Authoritative yet accessible');
    });

    it('includes content guidelines when present', () => {
        const { system } = buildTopicPrompt(mockPersona, [], 1);
        expect(system).toContain('Always cite primary sources');
    });

    it('omits guidelines line when null', () => {
        const noGuidelines = { ...mockPersona, content_guidelines: null };
        const { system } = buildTopicPrompt(noGuidelines, [], 1);
        expect(system).not.toContain('Guidelines:');
    });

    it('includes expertise areas in user prompt', () => {
        const { user } = buildTopicPrompt(mockPersona, [], 1);
        expect(user).toContain('Civil Rights Movement');
        expect(user).toContain('African American Genealogy');
    });

    it('includes recent topics in avoidance list', () => {
        const recent = ['Topic A', 'Topic B'];
        const { user } = buildTopicPrompt(mockPersona, recent, 1);
        expect(user).toContain('Topic A');
        expect(user).toContain('Topic B');
    });

    it('shows "None yet" when no recent topics', () => {
        const { user } = buildTopicPrompt(mockPersona, [], 1);
        expect(user).toContain('None yet');
    });

    it('includes requested count in user prompt', () => {
        const { user } = buildTopicPrompt(mockPersona, [], 3);
        expect(user).toContain('exactly 3 unique');
    });

    it('demands JSON-only output in system prompt', () => {
        const { system } = buildTopicPrompt(mockPersona, [], 1);
        expect(system).toContain('valid JSON only');
    });

    it('omits winners block when no winners provided', () => {
        const { user } = buildTopicPrompt(mockPersona, [], 7);
        expect(user).not.toContain('PROVEN WINNERS');
        expect(user).not.toContain('WINNER REMIXES');
    });

    it('omits winners block when fewer than 3 winners', () => {
        const winners = [
            { title: 'Winner A', views: 1000, likes: 50 },
            { title: 'Winner B', views: 900, likes: 40 },
        ];
        const { user } = buildTopicPrompt(mockPersona, [], 7, winners);
        expect(user).not.toContain('PROVEN WINNERS');
    });

    it('includes winners block with remix instruction for weekly batch', () => {
        const winners = [
            { title: 'The Accomack County Oyster Queens', views: 4843, likes: 235 },
            { title: 'The Orange County Timber Riders', views: 4356, likes: 196 },
            { title: 'The Mecklenburg County Hog Drivers', views: 3743, likes: 184 },
        ];
        const { user } = buildTopicPrompt(mockPersona, [], 7, winners);
        expect(user).toContain('PROVEN WINNERS');
        expect(user).toContain('The Accomack County Oyster Queens');
        expect(user).toContain('4,843 views');
        expect(user).toContain('exactly 2 must be WINNER REMIXES');
        expect(user).toContain('5 topics must be fresh stories');
    });

    it('scales remix count down for small batches', () => {
        const winners = [
            { title: 'Winner A', views: 1000, likes: 50 },
            { title: 'Winner B', views: 900, likes: 40 },
            { title: 'Winner C', views: 800, likes: 30 },
        ];
        const { user } = buildTopicPrompt(mockPersona, [], 2, winners);
        expect(user).toContain('exactly 1 must be WINNER REMIXES');
        const single = buildTopicPrompt(mockPersona, [], 1, winners);
        expect(single.user).not.toContain('PROVEN WINNERS');
    });

    it('does not leak winners block into quote_video personas', () => {
        const quotePersona = { ...mockPersona, content_format: 'quote_video' as const };
        const winners = [
            { title: 'Winner A', views: 1000, likes: 50 },
            { title: 'Winner B', views: 900, likes: 40 },
            { title: 'Winner C', views: 800, likes: 30 },
        ];
        const { user } = buildTopicPrompt(quotePersona, [], 7, winners);
        expect(user).not.toContain('PROVEN WINNERS');
    });
});

describe('buildContentPrompt', () => {
    it('returns system and user strings', () => {
        const result = buildContentPrompt(mockPersona, mockTopic);
        expect(result).toHaveProperty('system');
        expect(result).toHaveProperty('user');
    });

    it('includes topic title and hook in user prompt', () => {
        const { user } = buildContentPrompt(mockPersona, mockTopic);
        expect(user).toContain("Gabriel's Rebellion of 1800");
        expect(user).toContain('Did you know the largest planned rebellion');
    });

    it('lists all 4 historical points in user prompt', () => {
        const { user } = buildContentPrompt(mockPersona, mockTopic);
        expect(user).toContain('Gabriel was enslaved');
        expect(user).toContain('Over 1000 rebels');
        expect(user).toContain('Betrayed by informants');
        expect(user).toContain('Gabriel was executed');
    });

    it('includes source citations in user prompt', () => {
        const { user } = buildContentPrompt(mockPersona, mockTopic);
        expect(user).toContain('Court records');
        expect(user).toContain('1799');
    });

    it('specifies all 6 piece types in user prompt', () => {
        const { user } = buildContentPrompt(mockPersona, mockTopic);
        expect(user).toContain('"long"');
        expect(user).toContain('"short_1"');
        expect(user).toContain('"short_2"');
        expect(user).toContain('"short_3"');
        expect(user).toContain('"short_4"');
        expect(user).toContain('"carousel"');
    });

    it('demands JSON-only output in system prompt', () => {
        const { system } = buildContentPrompt(mockPersona, mockTopic);
        expect(system).toContain('valid JSON only');
    });

    it('includes persona voice style in system prompt', () => {
        const { system } = buildContentPrompt(mockPersona, mockTopic);
        expect(system).toContain('Authoritative yet accessible');
    });

    it('includes musicTrack in video piece output format examples', () => {
        const { user } = buildContentPrompt(mockPersona, mockTopic);
        // All video pieces should have musicTrack in their JSON example
        const longMatch = user.match(/"pieceType": "long".*?"musicTrack"/s);
        const short1Match = user.match(/"pieceType": "short_1".*?"musicTrack"/s);
        const short4Match = user.match(/"pieceType": "short_4".*?"musicTrack"/s);
        expect(longMatch).not.toBeNull();
        expect(short1Match).not.toBeNull();
        expect(short4Match).not.toBeNull();
    });

    it('includes musicTrack instruction for mood selection', () => {
        const { user } = buildContentPrompt(mockPersona, mockTopic);
        expect(user).toContain('musicTrack');
        expect(user).toContain('mood');
    });
});

describe('buildRemixPrompt', () => {
    const fields: RemixField[] = ['script', 'caption_long', 'caption_short', 'thumbnail_prompt', 'carousel_slides'];
    const pieceType: PieceType = 'long';
    const currentValue = 'Some existing content here';

    it('returns system, user, and maxTokens', () => {
        const result = buildRemixPrompt(mockPersona, mockTopic, pieceType, 'script', currentValue);
        expect(result).toHaveProperty('system');
        expect(result).toHaveProperty('user');
        expect(result).toHaveProperty('maxTokens');
        expect(typeof result.maxTokens).toBe('number');
    });

    it('includes persona voice style and no-name rule in system prompt', () => {
        const { system } = buildRemixPrompt(mockPersona, mockTopic, pieceType, 'script', currentValue);
        expect(system).toContain('Authoritative yet accessible');
        expect(system).toContain('NEVER mention the creator');
        expect(system).toContain('Dr. Imani Carter');
    });

    it('includes current value in user prompt', () => {
        const { user } = buildRemixPrompt(mockPersona, mockTopic, pieceType, 'script', currentValue);
        expect(user).toContain('Some existing content here');
    });

    it('includes topic title and historical points', () => {
        const { user } = buildRemixPrompt(mockPersona, mockTopic, pieceType, 'script', currentValue);
        expect(user).toContain("Gabriel's Rebellion of 1800");
        expect(user).toContain('Gabriel was enslaved');
    });

    const fieldKeywords: Record<RemixField, string> = {
        script: 'script',
        caption_long: 'long caption',
        caption_short: 'short caption',
        thumbnail_prompt: 'thumbnail',
        carousel_slides: 'carousel slides',
    };

    it.each(fields)('returns different user prompt for field "%s"', (field) => {
        const result = buildRemixPrompt(mockPersona, mockTopic, pieceType, field, currentValue);
        expect(result.user.toLowerCase()).toContain(fieldKeywords[field]);
    });

    it('uses lower maxTokens for thumbnail_prompt than script', () => {
        const script = buildRemixPrompt(mockPersona, mockTopic, pieceType, 'script', currentValue);
        const thumb = buildRemixPrompt(mockPersona, mockTopic, pieceType, 'thumbnail_prompt', currentValue);
        expect(thumb.maxTokens).toBeLessThan(script.maxTokens);
    });

    it('demands JSON-only output in system prompt', () => {
        const { system } = buildRemixPrompt(mockPersona, mockTopic, pieceType, 'script', currentValue);
        expect(system).toContain('valid JSON only');
    });

    it('includes content guidelines when present', () => {
        const { system } = buildRemixPrompt(mockPersona, mockTopic, pieceType, 'script', currentValue);
        expect(system).toContain('Always cite primary sources');
    });

    it('omits guidelines line when null', () => {
        const noGuidelines = { ...mockPersona, content_guidelines: null };
        const { system } = buildRemixPrompt(noGuidelines, mockTopic, pieceType, 'script', currentValue);
        expect(system).not.toContain('Guidelines:');
    });
});

describe('style brief injection', () => {
    const BRIEF_HEADER = 'NICHE STYLE BRIEF';
    const brief = 'TITLES: pose a question with a hard number. HOOKS: open cold on the stakes.';

    describe('absence invariant', () => {
        it('produces no brief block for a persona without style_brief', () => {
            const topic = buildTopicPrompt(mockPersona, [], 7);
            const content = buildContentPrompt(mockPersona, mockTopic);
            const remix = buildRemixPrompt(mockPersona, mockTopic, 'long', 'script', 'v');
            for (const out of [topic.system, topic.user, content.system, content.user, remix.system, remix.user]) {
                expect(out).not.toContain(BRIEF_HEADER);
            }
        });

        it('produces byte-identical prompts for null vs absent style_brief', () => {
            const nullPersona = { ...mockPersona, style_brief: null };
            expect(buildTopicPrompt(nullPersona, [], 7)).toEqual(buildTopicPrompt(mockPersona, [], 7));
            expect(buildContentPrompt(nullPersona, mockTopic)).toEqual(buildContentPrompt(mockPersona, mockTopic));
            expect(buildRemixPrompt(nullPersona, mockTopic, 'long', 'script', 'v'))
                .toEqual(buildRemixPrompt(mockPersona, mockTopic, 'long', 'script', 'v'));
        });

        it('produces byte-identical prompts for empty-string style_brief', () => {
            const emptyPersona = { ...mockPersona, style_brief: '' };
            expect(buildTopicPrompt(emptyPersona, [], 7)).toEqual(buildTopicPrompt(mockPersona, [], 7));
            expect(buildContentPrompt(emptyPersona, mockTopic)).toEqual(buildContentPrompt(mockPersona, mockTopic));
        });
    });

    describe('presence', () => {
        it('injects the brief into buildTopicPrompt system prompt', () => {
            const { system } = buildTopicPrompt({ ...mockPersona, style_brief: brief }, [], 7);
            expect(system).toContain(BRIEF_HEADER);
            expect(system).toContain(brief);
        });

        it('injects the brief into the quote topic prompt for quote_video personas', () => {
            const quotePersona = { ...mockPersona, content_format: 'quote_video' as const, style_brief: brief };
            const { system } = buildTopicPrompt(quotePersona, [], 7);
            expect(system).toContain(BRIEF_HEADER);
            expect(system).toContain(brief);
        });

        it('injects the brief into buildContentPrompt system prompt (not user)', () => {
            const { system, user } = buildContentPrompt({ ...mockPersona, style_brief: brief }, mockTopic);
            expect(system).toContain(BRIEF_HEADER);
            expect(system).toContain(brief);
            expect(user).not.toContain(BRIEF_HEADER);
        });

        it('injects the brief into buildRemixPrompt system prompt', () => {
            const { system } = buildRemixPrompt({ ...mockPersona, style_brief: brief }, mockTopic, 'long', 'script', 'v');
            expect(system).toContain(BRIEF_HEADER);
            expect(system).toContain(brief);
        });
    });

    describe('sanitization', () => {
        it('replaces straight double quotes with single quotes', () => {
            const p = { ...mockPersona, style_brief: 'Titles pose "questions" often' };
            const { system } = buildTopicPrompt(p, [], 7);
            expect(system).toContain("Titles pose 'questions' often");
            expect(system).not.toContain('"questions"');
        });

        it('truncates briefs longer than 1500 chars', () => {
            const p = { ...mockPersona, style_brief: 'a'.repeat(2000) };
            const { system } = buildTopicPrompt(p, [], 7);
            expect(system).toContain('a'.repeat(1500));
            expect(system).not.toContain('a'.repeat(1501));
        });
    });

    describe('whitespace-only brief', () => {
        it('treats a whitespace-only brief as absent (byte-identical prompts)', () => {
            const p = { ...mockPersona, style_brief: '   \n\t  ' };
            expect(buildTopicPrompt(p, [], 7)).toEqual(buildTopicPrompt(mockPersona, [], 7));
            expect(buildContentPrompt(p, mockTopic)).toEqual(buildContentPrompt(mockPersona, mockTopic));
            expect(buildRemixPrompt(p, mockTopic, 'long', 'script', 'v'))
                .toEqual(buildRemixPrompt(mockPersona, mockTopic, 'long', 'script', 'v'));
        });
    });

    describe('quote content no-op', () => {
        it('never injects the brief into quote_video content prompts', () => {
            const quotePersona = { ...mockPersona, content_format: 'quote_video' as const, style_brief: brief };
            const { system, user } = buildContentPrompt(quotePersona, mockTopic);
            expect(system).not.toContain(BRIEF_HEADER);
            expect(user).not.toContain(BRIEF_HEADER);
        });
    });
});
