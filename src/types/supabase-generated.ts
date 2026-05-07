export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      accessories: {
        Row: {
          compatible_aircraft: string[] | null
          created_at: string
          id: string
          name: string
          notes: string | null
          purchase_date: string | null
          serial_number: string | null
          status: string
          type: Database["public"]["Enums"]["accessory_type"]
          updated_at: string
        }
        Insert: {
          compatible_aircraft?: string[] | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          purchase_date?: string | null
          serial_number?: string | null
          status?: string
          type?: Database["public"]["Enums"]["accessory_type"]
          updated_at?: string
        }
        Update: {
          compatible_aircraft?: string[] | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          purchase_date?: string | null
          serial_number?: string | null
          status?: string
          type?: Database["public"]["Enums"]["accessory_type"]
          updated_at?: string
        }
        Relationships: []
      }
      activity_events: {
        Row: {
          actor_id: string | null
          created_at: string | null
          entity_id: string | null
          entity_type: string
          event_type: string
          id: string
          metadata: Json | null
          summary: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type: string
          event_type: string
          id?: string
          metadata?: Json | null
          summary: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          summary?: string
        }
        Relationships: []
      }
      aircraft: {
        Row: {
          created_at: string
          faa_registration: string | null
          firmware_version: string | null
          id: string
          insurance_expiry: string | null
          model: string
          nickname: string | null
          notes: string | null
          purchase_date: string | null
          serial_number: string
          status: string
          total_flight_hours: number
          total_flights: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          faa_registration?: string | null
          firmware_version?: string | null
          id?: string
          insurance_expiry?: string | null
          model: string
          nickname?: string | null
          notes?: string | null
          purchase_date?: string | null
          serial_number: string
          status?: string
          total_flight_hours?: number
          total_flights?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          faa_registration?: string | null
          firmware_version?: string | null
          id?: string
          insurance_expiry?: string | null
          model?: string
          nickname?: string | null
          notes?: string | null
          purchase_date?: string | null
          serial_number?: string
          status?: string
          total_flight_hours?: number
          total_flights?: number
          updated_at?: string
        }
        Relationships: []
      }
      aircraft_capabilities: {
        Row: {
          aircraft_id: string
          created_at: string
          id: string
          notes: string | null
          package_id: string
        }
        Insert: {
          aircraft_id: string
          created_at?: string
          id?: string
          notes?: string | null
          package_id: string
        }
        Update: {
          aircraft_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "aircraft_capabilities_aircraft_id_fkey"
            columns: ["aircraft_id"]
            isOneToOne: false
            referencedRelation: "aircraft"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aircraft_capabilities_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "drone_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aircraft_capabilities_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      airspace_grids: {
        Row: {
          airspace_class: string
          ceiling_ft: number
          created_at: string
          effective_date: string | null
          facility_id: string | null
          facility_name: string | null
          grid_id: string
          id: string
          laanc_eligible: boolean
          latitude: number | null
          longitude: number | null
          notes: string | null
          updated_at: string
          zero_grid: boolean
        }
        Insert: {
          airspace_class: string
          ceiling_ft?: number
          created_at?: string
          effective_date?: string | null
          facility_id?: string | null
          facility_name?: string | null
          grid_id: string
          id?: string
          laanc_eligible?: boolean
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          updated_at?: string
          zero_grid?: boolean
        }
        Update: {
          airspace_class?: string
          ceiling_ft?: number
          created_at?: string
          effective_date?: string | null
          facility_id?: string | null
          facility_name?: string | null
          grid_id?: string
          id?: string
          laanc_eligible?: boolean
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          updated_at?: string
          zero_grid?: boolean
        }
        Relationships: []
      }
      audio_assets: {
        Row: {
          audio_url: string | null
          content_piece_id: string
          created_at: string | null
          duration_seconds: number | null
          elevenlabs_request_id: string | null
          id: string
          status: string
          voice_id: string
        }
        Insert: {
          audio_url?: string | null
          content_piece_id: string
          created_at?: string | null
          duration_seconds?: number | null
          elevenlabs_request_id?: string | null
          id?: string
          status?: string
          voice_id: string
        }
        Update: {
          audio_url?: string | null
          content_piece_id?: string
          created_at?: string | null
          duration_seconds?: number | null
          elevenlabs_request_id?: string | null
          id?: string
          status?: string
          voice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audio_assets_content_piece_id_fkey"
            columns: ["content_piece_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_assets_voice_id_fkey"
            columns: ["voice_id"]
            isOneToOne: false
            referencedRelation: "voices"
            referencedColumns: ["id"]
          },
        ]
      }
      authorization_requests: {
        Row: {
          approved_altitude_ft: number | null
          approved_at: string | null
          authorization_type: Database["public"]["Enums"]["authorization_type"]
          created_at: string
          denial_reason: string | null
          expires_at: string | null
          id: string
          mission_id: string
          notes: string | null
          reference_number: string | null
          requested_altitude_ft: number | null
          status: Database["public"]["Enums"]["authorization_status"]
          submitted_at: string | null
          submitted_via: string | null
          updated_at: string
        }
        Insert: {
          approved_altitude_ft?: number | null
          approved_at?: string | null
          authorization_type: Database["public"]["Enums"]["authorization_type"]
          created_at?: string
          denial_reason?: string | null
          expires_at?: string | null
          id?: string
          mission_id: string
          notes?: string | null
          reference_number?: string | null
          requested_altitude_ft?: number | null
          status?: Database["public"]["Enums"]["authorization_status"]
          submitted_at?: string | null
          submitted_via?: string | null
          updated_at?: string
        }
        Update: {
          approved_altitude_ft?: number | null
          approved_at?: string | null
          authorization_type?: Database["public"]["Enums"]["authorization_type"]
          created_at?: string
          denial_reason?: string | null
          expires_at?: string | null
          id?: string
          mission_id?: string
          notes?: string | null
          reference_number?: string | null
          requested_altitude_ft?: number | null
          status?: Database["public"]["Enums"]["authorization_status"]
          submitted_at?: string | null
          submitted_via?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "authorization_requests_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "drone_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "authorization_requests_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_overrides: {
        Row: {
          created_at: string
          id: string
          is_available: boolean
          note: string | null
          override_date: string
          service_type: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_available: boolean
          note?: string | null
          override_date: string
          service_type?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_available?: boolean
          note?: string | null
          override_date?: string
          service_type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      availability_slots: {
        Row: {
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_active: boolean
          service_type: string | null
          start_time: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          end_time?: string
          id?: string
          is_active?: boolean
          service_type?: string | null
          start_time?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          is_active?: boolean
          service_type?: string | null
          start_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      batteries: {
        Row: {
          aircraft_id: string | null
          capacity_mah: number
          created_at: string
          cycle_count: number
          health_percentage: number
          id: string
          model: string | null
          notes: string | null
          purchase_date: string | null
          serial_number: string
          status: string
          updated_at: string
        }
        Insert: {
          aircraft_id?: string | null
          capacity_mah: number
          created_at?: string
          cycle_count?: number
          health_percentage?: number
          id?: string
          model?: string | null
          notes?: string | null
          purchase_date?: string | null
          serial_number: string
          status?: string
          updated_at?: string
        }
        Update: {
          aircraft_id?: string | null
          capacity_mah?: number
          created_at?: string
          cycle_count?: number
          health_percentage?: number
          id?: string
          model?: string | null
          notes?: string | null
          purchase_date?: string | null
          serial_number?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "batteries_aircraft_id_fkey"
            columns: ["aircraft_id"]
            isOneToOne: false
            referencedRelation: "aircraft"
            referencedColumns: ["id"]
          },
        ]
      }
      blackout_dates: {
        Row: {
          blackout_date: string
          created_at: string
          created_by: string | null
          id: string
          reason: string
        }
        Insert: {
          blackout_date: string
          created_at?: string
          created_by?: string | null
          id?: string
          reason: string
        }
        Update: {
          blackout_date?: string
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string
        }
        Relationships: []
      }
      brands: {
        Row: {
          base_url: string
          color_accent: string
          color_cta: string
          color_light: string
          color_primary: string
          company_name: string
          created_at: string
          dba: string | null
          from_email: string
          is_active: boolean
          legal_name: string
          phone: string | null
          reply_to: string
          slug: string
          tagline: string
          website: string | null
        }
        Insert: {
          base_url: string
          color_accent: string
          color_cta: string
          color_light: string
          color_primary: string
          company_name: string
          created_at?: string
          dba?: string | null
          from_email: string
          is_active?: boolean
          legal_name: string
          phone?: string | null
          reply_to: string
          slug: string
          tagline: string
          website?: string | null
        }
        Update: {
          base_url?: string
          color_accent?: string
          color_cta?: string
          color_light?: string
          color_primary?: string
          company_name?: string
          created_at?: string
          dba?: string | null
          from_email?: string
          is_active?: boolean
          legal_name?: string
          phone?: string | null
          reply_to?: string
          slug?: string
          tagline?: string
          website?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          address: string | null
          city: string | null
          company: string | null
          created_at: string | null
          created_by: string | null
          email: string | null
          id: string
          is_active: boolean | null
          name: string
          notes: string | null
          phone: string | null
          state: string | null
          updated_at: string | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          company?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          notes?: string | null
          phone?: string | null
          state?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          company?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          notes?: string | null
          phone?: string | null
          state?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      content_pieces: {
        Row: {
          blotato_job_id: string | null
          blotato_status: string | null
          canva_design_id: string | null
          caption_long: string | null
          caption_short: string | null
          carousel_slides: Json | null
          carousel_url: string | null
          created_at: string | null
          error_message: string | null
          heygen_job_id: string | null
          heygen_status: string | null
          id: string
          music_track: string | null
          piece_order: number
          piece_type: string
          produced_at: string | null
          published_at: string | null
          published_platforms: Json | null
          retry_count: number | null
          script: string | null
          status: string
          thumbnail_prompt: string | null
          thumbnail_url: string | null
          topic_id: string
          video_url: string | null
        }
        Insert: {
          blotato_job_id?: string | null
          blotato_status?: string | null
          canva_design_id?: string | null
          caption_long?: string | null
          caption_short?: string | null
          carousel_slides?: Json | null
          carousel_url?: string | null
          created_at?: string | null
          error_message?: string | null
          heygen_job_id?: string | null
          heygen_status?: string | null
          id?: string
          music_track?: string | null
          piece_order: number
          piece_type: string
          produced_at?: string | null
          published_at?: string | null
          published_platforms?: Json | null
          retry_count?: number | null
          script?: string | null
          status?: string
          thumbnail_prompt?: string | null
          thumbnail_url?: string | null
          topic_id: string
          video_url?: string | null
        }
        Update: {
          blotato_job_id?: string | null
          blotato_status?: string | null
          canva_design_id?: string | null
          caption_long?: string | null
          caption_short?: string | null
          carousel_slides?: Json | null
          carousel_url?: string | null
          created_at?: string | null
          error_message?: string | null
          heygen_job_id?: string | null
          heygen_status?: string | null
          id?: string
          music_track?: string | null
          piece_order?: number
          piece_type?: string
          produced_at?: string | null
          published_at?: string | null
          published_platforms?: Json | null
          retry_count?: number | null
          script?: string | null
          status?: string
          thumbnail_prompt?: string | null
          thumbnail_url?: string | null
          topic_id?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_pieces_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      controllers: {
        Row: {
          created_at: string
          firmware_version: string | null
          id: string
          model: string
          notes: string | null
          paired_aircraft_id: string | null
          serial_number: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          firmware_version?: string | null
          id?: string
          model: string
          notes?: string | null
          paired_aircraft_id?: string | null
          serial_number: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          firmware_version?: string | null
          id?: string
          model?: string
          notes?: string | null
          paired_aircraft_id?: string | null
          serial_number?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "controllers_paired_aircraft_id_fkey"
            columns: ["paired_aircraft_id"]
            isOneToOne: false
            referencedRelation: "aircraft"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          customer_email: string
          customer_name: string
          id: string
          last_message_at: string | null
          status: string
          subject: string
          ticket_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_email: string
          customer_name: string
          id?: string
          last_message_at?: string | null
          status?: string
          subject: string
          ticket_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_email?: string
          customer_name?: string
          id?: string
          last_message_at?: string | null
          status?: string
          subject?: string
          ticket_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cost_tracking: {
        Row: {
          content_piece_id: string | null
          cost_usd: number
          created_at: string | null
          id: string
          operation: string
          service: string
          tokens_input: number | null
          tokens_output: number | null
          topic_id: string | null
        }
        Insert: {
          content_piece_id?: string | null
          cost_usd: number
          created_at?: string | null
          id?: string
          operation: string
          service: string
          tokens_input?: number | null
          tokens_output?: number | null
          topic_id?: string | null
        }
        Update: {
          content_piece_id?: string | null
          cost_usd?: number
          created_at?: string | null
          id?: string
          operation?: string
          service?: string
          tokens_input?: number | null
          tokens_output?: number | null
          topic_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_tracking_content_piece_id_fkey"
            columns: ["content_piece_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_tracking_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      costing_settings: {
        Row: {
          admin_cost_pct: number
          default_margin_pct: number
          depreciation_pct: number
          id: string
          overhead_pct: number
          tax_rate_pct: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          admin_cost_pct?: number
          default_margin_pct?: number
          depreciation_pct?: number
          id?: string
          overhead_pct?: number
          tax_rate_pct?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          admin_cost_pct?: number
          default_margin_pct?: number
          depreciation_pct?: number
          id?: string
          overhead_pct?: number
          tax_rate_pct?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          city: string | null
          client_type: string | null
          company_name: string | null
          created_at: string | null
          email: string
          historical_qa_overrides: number | null
          id: string
          is_retainer: boolean
          name: string
          notes: string | null
          phone: string | null
          qa_specific_requirements: string[] | null
          qa_threshold_adjustment: number | null
          retainer_credits_remaining: number
          square_customer_id: string | null
          state: string | null
          updated_at: string | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          client_type?: string | null
          company_name?: string | null
          created_at?: string | null
          email: string
          historical_qa_overrides?: number | null
          id?: string
          is_retainer?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          qa_specific_requirements?: string[] | null
          qa_threshold_adjustment?: number | null
          retainer_credits_remaining?: number
          square_customer_id?: string | null
          state?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          client_type?: string | null
          company_name?: string | null
          created_at?: string | null
          email?: string
          historical_qa_overrides?: number | null
          id?: string
          is_retainer?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          qa_specific_requirements?: string[] | null
          qa_threshold_adjustment?: number | null
          retainer_credits_remaining?: number
          square_customer_id?: string | null
          state?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      delivery_log: {
        Row: {
          delivered_at: string | null
          file_count: number | null
          id: string
          mission_id: string
          notification_sent: boolean | null
          output_path: string
          recipient_email: string | null
          total_size_bytes: number | null
        }
        Insert: {
          delivered_at?: string | null
          file_count?: number | null
          id?: string
          mission_id: string
          notification_sent?: boolean | null
          output_path: string
          recipient_email?: string | null
          total_size_bytes?: number | null
        }
        Update: {
          delivered_at?: string | null
          file_count?: number | null
          id?: string
          mission_id?: string
          notification_sent?: boolean | null
          output_path?: string
          recipient_email?: string | null
          total_size_bytes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_log_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "drone_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_log_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      document_templates: {
        Row: {
          active: boolean
          category: string
          code: string
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          name: string
          output_format: string
          schema: Json
          template_config: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          output_format?: string
          schema?: Json
          template_config?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          output_format?: string
          schema?: Json
          template_config?: Json
          updated_at?: string
        }
        Relationships: []
      }
      drone_assets: {
        Row: {
          camera_model: string | null
          capture_date: string | null
          compass_bearing: number | null
          compass_direction: string | null
          coverage_tag: string | null
          created_at: string
          exif_data: Json | null
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          gps_altitude: number | null
          gps_latitude: number | null
          gps_longitude: number | null
          id: string
          job_id: string
          lr_exported_path: string | null
          media_format: string | null
          mime_type: string | null
          pipeline_excluded: boolean | null
          processed_path: string | null
          processing_status: string | null
          qa_analyzed_at: string | null
          qa_override: boolean | null
          qa_override_by: string | null
          qa_override_reason: string | null
          qa_results: Json | null
          qa_score: number | null
          qa_status: Database["public"]["Enums"]["qa_status"] | null
          sort_order: number | null
          thumbnail_url: string | null
          updated_at: string
          video_bitrate: number | null
          video_codec: string | null
          video_duration_seconds: number | null
          video_fps: number | null
          video_resolution: string | null
        }
        Insert: {
          camera_model?: string | null
          capture_date?: string | null
          compass_bearing?: number | null
          compass_direction?: string | null
          coverage_tag?: string | null
          created_at?: string
          exif_data?: Json | null
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          gps_altitude?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          job_id: string
          lr_exported_path?: string | null
          media_format?: string | null
          mime_type?: string | null
          pipeline_excluded?: boolean | null
          processed_path?: string | null
          processing_status?: string | null
          qa_analyzed_at?: string | null
          qa_override?: boolean | null
          qa_override_by?: string | null
          qa_override_reason?: string | null
          qa_results?: Json | null
          qa_score?: number | null
          qa_status?: Database["public"]["Enums"]["qa_status"] | null
          sort_order?: number | null
          thumbnail_url?: string | null
          updated_at?: string
          video_bitrate?: number | null
          video_codec?: string | null
          video_duration_seconds?: number | null
          video_fps?: number | null
          video_resolution?: string | null
        }
        Update: {
          camera_model?: string | null
          capture_date?: string | null
          compass_bearing?: number | null
          compass_direction?: string | null
          coverage_tag?: string | null
          created_at?: string
          exif_data?: Json | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          gps_altitude?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          job_id?: string
          lr_exported_path?: string | null
          media_format?: string | null
          mime_type?: string | null
          pipeline_excluded?: boolean | null
          processed_path?: string | null
          processing_status?: string | null
          qa_analyzed_at?: string | null
          qa_override?: boolean | null
          qa_override_by?: string | null
          qa_override_reason?: string | null
          qa_results?: Json | null
          qa_score?: number | null
          qa_status?: Database["public"]["Enums"]["qa_status"] | null
          sort_order?: number | null
          thumbnail_url?: string | null
          updated_at?: string
          video_bitrate?: number | null
          video_codec?: string | null
          video_duration_seconds?: number | null
          video_fps?: number | null
          video_resolution?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drone_assets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "drone_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drone_assets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      drone_deliverables: {
        Row: {
          created_at: string
          description: string | null
          download_count: number | null
          download_expires_at: string | null
          download_url: string | null
          file_count: number | null
          file_paths: string[] | null
          id: string
          job_id: string
          last_downloaded_at: string | null
          name: string
          total_size_bytes: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          download_count?: number | null
          download_expires_at?: string | null
          download_url?: string | null
          file_count?: number | null
          file_paths?: string[] | null
          id?: string
          job_id: string
          last_downloaded_at?: string | null
          name: string
          total_size_bytes?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          download_count?: number | null
          download_expires_at?: string | null
          download_url?: string | null
          file_count?: number | null
          file_paths?: string[] | null
          id?: string
          job_id?: string
          last_downloaded_at?: string | null
          name?: string
          total_size_bytes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "drone_deliverables_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "drone_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drone_deliverables_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      drone_engagements: {
        Row: {
          actual_revenue: number | null
          cost: number | null
          created_at: string
          delivery_date: string | null
          engagement_date: string
          engagement_type: Database["public"]["Enums"]["engagement_type"]
          id: string
          internal_notes: string | null
          lead_id: string
          notes: string | null
          photo_count: number | null
          property_address: string | null
          quoted_price: number | null
          satisfaction_score: number | null
          status: Database["public"]["Enums"]["engagement_status"]
          updated_at: string
          video_count: number | null
        }
        Insert: {
          actual_revenue?: number | null
          cost?: number | null
          created_at?: string
          delivery_date?: string | null
          engagement_date: string
          engagement_type: Database["public"]["Enums"]["engagement_type"]
          id?: string
          internal_notes?: string | null
          lead_id: string
          notes?: string | null
          photo_count?: number | null
          property_address?: string | null
          quoted_price?: number | null
          satisfaction_score?: number | null
          status?: Database["public"]["Enums"]["engagement_status"]
          updated_at?: string
          video_count?: number | null
        }
        Update: {
          actual_revenue?: number | null
          cost?: number | null
          created_at?: string
          delivery_date?: string | null
          engagement_date?: string
          engagement_type?: Database["public"]["Enums"]["engagement_type"]
          id?: string
          internal_notes?: string | null
          lead_id?: string
          notes?: string | null
          photo_count?: number | null
          property_address?: string | null
          quoted_price?: number | null
          satisfaction_score?: number | null
          status?: Database["public"]["Enums"]["engagement_status"]
          updated_at?: string
          video_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "drone_engagements_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "drone_client_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drone_engagements_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "drone_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      drone_jobs: {
        Row: {
          admin_notes: string | null
          aircraft_id: string | null
          client_id: string | null
          completed_at: string | null
          construction_context: Json | null
          created_at: string
          customer_id: string | null
          delivered_at: string | null
          delivery_drive_url: string | null
          delivery_email_to: string | null
          delivery_notes: string | null
          delivery_sent_at: string | null
          delivery_status: string | null
          delivery_token: string | null
          delivery_token_created_at: string | null
          download_url: string | null
          droneinvoice_ref: string | null
          has_ppk_data: boolean | null
          id: string
          ingested_at: string | null
          is_rush: boolean
          is_test: boolean
          job_number: string
          job_price: number | null
          latitude: number | null
          longitude: number | null
          mission_number: number | null
          model_file_path: string | null
          nearest_weather_station: string | null
          nodeodm_task_id: string | null
          orthophoto_path: string | null
          output_path: string | null
          package_id: string | null
          photo_count: number | null
          photogrammetry_status:
            | Database["public"]["Enums"]["photogrammetry_status"]
            | null
          pilot_id: string | null
          pilot_notes: string | null
          pointcloud_path: string | null
          preview_urls: string[] | null
          processing_completed_at: string | null
          processing_error: string | null
          processing_job_id: string | null
          processing_options: Json | null
          processing_started_at: string | null
          processing_template_id: string | null
          property_address: string
          property_city: string | null
          property_state: string | null
          property_type: string
          property_zip: string | null
          qa_batch_context: Json | null
          qa_score: number | null
          qa_summary: Json | null
          quote_id: string | null
          scheduled_date: string | null
          scheduled_time: string | null
          service_request_id: string | null
          site_address: string | null
          source_platform: string | null
          status: Database["public"]["Enums"]["drone_job_status"]
          updated_at: string
          upload_token: string | null
          upload_token_expires_at: string | null
          vegetation_analysis: boolean | null
          vegetation_status: string | null
          video_addon: boolean | null
          video_count: number | null
          weather_hold: boolean
          weather_hold_reasons: string[] | null
        }
        Insert: {
          admin_notes?: string | null
          aircraft_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          construction_context?: Json | null
          created_at?: string
          customer_id?: string | null
          delivered_at?: string | null
          delivery_drive_url?: string | null
          delivery_email_to?: string | null
          delivery_notes?: string | null
          delivery_sent_at?: string | null
          delivery_status?: string | null
          delivery_token?: string | null
          delivery_token_created_at?: string | null
          download_url?: string | null
          droneinvoice_ref?: string | null
          has_ppk_data?: boolean | null
          id?: string
          ingested_at?: string | null
          is_rush?: boolean
          is_test?: boolean
          job_number: string
          job_price?: number | null
          latitude?: number | null
          longitude?: number | null
          mission_number?: number | null
          model_file_path?: string | null
          nearest_weather_station?: string | null
          nodeodm_task_id?: string | null
          orthophoto_path?: string | null
          output_path?: string | null
          package_id?: string | null
          photo_count?: number | null
          photogrammetry_status?:
            | Database["public"]["Enums"]["photogrammetry_status"]
            | null
          pilot_id?: string | null
          pilot_notes?: string | null
          pointcloud_path?: string | null
          preview_urls?: string[] | null
          processing_completed_at?: string | null
          processing_error?: string | null
          processing_job_id?: string | null
          processing_options?: Json | null
          processing_started_at?: string | null
          processing_template_id?: string | null
          property_address: string
          property_city?: string | null
          property_state?: string | null
          property_type?: string
          property_zip?: string | null
          qa_batch_context?: Json | null
          qa_score?: number | null
          qa_summary?: Json | null
          quote_id?: string | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          service_request_id?: string | null
          site_address?: string | null
          source_platform?: string | null
          status?: Database["public"]["Enums"]["drone_job_status"]
          updated_at?: string
          upload_token?: string | null
          upload_token_expires_at?: string | null
          vegetation_analysis?: boolean | null
          vegetation_status?: string | null
          video_addon?: boolean | null
          video_count?: number | null
          weather_hold?: boolean
          weather_hold_reasons?: string[] | null
        }
        Update: {
          admin_notes?: string | null
          aircraft_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          construction_context?: Json | null
          created_at?: string
          customer_id?: string | null
          delivered_at?: string | null
          delivery_drive_url?: string | null
          delivery_email_to?: string | null
          delivery_notes?: string | null
          delivery_sent_at?: string | null
          delivery_status?: string | null
          delivery_token?: string | null
          delivery_token_created_at?: string | null
          download_url?: string | null
          droneinvoice_ref?: string | null
          has_ppk_data?: boolean | null
          id?: string
          ingested_at?: string | null
          is_rush?: boolean
          is_test?: boolean
          job_number?: string
          job_price?: number | null
          latitude?: number | null
          longitude?: number | null
          mission_number?: number | null
          model_file_path?: string | null
          nearest_weather_station?: string | null
          nodeodm_task_id?: string | null
          orthophoto_path?: string | null
          output_path?: string | null
          package_id?: string | null
          photo_count?: number | null
          photogrammetry_status?:
            | Database["public"]["Enums"]["photogrammetry_status"]
            | null
          pilot_id?: string | null
          pilot_notes?: string | null
          pointcloud_path?: string | null
          preview_urls?: string[] | null
          processing_completed_at?: string | null
          processing_error?: string | null
          processing_job_id?: string | null
          processing_options?: Json | null
          processing_started_at?: string | null
          processing_template_id?: string | null
          property_address?: string
          property_city?: string | null
          property_state?: string | null
          property_type?: string
          property_zip?: string | null
          qa_batch_context?: Json | null
          qa_score?: number | null
          qa_summary?: Json | null
          quote_id?: string | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          service_request_id?: string | null
          site_address?: string | null
          source_platform?: string | null
          status?: Database["public"]["Enums"]["drone_job_status"]
          updated_at?: string
          upload_token?: string | null
          upload_token_expires_at?: string | null
          vegetation_analysis?: boolean | null
          vegetation_status?: string | null
          video_addon?: boolean | null
          video_count?: number | null
          weather_hold?: boolean
          weather_hold_reasons?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "drone_jobs_aircraft_id_fkey"
            columns: ["aircraft_id"]
            isOneToOne: false
            referencedRelation: "aircraft"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drone_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drone_jobs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drone_jobs_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "drone_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drone_jobs_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drone_jobs_pilot_id_fkey"
            columns: ["pilot_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drone_jobs_processing_job_id_fkey"
            columns: ["processing_job_id"]
            isOneToOne: false
            referencedRelation: "processing_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drone_jobs_processing_template_id_fkey"
            columns: ["processing_template_id"]
            isOneToOne: false
            referencedRelation: "processing_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drone_jobs_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drone_jobs_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      drone_leads: {
        Row: {
          address: string | null
          ai_email_body: string | null
          ai_email_subject: string | null
          city: string | null
          company_name: string
          created_at: string
          email: string | null
          email_status: string | null
          estimated_portfolio_size: number | null
          google_rating: number | null
          hunter_io_score: number | null
          id: string
          internal_notes: string | null
          notes: string | null
          phone: string | null
          portfolio_type: string | null
          priority: string | null
          review_count: number | null
          serper_place_id: string | null
          state: string | null
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          ai_email_body?: string | null
          ai_email_subject?: string | null
          city?: string | null
          company_name: string
          created_at?: string
          email?: string | null
          email_status?: string | null
          estimated_portfolio_size?: number | null
          google_rating?: number | null
          hunter_io_score?: number | null
          id?: string
          internal_notes?: string | null
          notes?: string | null
          phone?: string | null
          portfolio_type?: string | null
          priority?: string | null
          review_count?: number | null
          serper_place_id?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          ai_email_body?: string | null
          ai_email_subject?: string | null
          city?: string | null
          company_name?: string
          created_at?: string
          email?: string | null
          email_status?: string | null
          estimated_portfolio_size?: number | null
          google_rating?: number | null
          hunter_io_score?: number | null
          id?: string
          internal_notes?: string | null
          notes?: string | null
          phone?: string | null
          portfolio_type?: string | null
          priority?: string | null
          review_count?: number | null
          serper_place_id?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      drone_packages: {
        Row: {
          active: boolean
          category: string
          code: string
          created_at: string
          description: string | null
          edit_budget_minutes: number
          features: string[] | null
          id: string
          max_altitude_ft: number | null
          min_altitude_ft: number | null
          name: string
          price: number
          processing_profile: Json | null
          requirements: Json | null
          requires_raw: boolean | null
          requires_thermal: boolean | null
          reshoot_tolerance: string
          shot_manifest: Json | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          category: string
          code: string
          created_at?: string
          description?: string | null
          edit_budget_minutes?: number
          features?: string[] | null
          id?: string
          max_altitude_ft?: number | null
          min_altitude_ft?: number | null
          name: string
          price: number
          processing_profile?: Json | null
          requirements?: Json | null
          requires_raw?: boolean | null
          requires_thermal?: boolean | null
          reshoot_tolerance?: string
          shot_manifest?: Json | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          code?: string
          created_at?: string
          description?: string | null
          edit_budget_minutes?: number
          features?: string[] | null
          id?: string
          max_altitude_ft?: number | null
          min_altitude_ft?: number | null
          name?: string
          price?: number
          processing_profile?: Json | null
          requirements?: Json | null
          requires_raw?: boolean | null
          requires_thermal?: boolean | null
          reshoot_tolerance?: string
          shot_manifest?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      email_tracking: {
        Row: {
          body: string
          click_count: number | null
          clicked_at: string | null
          created_at: string
          error_message: string | null
          id: string
          lead_id: string
          open_count: number | null
          opened_at: string | null
          recipient_email: string
          sent_at: string
          status: string
          subject: string
          tracking_id: string
        }
        Insert: {
          body: string
          click_count?: number | null
          clicked_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          lead_id: string
          open_count?: number | null
          opened_at?: string | null
          recipient_email: string
          sent_at?: string
          status?: string
          subject: string
          tracking_id?: string
        }
        Update: {
          body?: string
          click_count?: number | null
          clicked_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          lead_id?: string
          open_count?: number | null
          opened_at?: string | null
          recipient_email?: string
          sent_at?: string
          status?: string
          subject?: string
          tracking_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_tracking_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "drone_client_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_tracking_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "drone_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      flight_logs: {
        Row: {
          checklist_data: Json
          created_at: string
          device_id: string | null
          flight_timestamp: string
          id: string
          mission_id: string
          pilot_id: string
        }
        Insert: {
          checklist_data: Json
          created_at?: string
          device_id?: string | null
          flight_timestamp?: string
          id?: string
          mission_id: string
          pilot_id: string
        }
        Update: {
          checklist_data?: Json
          created_at?: string
          device_id?: string | null
          flight_timestamp?: string
          id?: string
          mission_id?: string
          pilot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flight_logs_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "drone_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_logs_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_logs_pilot_id_fkey"
            columns: ["pilot_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_documents: {
        Row: {
          created_at: string
          download_count: number | null
          downloaded_at: string | null
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          input_data: Json | null
          metadata: Json | null
          output_format: string
          template_code: string
          template_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          download_count?: number | null
          downloaded_at?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          input_data?: Json | null
          metadata?: Json | null
          output_format: string
          template_code: string
          template_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          download_count?: number | null
          downloaded_at?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          input_data?: Json | null
          metadata?: Json | null
          output_format?: string
          template_code?: string
          template_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_documents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      job_reports: {
        Row: {
          active_sections: string[] | null
          classification: string | null
          client_id: string | null
          created_at: string | null
          generated_document_id: string | null
          id: string
          job_id: string | null
          prepared_by: string | null
          report_date: string | null
          section_data: Json
          status: Database["public"]["Enums"]["report_status"]
          template_id: string
          title: string
          updated_at: string | null
        }
        Insert: {
          active_sections?: string[] | null
          classification?: string | null
          client_id?: string | null
          created_at?: string | null
          generated_document_id?: string | null
          id?: string
          job_id?: string | null
          prepared_by?: string | null
          report_date?: string | null
          section_data?: Json
          status?: Database["public"]["Enums"]["report_status"]
          template_id: string
          title: string
          updated_at?: string | null
        }
        Update: {
          active_sections?: string[] | null
          classification?: string | null
          client_id?: string | null
          created_at?: string | null
          generated_document_id?: string | null
          id?: string
          job_id?: string | null
          prepared_by?: string | null
          report_date?: string | null
          section_data?: Json
          status?: Database["public"]["Enums"]["report_status"]
          template_id?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_reports_generated_document_id_fkey"
            columns: ["generated_document_id"]
            isOneToOne: false
            referencedRelation: "generated_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "drone_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_reports_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_gen_jobs: {
        Row: {
          ai_drafts_generated: number | null
          completed_at: string | null
          created_at: string
          duplicates_filtered: number | null
          emails_found: number | null
          error_details: Json | null
          error_message: string | null
          hunter_io_cost: number | null
          id: string
          job_type: string
          leads_created: number | null
          openai_cost: number | null
          raw_results_found: number | null
          search_config: Json | null
          searches_performed: number | null
          serper_cost: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["lead_gen_job_status"]
        }
        Insert: {
          ai_drafts_generated?: number | null
          completed_at?: string | null
          created_at?: string
          duplicates_filtered?: number | null
          emails_found?: number | null
          error_details?: Json | null
          error_message?: string | null
          hunter_io_cost?: number | null
          id?: string
          job_type?: string
          leads_created?: number | null
          openai_cost?: number | null
          raw_results_found?: number | null
          search_config?: Json | null
          searches_performed?: number | null
          serper_cost?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["lead_gen_job_status"]
        }
        Update: {
          ai_drafts_generated?: number | null
          completed_at?: string | null
          created_at?: string
          duplicates_filtered?: number | null
          emails_found?: number | null
          error_details?: Json | null
          error_message?: string | null
          hunter_io_cost?: number | null
          id?: string
          job_type?: string
          leads_created?: number | null
          openai_cost?: number | null
          raw_results_found?: number | null
          search_config?: Json | null
          searches_performed?: number | null
          serper_cost?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["lead_gen_job_status"]
        }
        Relationships: []
      }
      lead_notes: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          follow_up_at: string | null
          id: string
          lead_id: string
          reason_tag: string | null
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          follow_up_at?: string | null
          id?: string
          lead_id: string
          reason_tag?: string | null
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          follow_up_at?: string | null
          id?: string
          lead_id?: string
          reason_tag?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          call_id: string | null
          caller_email: string | null
          caller_name: string
          caller_phone: string
          client_id: string | null
          created_at: string
          id: string
          qualification_status: string
          quote_request_id: string | null
          source_channel: Database["public"]["Enums"]["lead_source_channel"]
          updated_at: string
        }
        Insert: {
          call_id?: string | null
          caller_email?: string | null
          caller_name: string
          caller_phone: string
          client_id?: string | null
          created_at?: string
          id?: string
          qualification_status?: string
          quote_request_id?: string | null
          source_channel?: Database["public"]["Enums"]["lead_source_channel"]
          updated_at?: string
        }
        Update: {
          call_id?: string | null
          caller_email?: string | null
          caller_name?: string
          caller_phone?: string
          client_id?: string | null
          created_at?: string
          id?: string
          qualification_status?: string
          quote_request_id?: string | null
          source_channel?: Database["public"]["Enums"]["lead_source_channel"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_log: {
        Row: {
          cost_cents: number | null
          created_at: string
          description: string | null
          equipment_id: string
          equipment_type: Database["public"]["Enums"]["equipment_type"]
          id: string
          maintenance_type: Database["public"]["Enums"]["maintenance_type"]
          next_due_date: string | null
          notes: string | null
          parts_used: string[] | null
          performed_at: string
          performed_by: string | null
        }
        Insert: {
          cost_cents?: number | null
          created_at?: string
          description?: string | null
          equipment_id: string
          equipment_type: Database["public"]["Enums"]["equipment_type"]
          id?: string
          maintenance_type: Database["public"]["Enums"]["maintenance_type"]
          next_due_date?: string | null
          notes?: string | null
          parts_used?: string[] | null
          performed_at?: string
          performed_by?: string | null
        }
        Update: {
          cost_cents?: number | null
          created_at?: string
          description?: string | null
          equipment_id?: string
          equipment_type?: Database["public"]["Enums"]["equipment_type"]
          id?: string
          maintenance_type?: Database["public"]["Enums"]["maintenance_type"]
          next_due_date?: string | null
          notes?: string | null
          parts_used?: string[] | null
          performed_at?: string
          performed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_log_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachments: Json | null
          content: string
          conversation_id: string
          created_at: string
          email_sent_at: string | null
          id: string
          read_at: string | null
          sender_id: string | null
          sender_name: string
          sender_type: string
        }
        Insert: {
          attachments?: Json | null
          content: string
          conversation_id: string
          created_at?: string
          email_sent_at?: string | null
          id?: string
          read_at?: string | null
          sender_id?: string | null
          sender_name: string
          sender_type: string
        }
        Update: {
          attachments?: Json | null
          content?: string
          conversation_id?: string
          created_at?: string
          email_sent_at?: string | null
          id?: string
          read_at?: string | null
          sender_id?: string | null
          sender_name?: string
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      mission_authorizations: {
        Row: {
          active_tfrs: Json | null
          airspace_class: string | null
          created_at: string
          determination_notes: string | null
          id: string
          is_zero_grid: boolean
          max_approved_altitude_ft: number | null
          mission_id: string
          requirements_checklist: Json | null
          requires_laanc: boolean
          updated_at: string
        }
        Insert: {
          active_tfrs?: Json | null
          airspace_class?: string | null
          created_at?: string
          determination_notes?: string | null
          id?: string
          is_zero_grid?: boolean
          max_approved_altitude_ft?: number | null
          mission_id: string
          requirements_checklist?: Json | null
          requires_laanc?: boolean
          updated_at?: string
        }
        Update: {
          active_tfrs?: Json | null
          airspace_class?: string | null
          created_at?: string
          determination_notes?: string | null
          id?: string
          is_zero_grid?: boolean
          max_approved_altitude_ft?: number | null
          mission_id?: string
          requirements_checklist?: Json | null
          requires_laanc?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mission_authorizations_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: true
            referencedRelation: "drone_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_authorizations_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mission_costings: {
        Row: {
          admin_cost_amount: number
          admin_cost_pct: number
          compared_package: string | null
          converted_to_quote_id: string | null
          created_at: string
          created_by: string | null
          depreciation_amount: number
          depreciation_pct: number
          editing_fee: number
          equipment_rental: number
          expenses_subtotal: number
          id: string
          insurance_premium: number
          margin_pct: number
          meals: number
          mission_name: string | null
          notes: string | null
          overhead_amount: number
          overhead_pct: number
          package_price: number | null
          pilot_hours: number
          pilot_rate: number
          profit_amount: number
          service_type: string | null
          status: string
          surcharge_warning: boolean
          tax_estimate: number
          total_charge: number
          total_expenses: number
          travel_gas: number
          travel_hotel: number
          travel_rental: number
          updated_at: string
          vo_hours: number
          vo_rate: number
        }
        Insert: {
          admin_cost_amount?: number
          admin_cost_pct?: number
          compared_package?: string | null
          converted_to_quote_id?: string | null
          created_at?: string
          created_by?: string | null
          depreciation_amount?: number
          depreciation_pct?: number
          editing_fee?: number
          equipment_rental?: number
          expenses_subtotal?: number
          id?: string
          insurance_premium?: number
          margin_pct?: number
          meals?: number
          mission_name?: string | null
          notes?: string | null
          overhead_amount?: number
          overhead_pct?: number
          package_price?: number | null
          pilot_hours?: number
          pilot_rate?: number
          profit_amount?: number
          service_type?: string | null
          status?: string
          surcharge_warning?: boolean
          tax_estimate?: number
          total_charge?: number
          total_expenses?: number
          travel_gas?: number
          travel_hotel?: number
          travel_rental?: number
          updated_at?: string
          vo_hours?: number
          vo_rate?: number
        }
        Update: {
          admin_cost_amount?: number
          admin_cost_pct?: number
          compared_package?: string | null
          converted_to_quote_id?: string | null
          created_at?: string
          created_by?: string | null
          depreciation_amount?: number
          depreciation_pct?: number
          editing_fee?: number
          equipment_rental?: number
          expenses_subtotal?: number
          id?: string
          insurance_premium?: number
          margin_pct?: number
          meals?: number
          mission_name?: string | null
          notes?: string | null
          overhead_amount?: number
          overhead_pct?: number
          package_price?: number | null
          pilot_hours?: number
          pilot_rate?: number
          profit_amount?: number
          service_type?: string | null
          status?: string
          surcharge_warning?: boolean
          tax_estimate?: number
          total_charge?: number
          total_expenses?: number
          travel_gas?: number
          travel_hotel?: number
          travel_rental?: number
          updated_at?: string
          vo_hours?: number
          vo_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "mission_costings_converted_to_quote_id_fkey"
            columns: ["converted_to_quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      mission_equipment: {
        Row: {
          accessory_ids: string[] | null
          aircraft_id: string
          battery_ids: string[] | null
          controller_id: string | null
          created_at: string
          id: string
          mission_id: string
          notes: string | null
        }
        Insert: {
          accessory_ids?: string[] | null
          aircraft_id: string
          battery_ids?: string[] | null
          controller_id?: string | null
          created_at?: string
          id?: string
          mission_id: string
          notes?: string | null
        }
        Update: {
          accessory_ids?: string[] | null
          aircraft_id?: string
          battery_ids?: string[] | null
          controller_id?: string | null
          created_at?: string
          id?: string
          mission_id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mission_equipment_aircraft_id_fkey"
            columns: ["aircraft_id"]
            isOneToOne: false
            referencedRelation: "aircraft"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_equipment_controller_id_fkey"
            columns: ["controller_id"]
            isOneToOne: false
            referencedRelation: "controllers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_equipment_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "drone_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_equipment_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mission_weather_logs: {
        Row: {
          altimeter_inhg: number | null
          briefing_timestamp: string
          cloud_ceiling_ft: number | null
          created_at: string
          determination: Database["public"]["Enums"]["weather_determination"]
          determination_reasons: string[] | null
          dewpoint_c: number | null
          id: string
          kp_index: number | null
          metar_raw: string | null
          metar_station: string | null
          mission_id: string
          override_approved_by: string | null
          override_reason: string | null
          pilot_override: boolean
          precipitation_probability: number | null
          temperature_c: number | null
          visibility_sm: number | null
          wind_direction_deg: number | null
          wind_gust_ms: number | null
          wind_speed_ms: number | null
        }
        Insert: {
          altimeter_inhg?: number | null
          briefing_timestamp?: string
          cloud_ceiling_ft?: number | null
          created_at?: string
          determination: Database["public"]["Enums"]["weather_determination"]
          determination_reasons?: string[] | null
          dewpoint_c?: number | null
          id?: string
          kp_index?: number | null
          metar_raw?: string | null
          metar_station?: string | null
          mission_id: string
          override_approved_by?: string | null
          override_reason?: string | null
          pilot_override?: boolean
          precipitation_probability?: number | null
          temperature_c?: number | null
          visibility_sm?: number | null
          wind_direction_deg?: number | null
          wind_gust_ms?: number | null
          wind_speed_ms?: number | null
        }
        Update: {
          altimeter_inhg?: number | null
          briefing_timestamp?: string
          cloud_ceiling_ft?: number | null
          created_at?: string
          determination?: Database["public"]["Enums"]["weather_determination"]
          determination_reasons?: string[] | null
          dewpoint_c?: number | null
          id?: string
          kp_index?: number | null
          metar_raw?: string | null
          metar_station?: string | null
          mission_id?: string
          override_approved_by?: string | null
          override_reason?: string | null
          pilot_override?: boolean
          precipitation_probability?: number | null
          temperature_c?: number | null
          visibility_sm?: number | null
          wind_direction_deg?: number | null
          wind_gust_ms?: number | null
          wind_speed_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mission_weather_logs_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "drone_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_weather_logs_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_weather_logs_override_approved_by_fkey"
            columns: ["override_approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      n8n_heartbeat: {
        Row: {
          active_executions: number | null
          id: string
          instance_id: string
          last_ping: string
          metadata: Json | null
          version: string | null
          workflow_count: number | null
        }
        Insert: {
          active_executions?: number | null
          id?: string
          instance_id?: string
          last_ping?: string
          metadata?: Json | null
          version?: string | null
          workflow_count?: number | null
        }
        Update: {
          active_executions?: number | null
          id?: string
          instance_id?: string
          last_ping?: string
          metadata?: Json | null
          version?: string | null
          workflow_count?: number | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_email: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type: string
          user_email: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_email?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string | null
          id: string
          order_id: string
          product_color: string | null
          product_id: string
          product_name: string
          quantity: number
          total_price: number
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          order_id: string
          product_color?: string | null
          product_id: string
          product_name: string
          quantity?: number
          total_price: number
          unit_price: number
        }
        Update: {
          created_at?: string | null
          id?: string
          order_id?: string
          product_color?: string | null
          product_id?: string
          product_name?: string
          quantity?: number
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          admin_notes: string | null
          created_at: string | null
          customer_id: string | null
          id: string
          notes: string | null
          shipping: number | null
          shipping_address: string | null
          shipping_city: string | null
          shipping_state: string | null
          shipping_zip: string | null
          status: Database["public"]["Enums"]["order_status"] | null
          subtotal: number
          total: number
          updated_at: string | null
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          notes?: string | null
          shipping?: number | null
          shipping_address?: string | null
          shipping_city?: string | null
          shipping_state?: string | null
          shipping_zip?: string | null
          status?: Database["public"]["Enums"]["order_status"] | null
          subtotal?: number
          total?: number
          updated_at?: string | null
        }
        Update: {
          admin_notes?: string | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          notes?: string | null
          shipping?: number | null
          shipping_address?: string | null
          shipping_city?: string | null
          shipping_state?: string | null
          shipping_zip?: string | null
          status?: Database["public"]["Enums"]["order_status"] | null
          subtotal?: number
          total?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_log: {
        Row: {
          contact_method: Database["public"]["Enums"]["outreach_contact_method"]
          created_at: string
          id: string
          lead_id: string
          notes: string | null
          outcome: Database["public"]["Enums"]["outreach_outcome"] | null
        }
        Insert: {
          contact_method: Database["public"]["Enums"]["outreach_contact_method"]
          created_at?: string
          id?: string
          lead_id: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["outreach_outcome"] | null
        }
        Update: {
          contact_method?: Database["public"]["Enums"]["outreach_contact_method"]
          created_at?: string
          id?: string
          lead_id?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["outreach_outcome"] | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "drone_client_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "drone_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          customer_email: string
          delivery_date: string | null
          due_date: string | null
          id: string
          job_id: string | null
          overdue_notified_at: string | null
          paid_at: string | null
          payment_type: Database["public"]["Enums"]["payment_type"]
          quote_id: string
          square_invoice_id: string | null
          square_invoice_url: string | null
          square_payment_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          customer_email: string
          delivery_date?: string | null
          due_date?: string | null
          id?: string
          job_id?: string | null
          overdue_notified_at?: string | null
          paid_at?: string | null
          payment_type: Database["public"]["Enums"]["payment_type"]
          quote_id: string
          square_invoice_id?: string | null
          square_invoice_url?: string | null
          square_payment_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          customer_email?: string
          delivery_date?: string | null
          due_date?: string | null
          id?: string
          job_id?: string | null
          overdue_notified_at?: string | null
          paid_at?: string | null
          payment_type?: Database["public"]["Enums"]["payment_type"]
          quote_id?: string
          square_invoice_id?: string | null
          square_invoice_url?: string | null
          square_payment_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "drone_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      personas: {
        Row: {
          blotato_template_id: string | null
          brand: string
          canva_brand_kit_id: string | null
          canva_carousel_template_id: string | null
          content_guardrail: string | null
          content_guidelines: string | null
          created_at: string | null
          expertise_areas: string[]
          facebook_page_ids: string[] | null
          guardrail_notebook_ids: string[] | null
          heygen_avatar_id: string | null
          heygen_voice_id: string | null
          id: string
          is_active: boolean | null
          name: string
          newsletter_cta: string | null
          newsletter_url: string | null
          platform_accounts: Json
          profile_image_url: string | null
          tagline: string | null
          updated_at: string | null
          voice_pool: string[]
          voice_style: string
        }
        Insert: {
          blotato_template_id?: string | null
          brand: string
          canva_brand_kit_id?: string | null
          canva_carousel_template_id?: string | null
          content_guardrail?: string | null
          content_guidelines?: string | null
          created_at?: string | null
          expertise_areas: string[]
          facebook_page_ids?: string[] | null
          guardrail_notebook_ids?: string[] | null
          heygen_avatar_id?: string | null
          heygen_voice_id?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          newsletter_cta?: string | null
          newsletter_url?: string | null
          platform_accounts: Json
          profile_image_url?: string | null
          tagline?: string | null
          updated_at?: string | null
          voice_pool: string[]
          voice_style: string
        }
        Update: {
          blotato_template_id?: string | null
          brand?: string
          canva_brand_kit_id?: string | null
          canva_carousel_template_id?: string | null
          content_guardrail?: string | null
          content_guidelines?: string | null
          created_at?: string | null
          expertise_areas?: string[]
          facebook_page_ids?: string[] | null
          guardrail_notebook_ids?: string[] | null
          heygen_avatar_id?: string | null
          heygen_voice_id?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          newsletter_cta?: string | null
          newsletter_url?: string | null
          platform_accounts?: Json
          profile_image_url?: string | null
          tagline?: string | null
          updated_at?: string | null
          voice_pool?: string[]
          voice_style?: string
        }
        Relationships: []
      }
      pipeline_dlq: {
        Row: {
          correlation_id: string | null
          error: string
          failed_at: string
          id: string
          payload: Json
          retry_count: number
          workflow_name: string
        }
        Insert: {
          correlation_id?: string | null
          error: string
          failed_at?: string
          id?: string
          payload?: Json
          retry_count?: number
          workflow_name: string
        }
        Update: {
          correlation_id?: string | null
          error?: string
          failed_at?: string
          id?: string
          payload?: Json
          retry_count?: number
          workflow_name?: string
        }
        Relationships: []
      }
      pipeline_errors: {
        Row: {
          correlation_id: string | null
          error_message: string
          execution_id: string | null
          id: string
          node_name: string | null
          occurred_at: string
          workflow_name: string
        }
        Insert: {
          correlation_id?: string | null
          error_message: string
          execution_id?: string | null
          id?: string
          node_name?: string | null
          occurred_at?: string
          workflow_name: string
        }
        Update: {
          correlation_id?: string | null
          error_message?: string
          execution_id?: string | null
          id?: string
          node_name?: string | null
          occurred_at?: string
          workflow_name?: string
        }
        Relationships: []
      }
      pipeline_runs: {
        Row: {
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          detected_at: string | null
          error_message: string | null
          execution_id: string | null
          folder_name: string | null
          folder_path: string | null
          has_ppk_data: boolean | null
          id: string
          mission_number: number | null
          photo_count: number | null
          started_at: string | null
          status: string
          total_size_bytes: number | null
          updated_at: string
          video_count: number | null
          workflow_name: string | null
        }
        Insert: {
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          detected_at?: string | null
          error_message?: string | null
          execution_id?: string | null
          folder_name?: string | null
          folder_path?: string | null
          has_ppk_data?: boolean | null
          id?: string
          mission_number?: number | null
          photo_count?: number | null
          started_at?: string | null
          status?: string
          total_size_bytes?: number | null
          updated_at?: string
          video_count?: number | null
          workflow_name?: string | null
        }
        Update: {
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          detected_at?: string | null
          error_message?: string | null
          execution_id?: string | null
          folder_name?: string | null
          folder_path?: string | null
          has_ppk_data?: boolean | null
          id?: string
          mission_number?: number | null
          photo_count?: number | null
          started_at?: string | null
          status?: string
          total_size_bytes?: number | null
          updated_at?: string
          video_count?: number | null
          workflow_name?: string | null
        }
        Relationships: []
      }
      processing_jobs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          current_step: string | null
          error_message: string | null
          id: string
          idempotency_key: string | null
          mission_id: string
          processing_template_id: string | null
          started_at: string | null
          status: string
          steps: Json | null
          triggered_by: string | null
          updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          current_step?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          mission_id: string
          processing_template_id?: string | null
          started_at?: string | null
          status?: string
          steps?: Json | null
          triggered_by?: string | null
          updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          current_step?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          mission_id?: string
          processing_template_id?: string | null
          started_at?: string | null
          status?: string
          steps?: Json | null
          triggered_by?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "processing_jobs_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "drone_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processing_jobs_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processing_jobs_processing_template_id_fkey"
            columns: ["processing_template_id"]
            isOneToOne: false
            referencedRelation: "processing_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_steps: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          items_processed: number | null
          mission_id: string
          started_at: string | null
          status: string
          step_name: string
          step_order: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          items_processed?: number | null
          mission_id: string
          started_at?: string | null
          status?: string
          step_name: string
          step_order: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          items_processed?: number | null
          mission_id?: string
          started_at?: string | null
          status?: string
          step_name?: string
          step_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "processing_steps_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "drone_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processing_steps_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_templates: {
        Row: {
          active: boolean | null
          adiat_enabled: boolean | null
          created_at: string | null
          default_steps: Json | null
          description: string | null
          display_name: string | null
          id: string
          lightroom_preset: string | null
          output_format: string | null
          package_id: string | null
          path_code: string | null
          preset_name: string
          qa_api_threshold_high: number | null
          qa_api_threshold_low: number | null
          qa_threshold: number | null
          raw_workflow: boolean | null
          shot_requirements: Json | null
          step_definitions: Json | null
          updated_at: string | null
          vegetation_config: Json | null
          vegetation_enabled: boolean | null
          video_formats: Json | null
          video_included: boolean | null
          video_lut_name: string | null
          video_qa_thresholds: Json | null
        }
        Insert: {
          active?: boolean | null
          adiat_enabled?: boolean | null
          created_at?: string | null
          default_steps?: Json | null
          description?: string | null
          display_name?: string | null
          id?: string
          lightroom_preset?: string | null
          output_format?: string | null
          package_id?: string | null
          path_code?: string | null
          preset_name: string
          qa_api_threshold_high?: number | null
          qa_api_threshold_low?: number | null
          qa_threshold?: number | null
          raw_workflow?: boolean | null
          shot_requirements?: Json | null
          step_definitions?: Json | null
          updated_at?: string | null
          vegetation_config?: Json | null
          vegetation_enabled?: boolean | null
          video_formats?: Json | null
          video_included?: boolean | null
          video_lut_name?: string | null
          video_qa_thresholds?: Json | null
        }
        Update: {
          active?: boolean | null
          adiat_enabled?: boolean | null
          created_at?: string | null
          default_steps?: Json | null
          description?: string | null
          display_name?: string | null
          id?: string
          lightroom_preset?: string | null
          output_format?: string | null
          package_id?: string | null
          path_code?: string | null
          preset_name?: string
          qa_api_threshold_high?: number | null
          qa_api_threshold_low?: number | null
          qa_threshold?: number | null
          raw_workflow?: boolean | null
          shot_requirements?: Json | null
          step_definitions?: Json | null
          updated_at?: string | null
          vegetation_config?: Json | null
          vegetation_enabled?: boolean | null
          video_formats?: Json | null
          video_included?: boolean | null
          video_lut_name?: string | null
          video_qa_thresholds?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "processing_templates_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "drone_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processing_templates_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      product_waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          notified_at: string | null
          product_id: string
          product_name: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          notified_at?: string | null
          product_id: string
          product_name: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          notified_at?: string | null
          product_id?: string
          product_name?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          category: string
          color: string
          coming_soon: boolean
          created_at: string
          description: string
          features: string[]
          id: string
          image: string
          name: string
          original_price: number | null
          price: number
          sizes: Json | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string
          color: string
          coming_soon?: boolean
          created_at?: string
          description: string
          features?: string[]
          id?: string
          image: string
          name: string
          original_price?: number | null
          price: number
          sizes?: Json | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          color?: string
          coming_soon?: boolean
          created_at?: string
          description?: string
          features?: string[]
          id?: string
          image?: string
          name?: string
          original_price?: number | null
          price?: number
          sizes?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          full_name: string | null
          id: string
          part_107_expiry: string | null
          part_107_number: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id: string
          part_107_expiry?: string | null
          part_107_number?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          part_107_expiry?: string | null
          part_107_number?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      proposals: {
        Row: {
          admin_notes: string | null
          approval_token: string
          approved_at: string | null
          archived_at: string | null
          created_at: string | null
          customer_notes: string | null
          declined_at: string | null
          deliverables: Json | null
          discount: number | null
          id: string
          pricing_items: Json | null
          proposal_number: string
          scope_of_work: string
          sent_at: string | null
          service_request_id: string
          status: Database["public"]["Enums"]["proposal_status"] | null
          subtotal: number
          terms_and_conditions: string | null
          title: string
          total: number
          updated_at: string | null
          valid_until: string
          viewed_at: string | null
        }
        Insert: {
          admin_notes?: string | null
          approval_token: string
          approved_at?: string | null
          archived_at?: string | null
          created_at?: string | null
          customer_notes?: string | null
          declined_at?: string | null
          deliverables?: Json | null
          discount?: number | null
          id?: string
          pricing_items?: Json | null
          proposal_number: string
          scope_of_work: string
          sent_at?: string | null
          service_request_id: string
          status?: Database["public"]["Enums"]["proposal_status"] | null
          subtotal?: number
          terms_and_conditions?: string | null
          title: string
          total?: number
          updated_at?: string | null
          valid_until: string
          viewed_at?: string | null
        }
        Update: {
          admin_notes?: string | null
          approval_token?: string
          approved_at?: string | null
          archived_at?: string | null
          created_at?: string | null
          customer_notes?: string | null
          declined_at?: string | null
          deliverables?: Json | null
          discount?: number | null
          id?: string
          pricing_items?: Json | null
          proposal_number?: string
          scope_of_work?: string
          sent_at?: string | null
          service_request_id?: string
          status?: Database["public"]["Enums"]["proposal_status"] | null
          subtotal?: number
          terms_and_conditions?: string | null
          title?: string
          total?: number
          updated_at?: string | null
          valid_until?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposals_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      publish_reports: {
        Row: {
          created_at: string | null
          id: string
          persona_id: string | null
          platforms_failed: string[] | null
          platforms_published: string[] | null
          report_date: string
          required_review: boolean | null
          source_verified: boolean | null
          topic_id: string | null
          topic_title: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          persona_id?: string | null
          platforms_failed?: string[] | null
          platforms_published?: string[] | null
          report_date?: string
          required_review?: boolean | null
          source_verified?: boolean | null
          topic_id?: string | null
          topic_title: string
        }
        Update: {
          created_at?: string | null
          id?: string
          persona_id?: string | null
          platforms_failed?: string[] | null
          platforms_published?: string[] | null
          report_date?: string
          required_review?: boolean | null
          source_verified?: boolean | null
          topic_id?: string | null
          topic_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "publish_reports_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_reports_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      published_log: {
        Row: {
          created_at: string | null
          id: string
          persona_id: string
          published_at: string
          topic_hash: string
          topic_id: string | null
          topic_title: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          persona_id: string
          published_at: string
          topic_hash: string
          topic_id?: string | null
          topic_title: string
        }
        Update: {
          created_at?: string | null
          id?: string
          persona_id?: string
          published_at?: string
          topic_hash?: string
          topic_id?: string | null
          topic_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "published_log_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_log_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_requests: {
        Row: {
          address: string | null
          archived_at: string | null
          brand_slug: string
          created_at: string
          description: string
          email: string | null
          id: string
          job_type: string | null
          name: string
          phone: string | null
          preferred_date: string | null
          source: string
          status: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          brand_slug?: string
          created_at?: string
          description: string
          email?: string | null
          id?: string
          job_type?: string | null
          name: string
          phone?: string | null
          preferred_date?: string | null
          source?: string
          status?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          brand_slug?: string
          created_at?: string
          description?: string
          email?: string | null
          id?: string
          job_type?: string | null
          name?: string
          phone?: string | null
          preferred_date?: string | null
          source?: string
          status?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_requests_brand_slug_fkey"
            columns: ["brand_slug"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["slug"]
          },
        ]
      }
      quotes: {
        Row: {
          acceptance_token: string
          accepted_at: string | null
          created_at: string
          decline_reason: string | null
          declined_at: string | null
          deposit_amount: number
          expires_at: string | null
          id: string
          line_items: Json
          notes: string | null
          request_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["quote_status"]
          total: number
          updated_at: string
        }
        Insert: {
          acceptance_token?: string
          accepted_at?: string | null
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          deposit_amount?: number
          expires_at?: string | null
          id?: string
          line_items?: Json
          notes?: string | null
          request_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          total?: number
          updated_at?: string
        }
        Update: {
          acceptance_token?: string
          accepted_at?: string | null
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          deposit_amount?: number
          expires_at?: string | null
          id?: string
          line_items?: Json
          notes?: string | null
          request_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotes_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      report_images: {
        Row: {
          caption: string | null
          created_at: string | null
          id: string
          image_url: string
          metadata: Json | null
          report_id: string
          section_key: Database["public"]["Enums"]["report_section_key"]
          sort_order: number | null
          thumbnail_url: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string | null
          id?: string
          image_url: string
          metadata?: Json | null
          report_id: string
          section_key: Database["public"]["Enums"]["report_section_key"]
          sort_order?: number | null
          thumbnail_url?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string | null
          id?: string
          image_url?: string
          metadata?: Json | null
          report_id?: string
          section_key?: Database["public"]["Enums"]["report_section_key"]
          sort_order?: number | null
          thumbnail_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_images_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "job_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_templates: {
        Row: {
          brand_config: Json | null
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          sections_manifest: Json
          service_type: string
          updated_at: string | null
        }
        Insert: {
          brand_config?: Json | null
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          sections_manifest: Json
          service_type: string
          updated_at?: string | null
        }
        Update: {
          brand_config?: Json | null
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          sections_manifest?: Json
          service_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      retainers: {
        Row: {
          client_name: string
          created_at: string | null
          id: string
          monthly_rate: number
          next_billing_date: string
          notes: string | null
          shoots_included: number
          shoots_used: number
          start_date: string
          status: string
          updated_at: string | null
        }
        Insert: {
          client_name: string
          created_at?: string | null
          id?: string
          monthly_rate?: number
          next_billing_date: string
          notes?: string | null
          shoots_included?: number
          shoots_used?: number
          start_date?: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          client_name?: string
          created_at?: string | null
          id?: string
          monthly_rate?: number
          next_billing_date?: string
          notes?: string | null
          shoots_included?: number
          shoots_used?: number
          start_date?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      safety_audit_log: {
        Row: {
          created_at: string
          event_data: Json | null
          event_type: string
          id: string
          mission_id: string | null
          notes: string | null
          pilot_id: string | null
        }
        Insert: {
          created_at?: string
          event_data?: Json | null
          event_type: string
          id?: string
          mission_id?: string | null
          notes?: string | null
          pilot_id?: string | null
        }
        Update: {
          created_at?: string
          event_data?: Json | null
          event_type?: string
          id?: string
          mission_id?: string | null
          notes?: string | null
          pilot_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "safety_audit_log_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "drone_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_audit_log_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_emails: {
        Row: {
          context: Json | null
          created_at: string
          email_tracking_id: string | null
          id: string
          lead_id: string | null
          recipient_email: string
          recipient_name: string | null
          scheduled_for: string
          sent_at: string | null
          sequence_step: number
          sequence_type: Database["public"]["Enums"]["drip_sequence_type"]
          skip_reason: string | null
          status: Database["public"]["Enums"]["scheduled_email_status"]
        }
        Insert: {
          context?: Json | null
          created_at?: string
          email_tracking_id?: string | null
          id?: string
          lead_id?: string | null
          recipient_email: string
          recipient_name?: string | null
          scheduled_for: string
          sent_at?: string | null
          sequence_step: number
          sequence_type: Database["public"]["Enums"]["drip_sequence_type"]
          skip_reason?: string | null
          status?: Database["public"]["Enums"]["scheduled_email_status"]
        }
        Update: {
          context?: Json | null
          created_at?: string
          email_tracking_id?: string | null
          id?: string
          lead_id?: string | null
          recipient_email?: string
          recipient_name?: string | null
          scheduled_for?: string
          sent_at?: string | null
          sequence_step?: number
          sequence_type?: Database["public"]["Enums"]["drip_sequence_type"]
          skip_reason?: string | null
          status?: Database["public"]["Enums"]["scheduled_email_status"]
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_emails_email_tracking_id_fkey"
            columns: ["email_tracking_id"]
            isOneToOne: false
            referencedRelation: "email_tracking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_emails_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "drone_client_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_emails_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "drone_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      service_requests: {
        Row: {
          admin_notes: string | null
          archived_at: string | null
          budget_range: string | null
          client_email: string
          client_name: string
          client_phone: string
          company_name: string | null
          created_at: string | null
          id: string
          metadata: Json | null
          preferred_contact_method:
            | Database["public"]["Enums"]["contact_method"]
            | null
          project_description: string
          project_title: string | null
          service_id: string | null
          source: string | null
          status: Database["public"]["Enums"]["request_status"] | null
          target_end_date: string | null
          target_start_date: string | null
          updated_at: string | null
        }
        Insert: {
          admin_notes?: string | null
          archived_at?: string | null
          budget_range?: string | null
          client_email: string
          client_name: string
          client_phone: string
          company_name?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          preferred_contact_method?:
            | Database["public"]["Enums"]["contact_method"]
            | null
          project_description: string
          project_title?: string | null
          service_id?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["request_status"] | null
          target_end_date?: string | null
          target_start_date?: string | null
          updated_at?: string | null
        }
        Update: {
          admin_notes?: string | null
          archived_at?: string | null
          budget_range?: string | null
          client_email?: string
          client_name?: string
          client_phone?: string
          company_name?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          preferred_contact_method?:
            | Database["public"]["Enums"]["contact_method"]
            | null
          project_description?: string
          project_title?: string | null
          service_id?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["request_status"] | null
          target_end_date?: string | null
          target_start_date?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_requests_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          active: boolean | null
          category: string
          code: string
          created_at: string | null
          detailed_description: string | null
          id: string
          name: string
          packages: Json | null
          page_route: string | null
          pricing_unit: Database["public"]["Enums"]["pricing_unit"] | null
          short_description: string | null
          starting_price: number | null
        }
        Insert: {
          active?: boolean | null
          category: string
          code: string
          created_at?: string | null
          detailed_description?: string | null
          id?: string
          name: string
          packages?: Json | null
          page_route?: string | null
          pricing_unit?: Database["public"]["Enums"]["pricing_unit"] | null
          short_description?: string | null
          starting_price?: number | null
        }
        Update: {
          active?: boolean | null
          category?: string
          code?: string
          created_at?: string | null
          detailed_description?: string | null
          id?: string
          name?: string
          packages?: Json | null
          page_route?: string | null
          pricing_unit?: Database["public"]["Enums"]["pricing_unit"] | null
          short_description?: string | null
          starting_price?: number | null
        }
        Relationships: []
      }
      tfr_cache: {
        Row: {
          ceiling_ft: number | null
          center_latitude: number | null
          center_longitude: number | null
          created_at: string
          description: string | null
          effective_end: string | null
          effective_start: string | null
          fetched_at: string
          floor_ft: number | null
          id: string
          last_refresh_batch: string | null
          notam_number: string
          radius_nm: number | null
          raw_data: Json | null
          status: Database["public"]["Enums"]["tfr_status"]
          tfr_type: string | null
          updated_at: string
        }
        Insert: {
          ceiling_ft?: number | null
          center_latitude?: number | null
          center_longitude?: number | null
          created_at?: string
          description?: string | null
          effective_end?: string | null
          effective_start?: string | null
          fetched_at?: string
          floor_ft?: number | null
          id?: string
          last_refresh_batch?: string | null
          notam_number: string
          radius_nm?: number | null
          raw_data?: Json | null
          status?: Database["public"]["Enums"]["tfr_status"]
          tfr_type?: string | null
          updated_at?: string
        }
        Update: {
          ceiling_ft?: number | null
          center_latitude?: number | null
          center_longitude?: number | null
          created_at?: string
          description?: string | null
          effective_end?: string | null
          effective_start?: string | null
          fetched_at?: string
          floor_ft?: number | null
          id?: string
          last_refresh_batch?: string | null
          notam_number?: string
          radius_nm?: number | null
          raw_data?: Json | null
          status?: Database["public"]["Enums"]["tfr_status"]
          tfr_type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tfr_refresh_log: {
        Row: {
          created_at: string
          errors: string[] | null
          expired_count: number | null
          id: string
          in_area: number | null
          refreshed_at: string
          total_fetched: number | null
          upserted: number | null
        }
        Insert: {
          created_at?: string
          errors?: string[] | null
          expired_count?: number | null
          id?: string
          in_area?: number | null
          refreshed_at?: string
          total_fetched?: number | null
          upserted?: number | null
        }
        Update: {
          created_at?: string
          errors?: string[] | null
          expired_count?: number | null
          id?: string
          in_area?: number | null
          refreshed_at?: string
          total_fetched?: number | null
          upserted?: number | null
        }
        Relationships: []
      }
      topics: {
        Row: {
          approved_at: string | null
          content_ready_at: string | null
          created_at: string | null
          error_message: string | null
          historical_points: Json
          hook: string
          id: string
          persona_id: string
          publish_date: string | null
          publish_time: string | null
          published_at: string | null
          requires_review: boolean | null
          retry_count: number | null
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_verified: boolean | null
          status: string
          thumbnail_prompt: string | null
          title: string
          topic_hash: string
          topics_approved_at: string | null
          voice_id: string
        }
        Insert: {
          approved_at?: string | null
          content_ready_at?: string | null
          created_at?: string | null
          error_message?: string | null
          historical_points: Json
          hook: string
          id?: string
          persona_id: string
          publish_date?: string | null
          publish_time?: string | null
          published_at?: string | null
          requires_review?: boolean | null
          retry_count?: number | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_verified?: boolean | null
          status?: string
          thumbnail_prompt?: string | null
          title: string
          topic_hash: string
          topics_approved_at?: string | null
          voice_id: string
        }
        Update: {
          approved_at?: string | null
          content_ready_at?: string | null
          created_at?: string | null
          error_message?: string | null
          historical_points?: Json
          hook?: string
          id?: string
          persona_id?: string
          publish_date?: string | null
          publish_time?: string | null
          published_at?: string | null
          requires_review?: boolean | null
          retry_count?: number | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_verified?: boolean | null
          status?: string
          thumbnail_prompt?: string | null
          title?: string
          topic_hash?: string
          topics_approved_at?: string | null
          voice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topics_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vapi_call_logs: {
        Row: {
          assistant_id: string | null
          assistant_name: string | null
          call_id: string
          caller_number: string | null
          created_at: string | null
          duration_seconds: number | null
          ended_at: string | null
          ended_reason: string | null
          id: string
          is_repeat_caller: boolean | null
          language_preference: string | null
          lead_id: string | null
          messages_json: Json | null
          originating_line: string | null
          outcome: string | null
          phone_number_id: string | null
          recording_url: string | null
          sentiment: string | null
          started_at: string | null
          summary: string | null
          transcript: string | null
        }
        Insert: {
          assistant_id?: string | null
          assistant_name?: string | null
          call_id: string
          caller_number?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          id?: string
          is_repeat_caller?: boolean | null
          language_preference?: string | null
          lead_id?: string | null
          messages_json?: Json | null
          originating_line?: string | null
          outcome?: string | null
          phone_number_id?: string | null
          recording_url?: string | null
          sentiment?: string | null
          started_at?: string | null
          summary?: string | null
          transcript?: string | null
        }
        Update: {
          assistant_id?: string | null
          assistant_name?: string | null
          call_id?: string
          caller_number?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          id?: string
          is_repeat_caller?: boolean | null
          language_preference?: string | null
          lead_id?: string | null
          messages_json?: Json | null
          originating_line?: string | null
          outcome?: string | null
          phone_number_id?: string | null
          recording_url?: string | null
          sentiment?: string | null
          started_at?: string | null
          summary?: string | null
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vapi_call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      vegetation_analysis_summary: {
        Row: {
          api_calls_total: number | null
          avg_health_score: number | null
          canopy_coverage_pct: number | null
          created_at: string | null
          geojson_path: string | null
          health_distribution: Json | null
          health_map_path: string | null
          id: string
          interactive_map_path: string | null
          mission_id: string
          needs_attention_count: number | null
          pdf_report_path: string | null
          processing_time_seconds: number | null
          site_area_acres: number | null
          site_area_sqm: number | null
          species_distribution: Json | null
          species_map_path: string | null
          total_canopy_count: number | null
          unique_species_count: number | null
          updated_at: string | null
        }
        Insert: {
          api_calls_total?: number | null
          avg_health_score?: number | null
          canopy_coverage_pct?: number | null
          created_at?: string | null
          geojson_path?: string | null
          health_distribution?: Json | null
          health_map_path?: string | null
          id?: string
          interactive_map_path?: string | null
          mission_id: string
          needs_attention_count?: number | null
          pdf_report_path?: string | null
          processing_time_seconds?: number | null
          site_area_acres?: number | null
          site_area_sqm?: number | null
          species_distribution?: Json | null
          species_map_path?: string | null
          total_canopy_count?: number | null
          unique_species_count?: number | null
          updated_at?: string | null
        }
        Update: {
          api_calls_total?: number | null
          avg_health_score?: number | null
          canopy_coverage_pct?: number | null
          created_at?: string | null
          geojson_path?: string | null
          health_distribution?: Json | null
          health_map_path?: string | null
          id?: string
          interactive_map_path?: string | null
          mission_id?: string
          needs_attention_count?: number | null
          pdf_report_path?: string | null
          processing_time_seconds?: number | null
          site_area_acres?: number | null
          site_area_sqm?: number | null
          species_distribution?: Json | null
          species_map_path?: string | null
          total_canopy_count?: number | null
          unique_species_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vegetation_analysis_summary_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: true
            referencedRelation: "drone_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vegetation_analysis_summary_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      vegetation_detections: {
        Row: {
          canopy_area_sqm: number | null
          canopy_height_m: number | null
          canopy_width_m: number | null
          centroid_lat: number
          centroid_lon: number
          classification_details: Json | null
          created_at: string | null
          cross_validated: boolean | null
          detection_confidence: number | null
          detection_index: number
          excluded: boolean | null
          flagged_for_review: boolean | null
          geometry_wkt: string
          health_details: Json | null
          health_score: number | null
          health_status: string | null
          id: string
          metadata: Json | null
          mission_id: string
          processing_job_id: string | null
          review_notes: string | null
          review_status: string | null
          species_confidence: number | null
          species_tag: string | null
          updated_at: string | null
          vegetation_type: string | null
        }
        Insert: {
          canopy_area_sqm?: number | null
          canopy_height_m?: number | null
          canopy_width_m?: number | null
          centroid_lat: number
          centroid_lon: number
          classification_details?: Json | null
          created_at?: string | null
          cross_validated?: boolean | null
          detection_confidence?: number | null
          detection_index: number
          excluded?: boolean | null
          flagged_for_review?: boolean | null
          geometry_wkt: string
          health_details?: Json | null
          health_score?: number | null
          health_status?: string | null
          id?: string
          metadata?: Json | null
          mission_id: string
          processing_job_id?: string | null
          review_notes?: string | null
          review_status?: string | null
          species_confidence?: number | null
          species_tag?: string | null
          updated_at?: string | null
          vegetation_type?: string | null
        }
        Update: {
          canopy_area_sqm?: number | null
          canopy_height_m?: number | null
          canopy_width_m?: number | null
          centroid_lat?: number
          centroid_lon?: number
          classification_details?: Json | null
          created_at?: string | null
          cross_validated?: boolean | null
          detection_confidence?: number | null
          detection_index?: number
          excluded?: boolean | null
          flagged_for_review?: boolean | null
          geometry_wkt?: string
          health_details?: Json | null
          health_score?: number | null
          health_status?: string | null
          id?: string
          metadata?: Json | null
          mission_id?: string
          processing_job_id?: string | null
          review_notes?: string | null
          review_status?: string | null
          species_confidence?: number | null
          species_tag?: string | null
          updated_at?: string | null
          vegetation_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vegetation_detections_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "drone_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vegetation_detections_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vegetation_detections_processing_job_id_fkey"
            columns: ["processing_job_id"]
            isOneToOne: false
            referencedRelation: "processing_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      video_assets: {
        Row: {
          altitude_avg: number | null
          codec: string | null
          color_profile: string | null
          created_at: string
          duration_seconds: number | null
          file_size_bytes: number | null
          filename: string
          fps: number | null
          gps_end_lat: number | null
          gps_end_lon: number | null
          gps_start_lat: number | null
          gps_start_lon: number | null
          graded_path: string | null
          has_lrf_proxy: boolean | null
          has_srt_telemetry: boolean | null
          id: string
          iso_avg: number | null
          iso_max: number | null
          mission_id: string
          qa_flags: Json | null
          qa_status: string | null
          resolution: string | null
          sequence_number: number
          source_platform: string | null
        }
        Insert: {
          altitude_avg?: number | null
          codec?: string | null
          color_profile?: string | null
          created_at?: string
          duration_seconds?: number | null
          file_size_bytes?: number | null
          filename: string
          fps?: number | null
          gps_end_lat?: number | null
          gps_end_lon?: number | null
          gps_start_lat?: number | null
          gps_start_lon?: number | null
          graded_path?: string | null
          has_lrf_proxy?: boolean | null
          has_srt_telemetry?: boolean | null
          id?: string
          iso_avg?: number | null
          iso_max?: number | null
          mission_id: string
          qa_flags?: Json | null
          qa_status?: string | null
          resolution?: string | null
          sequence_number: number
          source_platform?: string | null
        }
        Update: {
          altitude_avg?: number | null
          codec?: string | null
          color_profile?: string | null
          created_at?: string
          duration_seconds?: number | null
          file_size_bytes?: number | null
          filename?: string
          fps?: number | null
          gps_end_lat?: number | null
          gps_end_lon?: number | null
          gps_start_lat?: number | null
          gps_start_lon?: number | null
          graded_path?: string | null
          has_lrf_proxy?: boolean | null
          has_srt_telemetry?: boolean | null
          id?: string
          iso_avg?: number | null
          iso_max?: number | null
          mission_id?: string
          qa_flags?: Json | null
          qa_status?: string | null
          resolution?: string | null
          sequence_number?: number
          source_platform?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_assets_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "drone_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_assets_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      visual_assets: {
        Row: {
          asset_type: string
          asset_url: string | null
          content_piece_id: string
          created_at: string | null
          id: string
          metadata: Json | null
          source_id: string | null
          source_service: string
          status: string
        }
        Insert: {
          asset_type: string
          asset_url?: string | null
          content_piece_id: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          source_id?: string | null
          source_service: string
          status?: string
        }
        Update: {
          asset_type?: string
          asset_url?: string | null
          content_piece_id?: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          source_id?: string | null
          source_service?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "visual_assets_content_piece_id_fkey"
            columns: ["content_piece_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
        ]
      }
      voices: {
        Row: {
          accent: string | null
          created_at: string | null
          gender: string | null
          id: string
          is_active: boolean | null
          last_used_at: string | null
          name: string
          style: string | null
          use_count: number | null
        }
        Insert: {
          accent?: string | null
          created_at?: string | null
          gender?: string | null
          id: string
          is_active?: boolean | null
          last_used_at?: string | null
          name: string
          style?: string | null
          use_count?: number | null
        }
        Update: {
          accent?: string | null
          created_at?: string | null
          gender?: string | null
          id?: string
          is_active?: boolean | null
          last_used_at?: string | null
          name?: string
          style?: string | null
          use_count?: number | null
        }
        Relationships: []
      }
      weather_forecast_cache: {
        Row: {
          cloud_ceiling_ft: number | null
          determination: Database["public"]["Enums"]["weather_determination"]
          determination_reasons: string[] | null
          fetched_at: string
          forecast_hour: string
          id: string
          precipitation_probability: number | null
          sky_cover_pct: number | null
          temperature_c: number | null
          visibility_sm: number | null
          wind_gust_ms: number | null
          wind_speed_ms: number | null
        }
        Insert: {
          cloud_ceiling_ft?: number | null
          determination: Database["public"]["Enums"]["weather_determination"]
          determination_reasons?: string[] | null
          fetched_at?: string
          forecast_hour: string
          id?: string
          precipitation_probability?: number | null
          sky_cover_pct?: number | null
          temperature_c?: number | null
          visibility_sm?: number | null
          wind_gust_ms?: number | null
          wind_speed_ms?: number | null
        }
        Update: {
          cloud_ceiling_ft?: number | null
          determination?: Database["public"]["Enums"]["weather_determination"]
          determination_reasons?: string[] | null
          fetched_at?: string
          forecast_hour?: string
          id?: string
          precipitation_probability?: number | null
          sky_cover_pct?: number | null
          temperature_c?: number | null
          visibility_sm?: number | null
          wind_gust_ms?: number | null
          wind_speed_ms?: number | null
        }
        Relationships: []
      }
      weather_thresholds: {
        Row: {
          aircraft_model: string | null
          created_at: string
          id: string
          is_part_107_minimum: boolean
          label: string
          max_kp_index: number | null
          max_precip_probability: number | null
          max_temp_c: number | null
          max_wind_speed_ms: number | null
          min_cloud_ceiling_ft: number | null
          min_temp_c: number | null
          min_visibility_sm: number | null
          notes: string | null
          package_type: string | null
          updated_at: string
        }
        Insert: {
          aircraft_model?: string | null
          created_at?: string
          id?: string
          is_part_107_minimum?: boolean
          label: string
          max_kp_index?: number | null
          max_precip_probability?: number | null
          max_temp_c?: number | null
          max_wind_speed_ms?: number | null
          min_cloud_ceiling_ft?: number | null
          min_temp_c?: number | null
          min_visibility_sm?: number | null
          notes?: string | null
          package_type?: string | null
          updated_at?: string
        }
        Update: {
          aircraft_model?: string | null
          created_at?: string
          id?: string
          is_part_107_minimum?: boolean
          label?: string
          max_kp_index?: number | null
          max_precip_probability?: number | null
          max_temp_c?: number | null
          max_wind_speed_ms?: number | null
          min_cloud_ceiling_ft?: number | null
          min_temp_c?: number | null
          min_visibility_sm?: number | null
          notes?: string | null
          package_type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      workflow_locks: {
        Row: {
          expires_at: string
          id: string
          lock_token: string
          locked_at: string
          workflow_id: string
        }
        Insert: {
          expires_at: string
          id?: string
          lock_token?: string
          locked_at?: string
          workflow_id: string
        }
        Update: {
          expires_at?: string
          id?: string
          lock_token?: string
          locked_at?: string
          workflow_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      cost_summary: {
        Row: {
          date: string | null
          operations: number | null
          service: string | null
          total_cost: number | null
        }
        Relationships: []
      }
      drone_client_summary: {
        Row: {
          avg_satisfaction: number | null
          city: string | null
          company_name: string | null
          engagements_this_month: number | null
          id: string | null
          last_engagement: string | null
          next_scheduled: string | null
          portfolio_type: string | null
          total_engagements: number | null
          total_revenue: number | null
        }
        Relationships: []
      }
      drone_pipeline_summary: {
        Row: {
          count: number | null
          new_this_week: number | null
          status: Database["public"]["Enums"]["lead_status"] | null
          with_email: number | null
        }
        Relationships: []
      }
      jobs: {
        Row: {
          client_email: string | null
          client_name: string | null
          client_phone: string | null
          created_at: string | null
          delivered_at: string | null
          download_url: string | null
          id: string | null
          job_number: string | null
          package_id: string | null
          project_name: string | null
          qa_score: number | null
          scheduled_date: string | null
          status: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drone_jobs_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "drone_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drone_jobs_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_activity: {
        Row: {
          event_at: string | null
          event_type: string | null
          lead_id: string | null
          source_id: string | null
          summary: string | null
        }
        Relationships: []
      }
      packages: {
        Row: {
          active: boolean | null
          category: string | null
          code: string | null
          description: string | null
          edit_budget_minutes: number | null
          features: string[] | null
          id: string | null
          name: string | null
          price: number | null
          processing_profile: Json | null
          shot_manifest: Json | null
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          code?: string | null
          description?: string | null
          edit_budget_minutes?: number | null
          features?: string[] | null
          id?: string | null
          name?: string | null
          price?: number | null
          processing_profile?: Json | null
          shot_manifest?: Json | null
        }
        Update: {
          active?: boolean | null
          category?: string | null
          code?: string | null
          description?: string | null
          edit_budget_minutes?: number | null
          features?: string[] | null
          id?: string | null
          name?: string | null
          price?: number | null
          processing_profile?: Json | null
          shot_manifest?: Json | null
        }
        Relationships: []
      }
      quote_attribution: {
        Row: {
          first_quote: string | null
          latest_quote: string | null
          total_quotes: number | null
          unique_leads: number | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Relationships: []
      }
      v_recent_pipeline_errors: {
        Row: {
          correlation_id: string | null
          error_message: string | null
          execution_id: string | null
          id: string | null
          node_name: string | null
          occurred_at: string | null
          workflow_name: string | null
        }
        Insert: {
          correlation_id?: string | null
          error_message?: string | null
          execution_id?: string | null
          id?: string | null
          node_name?: string | null
          occurred_at?: string | null
          workflow_name?: string | null
        }
        Update: {
          correlation_id?: string | null
          error_message?: string | null
          execution_id?: string | null
          id?: string | null
          node_name?: string | null
          occurred_at?: string | null
          workflow_name?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      check_duplicate_topic: {
        Args: { p_persona_id: string; p_threshold?: number; p_title: string }
        Returns: {
          is_duplicate: boolean
          similar_title: string
          similarity: number
        }[]
      }
      create_drone_job_from_quote: {
        Args: { p_quote_id: string }
        Returns: string
      }
      delete_accessory_safe: {
        Args: { p_accessory_id: string }
        Returns: undefined
      }
      generate_app_api_key: { Args: { p_app_id: string }; Returns: string }
      generate_drone_job_number: { Args: never; Returns: string }
      generate_proposal_number: { Args: never; Returns: string }
      get_app_announcements: {
        Args: { p_app_id: string }
        Returns: {
          ends_at: string
          id: string
          message: string
          priority: number
          starts_at: string
          title: string
          type: string
        }[]
      }
      get_lru_voice: { Args: { p_persona_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      lead_stats: { Args: { time_window?: string }; Returns: Json }
      log_flight: {
        Args: {
          p_aircraft_id: string
          p_battery_ids: string[]
          p_flight_hours: number
        }
        Returns: undefined
      }
      record_app_heartbeat: {
        Args: {
          p_app_id: string
          p_metrics?: Json
          p_response_time_ms?: number
          p_status?: string
          p_version?: string
        }
        Returns: boolean
      }
      register_app_with_bootstrap: {
        Args: {
          p_code: string
          p_name: string
          p_owner_email?: string
          p_owner_name?: string
          p_url?: string
          p_version?: string
        }
        Returns: {
          api_key: string
          app_id: string
        }[]
      }
      revoke_app_api_key: { Args: { p_app_id: string }; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      upsert_customer_from_quote_request: {
        Args: { p_qr_id: string }
        Returns: string
      }
      validate_api_key: {
        Args: { p_api_key: string }
        Returns: {
          app_code: string
          app_id: string
          app_name: string
          is_valid: boolean
        }[]
      }
    }
    Enums: {
      accessory_type:
        | "filter"
        | "lens"
        | "propeller"
        | "case"
        | "charger"
        | "antenna"
        | "mount"
        | "other"
      app_role: "admin" | "user" | "pilot"
      authorization_status:
        | "not_started"
        | "pending"
        | "auto_approved"
        | "manual_review"
        | "approved"
        | "denied"
        | "expired"
        | "cancelled"
      authorization_type: "laanc" | "caps" | "coa" | "waiver" | "none_required"
      batch_recommendation:
        | "deliver_as_planned"
        | "extended_processing"
        | "partial_reshoot"
        | "full_reshoot"
        | "incomplete_package"
      contact_method: "email" | "phone" | "text"
      drip_sequence_type: "outreach_drip" | "post_delivery" | "vapi_followup"
      drone_job_status:
        | "intake"
        | "scheduled"
        | "captured"
        | "uploaded"
        | "ingested"
        | "complete"
        | "paid"
        | "processing"
        | "review_pending"
        | "qa"
        | "revision"
        | "delivered"
        | "failed"
        | "cancelled"
        | "video_grading"
        | "video_editing"
        | "video_exporting"
        | "photos_delivered"
      engagement_status: "scheduled" | "in_progress" | "completed" | "cancelled"
      engagement_type:
        | "turnover"
        | "inspection"
        | "quarterly"
        | "project"
        | "storm"
        | "marketing"
      equipment_type: "aircraft" | "battery" | "controller" | "accessory"
      lead_gen_job_status: "pending" | "running" | "completed" | "failed"
      lead_source_channel:
        | "voice_bot"
        | "web_form"
        | "manual"
        | "email_outreach"
        | "social"
      lead_status: "new" | "contacted" | "responded" | "qualified" | "client"
      maintenance_type:
        | "scheduled"
        | "unscheduled"
        | "repair"
        | "inspection"
        | "firmware_update"
        | "calibration"
      order_status:
        | "pending"
        | "confirmed"
        | "processing"
        | "shipped"
        | "delivered"
        | "cancelled"
      outreach_contact_method:
        | "email"
        | "call"
        | "linkedin"
        | "meeting"
        | "other"
      outreach_outcome:
        | "no_answer"
        | "voicemail"
        | "spoke"
        | "email_sent"
        | "meeting_scheduled"
        | "not_interested"
      payment_status: "pending" | "paid" | "overdue" | "waived"
      payment_type: "deposit" | "balance"
      photogrammetry_status:
        | "pending"
        | "queued"
        | "processing"
        | "completed"
        | "failed"
      pricing_unit:
        | "per_project"
        | "per_hour"
        | "per_session"
        | "per_month"
        | "per_video"
        | "per_event"
        | "starting_at"
      proposal_status:
        | "draft"
        | "sent"
        | "viewed"
        | "approved"
        | "declined"
        | "expired"
        | "revision_requested"
      qa_recommendation: "pass" | "warning" | "fail"
      qa_status:
        | "pending"
        | "analyzing"
        | "passed"
        | "warning"
        | "failed"
        | "approved"
        | "rejected"
      quote_status:
        | "draft"
        | "sent"
        | "accepted"
        | "declined"
        | "revised"
        | "expired"
      report_section_key:
        | "cover_page"
        | "executive_summary"
        | "methodology"
        | "equipment"
        | "flight_data"
        | "weather_conditions"
        | "findings"
        | "species_table"
        | "population_estimate"
        | "confidence_interval"
        | "detection_heatmap"
        | "transect_map"
        | "annotated_imagery"
        | "change_detection"
        | "anomaly_log"
        | "volumetrics"
        | "deliverables_manifest"
        | "appendix_flight_logs"
        | "appendix_raw_data"
      report_status: "draft" | "final" | "archived"
      request_status:
        | "new"
        | "contacted"
        | "scoping"
        | "quoted"
        | "closed"
        | "declined"
      scheduled_email_status: "pending" | "sent" | "skipped" | "cancelled"
      tfr_status: "active" | "scheduled" | "expired" | "cancelled"
      weather_determination: "GO" | "CAUTION" | "NO_GO"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      accessory_type: [
        "filter",
        "lens",
        "propeller",
        "case",
        "charger",
        "antenna",
        "mount",
        "other",
      ],
      app_role: ["admin", "user", "pilot"],
      authorization_status: [
        "not_started",
        "pending",
        "auto_approved",
        "manual_review",
        "approved",
        "denied",
        "expired",
        "cancelled",
      ],
      authorization_type: ["laanc", "caps", "coa", "waiver", "none_required"],
      batch_recommendation: [
        "deliver_as_planned",
        "extended_processing",
        "partial_reshoot",
        "full_reshoot",
        "incomplete_package",
      ],
      contact_method: ["email", "phone", "text"],
      drip_sequence_type: ["outreach_drip", "post_delivery", "vapi_followup"],
      drone_job_status: [
        "intake",
        "scheduled",
        "captured",
        "uploaded",
        "ingested",
        "complete",
        "paid",
        "processing",
        "review_pending",
        "qa",
        "revision",
        "delivered",
        "failed",
        "cancelled",
        "video_grading",
        "video_editing",
        "video_exporting",
        "photos_delivered",
      ],
      engagement_status: ["scheduled", "in_progress", "completed", "cancelled"],
      engagement_type: [
        "turnover",
        "inspection",
        "quarterly",
        "project",
        "storm",
        "marketing",
      ],
      equipment_type: ["aircraft", "battery", "controller", "accessory"],
      lead_gen_job_status: ["pending", "running", "completed", "failed"],
      lead_source_channel: [
        "voice_bot",
        "web_form",
        "manual",
        "email_outreach",
        "social",
      ],
      lead_status: ["new", "contacted", "responded", "qualified", "client"],
      maintenance_type: [
        "scheduled",
        "unscheduled",
        "repair",
        "inspection",
        "firmware_update",
        "calibration",
      ],
      order_status: [
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
      ],
      outreach_contact_method: [
        "email",
        "call",
        "linkedin",
        "meeting",
        "other",
      ],
      outreach_outcome: [
        "no_answer",
        "voicemail",
        "spoke",
        "email_sent",
        "meeting_scheduled",
        "not_interested",
      ],
      payment_status: ["pending", "paid", "overdue", "waived"],
      payment_type: ["deposit", "balance"],
      photogrammetry_status: [
        "pending",
        "queued",
        "processing",
        "completed",
        "failed",
      ],
      pricing_unit: [
        "per_project",
        "per_hour",
        "per_session",
        "per_month",
        "per_video",
        "per_event",
        "starting_at",
      ],
      proposal_status: [
        "draft",
        "sent",
        "viewed",
        "approved",
        "declined",
        "expired",
        "revision_requested",
      ],
      qa_recommendation: ["pass", "warning", "fail"],
      qa_status: [
        "pending",
        "analyzing",
        "passed",
        "warning",
        "failed",
        "approved",
        "rejected",
      ],
      quote_status: [
        "draft",
        "sent",
        "accepted",
        "declined",
        "revised",
        "expired",
      ],
      report_section_key: [
        "cover_page",
        "executive_summary",
        "methodology",
        "equipment",
        "flight_data",
        "weather_conditions",
        "findings",
        "species_table",
        "population_estimate",
        "confidence_interval",
        "detection_heatmap",
        "transect_map",
        "annotated_imagery",
        "change_detection",
        "anomaly_log",
        "volumetrics",
        "deliverables_manifest",
        "appendix_flight_logs",
        "appendix_raw_data",
      ],
      report_status: ["draft", "final", "archived"],
      request_status: [
        "new",
        "contacted",
        "scoping",
        "quoted",
        "closed",
        "declined",
      ],
      scheduled_email_status: ["pending", "sent", "skipped", "cancelled"],
      tfr_status: ["active", "scheduled", "expired", "cancelled"],
      weather_determination: ["GO", "CAUTION", "NO_GO"],
    },
  },
} as const
