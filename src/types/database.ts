export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[];

export interface Database {
    public: {
        Tables: {
            personas: {
                Row: {
                    id: string;
                    name: string;
                    brand: string;
                    tagline: string | null;
                    expertise_areas: string[];
                    voice_style: string;
                    content_guidelines: string | null;
                    platform_accounts: PlatformAccounts;
                    voice_pool: string[];
                    profile_image_url: string | null;
                    heygen_avatar_id: string | null;
                    canva_brand_kit_id: string | null;
                    canva_carousel_template_id: string | null;
                    is_active: boolean;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    name: string;
                    brand: string;
                    tagline?: string | null;
                    expertise_areas: string[];
                    voice_style: string;
                    content_guidelines?: string | null;
                    platform_accounts: PlatformAccounts;
                    voice_pool: string[];
                    profile_image_url?: string | null;
                    heygen_avatar_id?: string | null;
                    canva_brand_kit_id?: string | null;
                    canva_carousel_template_id?: string | null;
                    is_active?: boolean;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    id?: string;
                    name?: string;
                    brand?: string;
                    tagline?: string | null;
                    expertise_areas?: string[];
                    voice_style?: string;
                    content_guidelines?: string | null;
                    platform_accounts?: PlatformAccounts;
                    voice_pool?: string[];
                    profile_image_url?: string | null;
                    heygen_avatar_id?: string | null;
                    canva_brand_kit_id?: string | null;
                    canva_carousel_template_id?: string | null;
                    is_active?: boolean;
                    created_at?: string;
                    updated_at?: string;
                };
                Relationships: [];
            };
            topics: {
                Row: {
                    id: string;
                    persona_id: string;
                    title: string;
                    hook: string;
                    historical_points: HistoricalPoint[];
                    topic_hash: string;
                    voice_id: string;
                    thumbnail_prompt: string | null;
                    publish_date: string | null;
                    publish_time: string;
                    status: TopicStatus;
                    created_at: string;
                    topics_approved_at: string | null;
                    content_ready_at: string | null;
                    approved_at: string | null;
                    published_at: string | null;
                    error_message: string | null;
                    retry_count: number;
                };
                Insert: {
                    id?: string;
                    persona_id: string;
                    title: string;
                    hook: string;
                    historical_points: HistoricalPoint[];
                    topic_hash: string;
                    voice_id: string;
                    thumbnail_prompt?: string | null;
                    publish_date?: string | null;
                    publish_time?: string;
                    status?: TopicStatus;
                    created_at?: string;
                    topics_approved_at?: string | null;
                    content_ready_at?: string | null;
                    approved_at?: string | null;
                    published_at?: string | null;
                    error_message?: string | null;
                    retry_count?: number;
                };
                Update: {
                    id?: string;
                    persona_id?: string;
                    title?: string;
                    hook?: string;
                    historical_points?: HistoricalPoint[];
                    topic_hash?: string;
                    voice_id?: string;
                    thumbnail_prompt?: string | null;
                    publish_date?: string | null;
                    publish_time?: string;
                    status?: TopicStatus;
                    created_at?: string;
                    topics_approved_at?: string | null;
                    content_ready_at?: string | null;
                    approved_at?: string | null;
                    published_at?: string | null;
                    error_message?: string | null;
                    retry_count?: number;
                };
                Relationships: [
                    {
                        foreignKeyName: "topics_persona_id_fkey";
                        columns: ["persona_id"];
                        isOneToOne: false;
                        referencedRelation: "personas";
                        referencedColumns: ["id"];
                    }
                ];
            };
            content_pieces: {
                Row: {
                    id: string;
                    topic_id: string;
                    piece_type: PieceType;
                    piece_order: number;
                    script: string | null;
                    caption_long: string | null;
                    caption_short: string | null;
                    thumbnail_prompt: string | null;
                    carousel_slides: CarouselSlide[] | null;
                    music_track: string | null;
                    blotato_job_id: string | null;
                    blotato_status: BlotatoStatus | null;
                    heygen_job_id: string | null;
                    heygen_status: string | null;
                    thumbnail_url: string | null;
                    canva_design_id: string | null;
                    video_url: string | null;
                    carousel_url: string | null;
                    published_platforms: PublishedPlatforms;
                    status: PieceStatus;
                    created_at: string;
                    produced_at: string | null;
                    published_at: string | null;
                    error_message: string | null;
                    retry_count: number;
                };
                Insert: {
                    id?: string;
                    topic_id: string;
                    piece_type: PieceType;
                    piece_order: number;
                    script?: string | null;
                    caption_long?: string | null;
                    caption_short?: string | null;
                    thumbnail_prompt?: string | null;
                    carousel_slides?: CarouselSlide[] | null;
                    music_track?: string | null;
                    blotato_job_id?: string | null;
                    blotato_status?: BlotatoStatus | null;
                    heygen_job_id?: string | null;
                    heygen_status?: string | null;
                    thumbnail_url?: string | null;
                    canva_design_id?: string | null;
                    video_url?: string | null;
                    carousel_url?: string | null;
                    published_platforms?: PublishedPlatforms;
                    status?: PieceStatus;
                    created_at?: string;
                    produced_at?: string | null;
                    published_at?: string | null;
                    error_message?: string | null;
                    retry_count?: number;
                };
                Update: {
                    id?: string;
                    topic_id?: string;
                    piece_type?: PieceType;
                    piece_order?: number;
                    script?: string | null;
                    caption_long?: string | null;
                    caption_short?: string | null;
                    thumbnail_prompt?: string | null;
                    carousel_slides?: CarouselSlide[] | null;
                    music_track?: string | null;
                    blotato_job_id?: string | null;
                    blotato_status?: BlotatoStatus | null;
                    heygen_job_id?: string | null;
                    heygen_status?: string | null;
                    thumbnail_url?: string | null;
                    canva_design_id?: string | null;
                    video_url?: string | null;
                    carousel_url?: string | null;
                    published_platforms?: PublishedPlatforms;
                    status?: PieceStatus;
                    created_at?: string;
                    produced_at?: string | null;
                    published_at?: string | null;
                    error_message?: string | null;
                    retry_count?: number;
                };
                Relationships: [
                    {
                        foreignKeyName: "content_pieces_topic_id_fkey";
                        columns: ["topic_id"];
                        isOneToOne: false;
                        referencedRelation: "topics";
                        referencedColumns: ["id"];
                    }
                ];
            };
            voices: {
                Row: {
                    id: string;
                    name: string;
                    gender: string | null;
                    accent: string | null;
                    style: string | null;
                    last_used_at: string | null;
                    use_count: number;
                    is_active: boolean;
                    created_at: string;
                };
                Insert: {
                    id: string;
                    name: string;
                    gender?: string | null;
                    accent?: string | null;
                    style?: string | null;
                    last_used_at?: string | null;
                    use_count?: number;
                    is_active?: boolean;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    name?: string;
                    gender?: string | null;
                    accent?: string | null;
                    style?: string | null;
                    last_used_at?: string | null;
                    use_count?: number;
                    is_active?: boolean;
                    created_at?: string;
                };
                Relationships: [];
            };
            audio_assets: {
                Row: {
                    id: string;
                    content_piece_id: string;
                    voice_id: string;
                    elevenlabs_request_id: string | null;
                    audio_url: string | null;
                    duration_seconds: number | null;
                    status: string;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    content_piece_id: string;
                    voice_id: string;
                    elevenlabs_request_id?: string | null;
                    audio_url?: string | null;
                    duration_seconds?: number | null;
                    status?: string;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    content_piece_id?: string;
                    voice_id?: string;
                    elevenlabs_request_id?: string | null;
                    audio_url?: string | null;
                    duration_seconds?: number | null;
                    status?: string;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "audio_assets_content_piece_id_fkey";
                        columns: ["content_piece_id"];
                        isOneToOne: false;
                        referencedRelation: "content_pieces";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "audio_assets_voice_id_fkey";
                        columns: ["voice_id"];
                        isOneToOne: false;
                        referencedRelation: "voices";
                        referencedColumns: ["id"];
                    }
                ];
            };
            visual_assets: {
                Row: {
                    id: string;
                    content_piece_id: string;
                    asset_type: string;
                    source_service: string;
                    source_id: string | null;
                    asset_url: string | null;
                    metadata: Json;
                    status: string;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    content_piece_id: string;
                    asset_type: string;
                    source_service: string;
                    source_id?: string | null;
                    asset_url?: string | null;
                    metadata?: Json;
                    status?: string;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    content_piece_id?: string;
                    asset_type?: string;
                    source_service?: string;
                    source_id?: string | null;
                    asset_url?: string | null;
                    metadata?: Json;
                    status?: string;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "visual_assets_content_piece_id_fkey";
                        columns: ["content_piece_id"];
                        isOneToOne: false;
                        referencedRelation: "content_pieces";
                        referencedColumns: ["id"];
                    }
                ];
            };
            published_log: {
                Row: {
                    id: string;
                    persona_id: string;
                    topic_id: string | null;
                    topic_title: string;
                    topic_hash: string;
                    published_at: string;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    persona_id: string;
                    topic_id?: string | null;
                    topic_title: string;
                    topic_hash: string;
                    published_at: string;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    persona_id?: string;
                    topic_id?: string | null;
                    topic_title?: string;
                    topic_hash?: string;
                    published_at?: string;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "published_log_persona_id_fkey";
                        columns: ["persona_id"];
                        isOneToOne: false;
                        referencedRelation: "personas";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "published_log_topic_id_fkey";
                        columns: ["topic_id"];
                        isOneToOne: false;
                        referencedRelation: "topics";
                        referencedColumns: ["id"];
                    }
                ];
            };
            cost_tracking: {
                Row: {
                    id: string;
                    service: string;
                    operation: string;
                    topic_id: string | null;
                    content_piece_id: string | null;
                    cost_usd: number;
                    tokens_input: number | null;
                    tokens_output: number | null;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    service: string;
                    operation: string;
                    topic_id?: string | null;
                    content_piece_id?: string | null;
                    cost_usd: number;
                    tokens_input?: number | null;
                    tokens_output?: number | null;
                    created_at?: string;
                };
                Update: {
                    id?: string;
                    service?: string;
                    operation?: string;
                    topic_id?: string | null;
                    content_piece_id?: string | null;
                    cost_usd?: number;
                    tokens_input?: number | null;
                    tokens_output?: number | null;
                    created_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "cost_tracking_topic_id_fkey";
                        columns: ["topic_id"];
                        isOneToOne: false;
                        referencedRelation: "topics";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "cost_tracking_content_piece_id_fkey";
                        columns: ["content_piece_id"];
                        isOneToOne: false;
                        referencedRelation: "content_pieces";
                        referencedColumns: ["id"];
                    }
                ];
            };
        };
        Views: {
            cost_summary: {
                Row: {
                    date: string | null;
                    service: string | null;
                    operations: number | null;
                    total_cost: number | null;
                };
                Relationships: [];
            };
        };
        Functions: {
            get_lru_voice: {
                Args: { p_persona_id: string };
                Returns: string;
            };
            check_duplicate_topic: {
                Args: { p_persona_id: string; p_title: string; p_threshold?: number };
                Returns: { is_duplicate: boolean; similar_title: string; similarity: number }[];
            };
        };
        Enums: Record<string, never>;
        CompositeTypes: Record<string, never>;
    };
}

// Custom types
export interface PlatformAccounts {
    tiktok?: string;
    instagram?: string;
    youtube?: string;
    threads?: string;
    twitter?: string;
    bluesky?: string;
    linkedin?: string;
}

export interface HistoricalPoint {
    point: number;
    claim: string;
    source: string;
    year: string;
}

export interface CarouselSlide {
    slide: number;
    text: string;
    imagePrompt: string;
}

export interface PlatformStatus {
    status: 'pending' | 'published' | 'failed';
    post_id?: string;
    published_at?: string;
    error?: string;
}

export interface PublishedPlatforms {
    tiktok?: PlatformStatus;
    instagram?: PlatformStatus;
    youtube?: PlatformStatus;
    threads?: PlatformStatus;
    twitter?: PlatformStatus;
    bluesky?: PlatformStatus;
    linkedin?: PlatformStatus;
}

export type TopicStatus =
    | 'draft'
    | 'topics_approved'
    | 'content_generating'
    | 'content_ready'
    | 'approved'
    | 'scheduled'
    | 'publishing'
    | 'partially_published'
    | 'published'
    | 'failed';

export type PieceType = 'long' | 'short_1' | 'short_2' | 'short_3' | 'short_4' | 'carousel';

export type PieceStatus =
    | 'pending'
    | 'generating'
    | 'ready'
    | 'processing'
    | 'produced'
    | 'publishing'
    | 'published'
    | 'failed';

export type BlotatoStatus = 'pending' | 'processing' | 'done' | 'failed';

// Convenience types
export type Persona = Database['public']['Tables']['personas']['Row'];
export type Topic = Database['public']['Tables']['topics']['Row'];
export type ContentPiece = Database['public']['Tables']['content_pieces']['Row'];
export type Voice = Database['public']['Tables']['voices']['Row'];
export type AudioAsset = Database['public']['Tables']['audio_assets']['Row'];
export type VisualAsset = Database['public']['Tables']['visual_assets']['Row'];
export type PublishedLogEntry = Database['public']['Tables']['published_log']['Row'];
export type CostEntry = Database['public']['Tables']['cost_tracking']['Row'];

// Insert types
export type PersonaInsert = Database['public']['Tables']['personas']['Insert'];
export type TopicInsert = Database['public']['Tables']['topics']['Insert'];
export type ContentPieceInsert = Database['public']['Tables']['content_pieces']['Insert'];
export type VoiceInsert = Database['public']['Tables']['voices']['Insert'];

// Update types
export type PersonaUpdate = Database['public']['Tables']['personas']['Update'];
export type TopicUpdate = Database['public']['Tables']['topics']['Update'];
export type ContentPieceUpdate = Database['public']['Tables']['content_pieces']['Update'];

// Join types (Supabase select with nested relations)
export interface TopicWithPersona extends Topic {
    personas: Persona;
}
