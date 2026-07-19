import { describe, it, expect } from 'vitest';
import { getTargetPlatforms, getConfiguredTargetPlatforms, resolveFacebookPageId } from './helpers';
import { buildTarget, type FacebookTarget } from '@/lib/blotato';
import type { PlatformAccounts } from '@/types/database';

const SAI_PAGE = '899526466587385';

describe('resolveFacebookPageId', () => {
    it('prefers the first facebook_page_ids entry', () => {
        expect(resolveFacebookPageId({ facebook: '3684' }, [SAI_PAGE, 'other'])).toBe(SAI_PAGE);
    });
    it('falls back to legacy platform_accounts.facebook_page', () => {
        expect(resolveFacebookPageId({ facebook_page: '123' }, null)).toBe('123');
    });
    it('returns null when no page is configured', () => {
        expect(resolveFacebookPageId({ facebook: '3684' }, [])).toBeNull();
        expect(resolveFacebookPageId({}, null)).toBeNull();
    });
});

describe('getConfiguredTargetPlatforms — Facebook gating', () => {
    const accounts: PlatformAccounts = { youtube: '30796', facebook: '3684' };

    it('includes facebook only when opted in, connected, and a page resolves', () => {
        const t = getConfiguredTargetPlatforms('short_1', accounts, { enabled: true, pageIds: [SAI_PAGE] });
        expect(t).toContain('facebook');
        expect(t).toContain('youtube');
    });

    it('excludes facebook when not opted in (default off)', () => {
        const t = getConfiguredTargetPlatforms('short_1', accounts, { enabled: false, pageIds: [SAI_PAGE] });
        expect(t).not.toContain('facebook');
        expect(t).toContain('youtube');
    });

    it('excludes facebook when opted in but no page id resolves', () => {
        const t = getConfiguredTargetPlatforms('short_1', accounts, { enabled: true, pageIds: [] });
        expect(t).not.toContain('facebook');
    });

    it('excludes facebook when the FB account is not connected', () => {
        const t = getConfiguredTargetPlatforms('short_1', { youtube: '30796' }, { enabled: true, pageIds: [SAI_PAGE] });
        expect(t).not.toContain('facebook');
    });

    it('carousel never targets facebook', () => {
        const t = getConfiguredTargetPlatforms('carousel', accounts, { enabled: true, pageIds: [SAI_PAGE] });
        expect(t).not.toContain('facebook');
    });

    it('facebook is in the video distribution matrix', () => {
        expect(getTargetPlatforms('short_1')).toContain('facebook');
        expect(getTargetPlatforms('long')).toContain('facebook');
        expect(getTargetPlatforms('quote_video')).toContain('facebook');
    });
});

describe('buildTarget(facebook)', () => {
    it('builds a Reel target carrying the pageId', () => {
        const t = buildTarget('facebook', { pageId: SAI_PAGE }) as FacebookTarget;
        expect(t.targetType).toBe('facebook');
        expect(t.pageId).toBe(SAI_PAGE);
        expect(t.mediaType).toBe('reel');
    });
});
