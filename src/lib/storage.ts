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
        fileSizeLimit: 104857600, // 100 MB
        allowedMimeTypes: ['audio/mpeg', 'audio/wav', 'audio/mp4', 'video/mp4', 'image/png', 'image/jpeg'],
    });

    if (error && !error.message.includes('already exists')) {
        throw new Error(`Failed to create storage bucket: ${error.message}`);
    }
}

export async function uploadAudio(
    path: string,
    data: ArrayBuffer,
): Promise<string> {
    await ensureBucket();
    const supabase = createAdminClient();

    const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(path, data, {
            contentType: 'audio/mpeg',
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

export async function uploadImage(
    path: string,
    data: ArrayBuffer,
    contentType: 'image/png' | 'image/jpeg' = 'image/png',
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

export { BUCKET_NAME };
