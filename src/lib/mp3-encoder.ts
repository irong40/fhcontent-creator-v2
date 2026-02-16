/**
 * lamejs wrapper — loads the self-contained bundle lazily
 *
 * lamejs has a systemic bug: internal CJS modules (Lame.js, BitStream.js, etc.)
 * reference each other as globals without require(). The CJS entry point
 * breaks under ESM/vitest transformation. The bundled lame.all.js works
 * because everything shares a single function scope.
 *
 * Fix: load lame.all.js via Function() to capture the lamejs object.
 * Lazy-loaded to avoid readFileSync during Next.js build phase.
 */

import { readFileSync } from 'fs';

type Mp3EncoderType = import('lamejs').Mp3Encoder;
type Mp3EncoderCtor = new (channels: number, sampleRate: number, kbps: number) => Mp3EncoderType;

let _Mp3Encoder: Mp3EncoderCtor | null = null;

export function getMp3Encoder(): Mp3EncoderCtor {
    if (!_Mp3Encoder) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const lamejsPath = require.resolve('lamejs/lame.all.js');
        const code = readFileSync(lamejsPath, 'utf8');
        const factory = new Function(`${code}\nreturn lamejs;`);
        const bundle = factory() as { Mp3Encoder: Mp3EncoderCtor };
        _Mp3Encoder = bundle.Mp3Encoder;
    }
    return _Mp3Encoder;
}
