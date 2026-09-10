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

/**
 * Detect an image's real media type from its magic bytes.
 *
 * The image ladder mixes formats — gpt-image-1 returns PNG, Library of Congress
 * derivatives are JPEG — and both consumers of these bytes break on a wrong
 * label: the vision audit 400s (which is swallowed as a rejection), and satori
 * throws a RangeError trying to parse a PNG as a JPEG. Never assume the format;
 * read it.
 */
export function sniffImageMime(image: ArrayBuffer): 'image/png' | 'image/jpeg' {
  const head = new Uint8Array(image.slice(0, 4));
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png';
  // Unknown container: PNG is the safer default — satori tolerates a mislabelled
  // PNG far better than it tolerates a mislabelled JPEG.
  return 'image/png';
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
