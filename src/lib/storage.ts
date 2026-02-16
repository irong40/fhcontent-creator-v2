/**
 * Supabase Storage helpers for media files (audio, video, images)
 */

import { createAdminClient } from '@/lib/supabase/server';

const BUCKET_NAME = 'media';

export async function ensureBucket(): Promise<void> {
    const supabase = createAdminClient();
    const { data } = await supabase.storage.getBucket(BUCKET_NAME);
    if (data) return;

    const { error } = await supabase.storage.createBucket(BUCKET_NAME, {
        public: true,
        fileSizeLimit: 52428800, // 50 MB (Supabase free tier limit)
        allowedMimeTypes: ['audio/mpeg', 'audio/wav', 'audio/mp4', 'video/mp4', 'image/png', 'image/jpeg'],
    });

    if (error && !error.message.includes('already exists')) {
        throw new Error(`Failed to create storage bucket: ${error.message}`);
    }
}

async function uploadFile(
    path: string,
    data: ArrayBuffer,
    contentType: string,
): Promise<string> {
    await ensureBucket();
    const supabase = createAdminClient();

    const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(path, data, {
            contentType,
            upsert: true,
        });

    if (error) {
        throw new Error(`Storage upload failed: ${error.message}`);
    }

    const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(path);

    return urlData.publicUrl;
}

export function uploadAudio(path: string, data: ArrayBuffer): Promise<string> {
    return uploadFile(path, data, 'audio/mpeg');
}

export function uploadImage(
    path: string,
    data: ArrayBuffer,
    contentType: 'image/png' | 'image/jpeg' = 'image/png',
): Promise<string> {
    return uploadFile(path, data, contentType);
}

export { BUCKET_NAME };
