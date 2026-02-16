import { describe, it, expect } from 'vitest';
import { pcmToMp3 } from './gemini';

describe('pcmToMp3', () => {
    it('converts stereo PCM Int16 samples to a non-empty MP3 ArrayBuffer', () => {
        // Generate 0.1s of 48kHz stereo silence (interleaved L/R)
        const sampleRate = 48000;
        const channels = 2;
        const durationSeconds = 0.1;
        const totalSamples = sampleRate * channels * durationSeconds;
        const pcm = new Int16Array(totalSamples); // all zeros = silence

        const mp3 = pcmToMp3(pcm);

        expect(mp3).toBeInstanceOf(ArrayBuffer);
        expect(mp3.byteLength).toBeGreaterThan(0);
    });

    it('produces larger output for longer input', () => {
        const short = new Int16Array(48000 * 2 * 0.1); // 0.1s stereo
        const long = new Int16Array(48000 * 2 * 1);    // 1.0s stereo

        const shortMp3 = pcmToMp3(short);
        const longMp3 = pcmToMp3(long);

        expect(longMp3.byteLength).toBeGreaterThan(shortMp3.byteLength);
    });

    it('handles a single MP3 frame worth of samples', () => {
        // 1152 samples per channel is one MP3 frame
        const pcm = new Int16Array(1152 * 2);
        const mp3 = pcmToMp3(pcm);

        expect(mp3).toBeInstanceOf(ArrayBuffer);
        expect(mp3.byteLength).toBeGreaterThan(0);
    });
});
