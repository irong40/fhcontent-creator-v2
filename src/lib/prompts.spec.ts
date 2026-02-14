import { describe, it, expect } from 'vitest';
import { buildTopicPrompt, buildContentPrompt } from './prompts';
import type { Persona, Topic } from '@/types/database';

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
    canva_brand_kit_id: null,
    canva_carousel_template_id: null,
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
    publish_time: '09:00:00',
    status: 'draft',
    created_at: '2025-01-01T00:00:00Z',
    topics_approved_at: null,
    content_ready_at: null,
    approved_at: null,
    published_at: null,
    error_message: null,
    retry_count: 0,
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
});
