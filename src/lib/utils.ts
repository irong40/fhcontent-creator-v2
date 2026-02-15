import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Claude Sonnet 4.5 pricing: $3/M input, $15/M output */
export function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function estimateDuration(words: number): string {
  const minutes = words / 150; // ~150 wpm speaking rate
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  return `${minutes.toFixed(1)} min`;
}

/** ElevenLabs TTS pricing: ~$0.30 per 1K characters */
export function estimateElevenLabsCost(charCount: number): number {
  return (charCount / 1000) * 0.30;
}

/** DALL-E 3 pricing: $0.04/image standard, $0.08/image HD */
export function estimateDalleCost(count: number, quality: 'standard' | 'hd' = 'standard'): number {
  const perImage = quality === 'hd' ? 0.08 : 0.04;
  return count * perImage;
}
