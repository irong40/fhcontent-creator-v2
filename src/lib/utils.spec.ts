import { describe, it, expect } from 'vitest';
import { estimateCost, wordCount, estimateDuration, estimateElevenLabsCost, estimateDalleCost } from './utils';

describe('estimateCost', () => {
    it('returns 0 for zero tokens', () => {
        expect(estimateCost(0, 0)).toBe(0);
    });

    it('calculates input-only cost correctly', () => {
        // 1M input tokens * $3/M = $3.00
        expect(estimateCost(1_000_000, 0)).toBe(3);
    });

    it('calculates output-only cost correctly', () => {
        // 1M output tokens * $15/M = $15.00
        expect(estimateCost(0, 1_000_000)).toBe(15);
    });

    it('calculates mixed cost correctly', () => {
        // 7000 input * $3/M + 2000 output * $15/M = $0.021 + $0.03 = $0.051
        expect(estimateCost(7000, 2000)).toBeCloseTo(0.051, 6);
    });

    it('handles typical topic generation usage', () => {
        // ~7K in, ~2K out — should be around $0.05
        const cost = estimateCost(7000, 2000);
        expect(cost).toBeGreaterThan(0.04);
        expect(cost).toBeLessThan(0.06);
    });
});

describe('wordCount', () => {
    it('counts words in a normal sentence', () => {
        expect(wordCount('hello world foo bar')).toBe(4);
    });

    it('returns 0 for empty string', () => {
        expect(wordCount('')).toBe(0);
    });

    it('returns 0 for whitespace-only string', () => {
        expect(wordCount('   \t\n  ')).toBe(0);
    });

    it('handles single word', () => {
        expect(wordCount('hello')).toBe(1);
    });

    it('handles multiple spaces between words', () => {
        expect(wordCount('hello    world')).toBe(2);
    });

    it('handles leading and trailing whitespace', () => {
        expect(wordCount('  hello world  ')).toBe(2);
    });

    it('handles newlines and tabs', () => {
        expect(wordCount("hello\nworld\tfoo")).toBe(3);
    });

    it('counts a realistic script length', () => {
        const script = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ');
        expect(wordCount(script)).toBe(500);
    });
});

describe('estimateDuration', () => {
    it('returns seconds for short scripts', () => {
        expect(estimateDuration(75)).toBe('30s');
    });

    it('returns minutes for longer scripts', () => {
        expect(estimateDuration(150)).toBe('1.0 min');
    });

    it('returns 0s for zero words', () => {
        expect(estimateDuration(0)).toBe('0s');
    });

    it('returns fractional minutes for 500 words', () => {
        // 500 / 150 = 3.33 min
        expect(estimateDuration(500)).toBe('3.3 min');
    });

    it('rounds seconds to nearest integer', () => {
        // 50 words / 150 wpm = 0.333 min = 20s
        expect(estimateDuration(50)).toBe('20s');
    });

    it('boundary: 149 words stays in seconds', () => {
        // 149/150 = 0.993 min < 1 → seconds
        const result = estimateDuration(149);
        expect(result).toMatch(/^\d+s$/);
    });

    it('boundary: 150 words switches to minutes', () => {
        const result = estimateDuration(150);
        expect(result).toMatch(/min$/);
    });
});

describe('estimateElevenLabsCost', () => {
    it('returns 0 for zero characters', () => {
        expect(estimateElevenLabsCost(0)).toBe(0);
    });

    it('calculates cost for 1K characters', () => {
        // 1000 chars * $0.30/1K = $0.30
        expect(estimateElevenLabsCost(1000)).toBeCloseTo(0.30, 6);
    });

    it('calculates cost for a typical short script (~400 chars)', () => {
        // 400 / 1000 * 0.30 = $0.12
        expect(estimateElevenLabsCost(400)).toBeCloseTo(0.12, 6);
    });

    it('calculates cost for a long script (~3000 chars)', () => {
        // 3000 / 1000 * 0.30 = $0.90
        expect(estimateElevenLabsCost(3000)).toBeCloseTo(0.90, 6);
    });
});

describe('estimateDalleCost', () => {
    it('returns 0 for zero images', () => {
        expect(estimateDalleCost(0)).toBe(0);
    });

    it('calculates standard quality cost', () => {
        // 1 image * $0.04 = $0.04
        expect(estimateDalleCost(1)).toBeCloseTo(0.04, 6);
    });

    it('calculates HD quality cost', () => {
        // 1 image * $0.08 = $0.08
        expect(estimateDalleCost(1, 'hd')).toBeCloseTo(0.08, 6);
    });

    it('calculates batch cost', () => {
        // 6 images * $0.04 = $0.24
        expect(estimateDalleCost(6)).toBeCloseTo(0.24, 6);
    });

    it('returns negative for negative count', () => {
        expect(estimateDalleCost(-1)).toBeCloseTo(-0.04, 6);
    });

    it('handles fractional count', () => {
        // 0.5 * $0.04 = $0.02
        expect(estimateDalleCost(0.5)).toBeCloseTo(0.02, 6);
    });
});
