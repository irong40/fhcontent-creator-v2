import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Claude Sonnet 4.5 pricing: $3/M input, $15/M output */
export function estimateClaudeCost(inputTokens: number, outputTokens: number): number {
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

/** ElevenLabs TTS pricing: $0.30/1K chars (Starter), $0.18/1K chars (Scale) */
export function estimateElevenLabsCost(charCount: number, tier: 'starter' | 'scale' = 'starter'): number {
  const rate = tier === 'scale' ? 0.18 : 0.30;
  return (charCount / 1000) * rate;
}

/** DALL-E 3 pricing: $0.04/image standard, $0.08/image HD */
export function estimateDalleCost(count: number, quality: 'standard' | 'hd' = 'standard'): number {
  const perImage = quality === 'hd' ? 0.08 : 0.04;
  return count * perImage;
}

/** Replace {token} placeholders in a template string. Unknown tokens are left as-is. */
export function interpolateTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? vars[key] : match,
  );
}

/** Decode a base64 string to an ArrayBuffer */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes.buffer;
}
