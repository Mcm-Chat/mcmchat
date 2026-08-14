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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      avatar_audience: {
        Row: {
          created_at: string
          id: string
          mode: string
          owner_id: string
          target_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          mode: string
          owner_id: string
          target_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          mode?: string
          owner_id?: string
          target_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      background_action_log: {
        Row: {
          action: string
          created_at: string
          device_id: string | null
          id: string
          idempotency_key: string
          result: Json
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          device_id?: string | null
          id?: string
          idempotency_key: string
          result?: Json
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          device_id?: string | null
          id?: string
          idempotency_key?: string
          result?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "background_action_log_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      business_conversations: {
        Row: {
          business_id: string
          conversation_id: string
          created_at: string
          customer_id: string
        }
        Insert: {
          business_id: string
          conversation_id: string
          created_at?: string
          customer_id: string
        }
        Update: {
          business_id?: string
          conversation_id?: string
          created_at?: string
          customer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_conversations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_conversations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      business_members: {
        Row: {
          business_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["business_role"]
          staff_display_name: string
          staff_pin: string | null
          staff_pin_confirmed_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["business_role"]
          staff_display_name?: string
          staff_pin?: string | null
          staff_pin_confirmed_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["business_role"]
          staff_display_name?: string
          staff_pin?: string | null
          staff_pin_confirmed_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_members_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          address: string
          away_message: string
          category: string
          contact: string
          created_at: string
          description: string
          greeting: string
          hours: string
          id: string
          is_public: boolean
          logo_emoji: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          address?: string
          away_message?: string
          category?: string
          contact?: string
          created_at?: string
          description?: string
          greeting?: string
          hours?: string
          id?: string
          is_public?: boolean
          logo_emoji?: string
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          address?: string
          away_message?: string
          category?: string
          contact?: string
          created_at?: string
          description?: string
          greeting?: string
          hours?: string
          id?: string
          is_public?: boolean
          logo_emoji?: string
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      call_diagnostic_runs: {
        Row: {
          code: string
          created_at: string
          detail: string
          id: string
          kind: string
          latency_ms: number | null
          status: string
          user_id: string
        }
        Insert: {
          code?: string
          created_at?: string
          detail?: string
          id?: string
          kind?: string
          latency_ms?: number | null
          status: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          detail?: string
          id?: string
          kind?: string
          latency_ms?: number | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      call_participants: {
        Row: {
          call_id: string
          joined_at: string | null
          left_at: string | null
          user_id: string
        }
        Insert: {
          call_id: string
          joined_at?: string | null
          left_at?: string | null
          user_id: string
        }
        Update: {
          call_id?: string
          joined_at?: string | null
          left_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_participants_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          answered_at: string | null
          conversation_id: string | null
          created_at: string
          duration_sec: number
          end_reason: string | null
          ended_at: string | null
          id: string
          initiator_id: string
          kind: Database["public"]["Enums"]["call_kind"]
          max_participants: number
          provider: string
          room_name: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["call_status"]
          updated_at: string
        }
        Insert: {
          answered_at?: string | null
          conversation_id?: string | null
          created_at?: string
          duration_sec?: number
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          initiator_id: string
          kind?: Database["public"]["Enums"]["call_kind"]
          max_participants?: number
          provider?: string
          room_name?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["call_status"]
          updated_at?: string
        }
        Update: {
          answered_at?: string | null
          conversation_id?: string | null
          created_at?: string
          duration_sec?: number
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          initiator_id?: string
          kind?: Database["public"]["Enums"]["call_kind"]
          max_participants?: number
          provider?: string
          room_name?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["call_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_order_items: {
        Row: {
          availability_note: string
          business_id: string
          chat_order_id: string
          created_at: string
          discount: number
          id: string
          per_unit_qty: number
          per_unit_qty_base: number
          per_unit_unit: string
          price: number
          product_id: string | null
          product_name: string
          sort_order: number
          unit_count: number
          updated_at: string
          variant_id: string | null
          variant_name: string
        }
        Insert: {
          availability_note?: string
          business_id: string
          chat_order_id: string
          created_at?: string
          discount?: number
          id?: string
          per_unit_qty?: number
          per_unit_qty_base?: number
          per_unit_unit?: string
          price?: number
          product_id?: string | null
          product_name?: string
          sort_order?: number
          unit_count?: number
          updated_at?: string
          variant_id?: string | null
          variant_name?: string
        }
        Update: {
          availability_note?: string
          business_id?: string
          chat_order_id?: string
          created_at?: string
          discount?: number
          id?: string
          per_unit_qty?: number
          per_unit_qty_base?: number
          per_unit_unit?: string
          price?: number
          product_id?: string | null
          product_name?: string
          sort_order?: number
          unit_count?: number
          updated_at?: string
          variant_id?: string | null
          variant_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_order_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_order_items_chat_order_id_fkey"
            columns: ["chat_order_id"]
            isOneToOne: false
            referencedRelation: "chat_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_order_unit_slots: {
        Row: {
          chat_order_id: string
          created_at: string
          id: string
          item_id: string
          mode: Database["public"]["Enums"]["unit_slot_mode"]
          preparation_job_item_id: string | null
          qty_base: number
          slot_no: number
          status: Database["public"]["Enums"]["unit_slot_status"]
          stock_unit_id: string | null
          updated_at: string
        }
        Insert: {
          chat_order_id: string
          created_at?: string
          id?: string
          item_id: string
          mode?: Database["public"]["Enums"]["unit_slot_mode"]
          preparation_job_item_id?: string | null
          qty_base: number
          slot_no: number
          status?: Database["public"]["Enums"]["unit_slot_status"]
          stock_unit_id?: string | null
          updated_at?: string
        }
        Update: {
          chat_order_id?: string
          created_at?: string
          id?: string
          item_id?: string
          mode?: Database["public"]["Enums"]["unit_slot_mode"]
          preparation_job_item_id?: string | null
          qty_base?: number
          slot_no?: number
          status?: Database["public"]["Enums"]["unit_slot_status"]
          stock_unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_order_unit_slots_chat_order_id_fkey"
            columns: ["chat_order_id"]
            isOneToOne: false
            referencedRelation: "chat_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_order_unit_slots_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "chat_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_order_unit_slots_preparation_job_item_id_fkey"
            columns: ["preparation_job_item_id"]
            isOneToOne: false
            referencedRelation: "preparation_job_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_order_unit_slots_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "variant_stock_units"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_orders: {
        Row: {
          approved_at: string | null
          business_id: string
          buyer_user_id: string | null
          cancelled_at: string | null
          confirmed_at: string | null
          conversation_id: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string
          delivered_at: string | null
          discount: number
          dispatched_at: string | null
          extra_fee: number
          id: string
          idempotency_key: string
          ledger_id: string | null
          note: string
          order_id: string | null
          preparation_job_id: string | null
          ready_at: string | null
          request_message_id: string | null
          result_message_id: string | null
          sales_record_id: string | null
          seller_id: string | null
          seller_note: string
          status: Database["public"]["Enums"]["chat_order_status"]
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          business_id: string
          buyer_user_id?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          conversation_id: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string
          delivered_at?: string | null
          discount?: number
          dispatched_at?: string | null
          extra_fee?: number
          id?: string
          idempotency_key?: string
          ledger_id?: string | null
          note?: string
          order_id?: string | null
          preparation_job_id?: string | null
          ready_at?: string | null
          request_message_id?: string | null
          result_message_id?: string | null
          sales_record_id?: string | null
          seller_id?: string | null
          seller_note?: string
          status?: Database["public"]["Enums"]["chat_order_status"]
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          business_id?: string
          buyer_user_id?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string
          delivered_at?: string | null
          discount?: number
          dispatched_at?: string | null
          extra_fee?: number
          id?: string
          idempotency_key?: string
          ledger_id?: string | null
          note?: string
          order_id?: string | null
          preparation_job_id?: string | null
          ready_at?: string | null
          request_message_id?: string | null
          result_message_id?: string | null
          sales_record_id?: string | null
          seller_id?: string | null
          seller_note?: string
          status?: Database["public"]["Enums"]["chat_order_status"]
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_orders_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_orders_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "ledgers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_orders_preparation_job_id_fkey"
            columns: ["preparation_job_id"]
            isOneToOne: false
            referencedRelation: "preparation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_orders_request_message_id_fkey"
            columns: ["request_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_orders_result_message_id_fkey"
            columns: ["result_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_orders_sales_record_id_fkey"
            columns: ["sales_record_id"]
            isOneToOne: false
            referencedRelation: "sales_records"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_connections: {
        Row: {
          accepted_at: string
          accepted_request_id: string | null
          created_at: string
          disconnected_at: string | null
          id: string
          updated_at: string
          user_high: string
          user_low: string
        }
        Insert: {
          accepted_at?: string
          accepted_request_id?: string | null
          created_at?: string
          disconnected_at?: string | null
          id?: string
          updated_at?: string
          user_high: string
          user_low: string
        }
        Update: {
          accepted_at?: string
          accepted_request_id?: string | null
          created_at?: string
          disconnected_at?: string | null
          id?: string
          updated_at?: string
          user_high?: string
          user_low?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_connections_accepted_request_id_fkey"
            columns: ["accepted_request_id"]
            isOneToOne: false
            referencedRelation: "contact_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_requests: {
        Row: {
          created_at: string
          id: string
          message: string
          requester_id: string
          status: Database["public"]["Enums"]["contact_request_status"]
          target_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string
          requester_id: string
          status?: Database["public"]["Enums"]["contact_request_status"]
          target_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          requester_id?: string
          status?: Database["public"]["Enums"]["contact_request_status"]
          target_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          alias: string | null
          contact_id: string
          created_at: string
          id: string
          is_blocked: boolean
          is_favorite: boolean
          note: string
          owner_id: string
          source: string
          starred: boolean
          updated_at: string
        }
        Insert: {
          alias?: string | null
          contact_id: string
          created_at?: string
          id?: string
          is_blocked?: boolean
          is_favorite?: boolean
          note?: string
          owner_id: string
          source?: string
          starred?: boolean
          updated_at?: string
        }
        Update: {
          alias?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          is_blocked?: boolean
          is_favorite?: boolean
          note?: string
          owner_id?: string
          source?: string
          starred?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_contact_profile_fk"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_members: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          is_archived: boolean
          is_muted: boolean
          is_pinned: boolean
          last_read_at: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          is_archived?: boolean
          is_muted?: boolean
          is_pinned?: boolean
          last_read_at?: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          is_archived?: boolean
          is_muted?: boolean
          is_pinned?: boolean
          last_read_at?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          assignee_id: string | null
          avatar_color: string
          business_id: string | null
          created_at: string
          created_by: string
          disappearing_hours: number
          id: string
          inbox_status: Database["public"]["Enums"]["inbox_status"]
          last_message_at: string
          title: string | null
          type: Database["public"]["Enums"]["conversation_type"]
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          avatar_color?: string
          business_id?: string | null
          created_at?: string
          created_by: string
          disappearing_hours?: number
          id?: string
          inbox_status?: Database["public"]["Enums"]["inbox_status"]
          last_message_at?: string
          title?: string | null
          type?: Database["public"]["Enums"]["conversation_type"]
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          avatar_color?: string
          business_id?: string | null
          created_at?: string
          created_by?: string
          disappearing_hours?: number
          id?: string
          inbox_status?: Database["public"]["Enums"]["inbox_status"]
          last_message_at?: string
          title?: string | null
          type?: Database["public"]["Enums"]["conversation_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_business_fk"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string
          business_id: string
          created_at: string
          id: string
          name: string
          note: string
          pin: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address?: string
          business_id: string
          created_at?: string
          id?: string
          name: string
          note?: string
          pin?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string
          business_id?: string
          created_at?: string
          id?: string
          name?: string
          note?: string
          pin?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      device_action_rate: {
        Row: {
          action: string
          count: number
          device_id: string
          window_start: string
        }
        Insert: {
          action: string
          count?: number
          device_id: string
          window_start?: string
        }
        Update: {
          action?: string
          count?: number
          device_id?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_action_rate_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          action_token_hash: string | null
          action_token_prefix: string | null
          app_version: string
          created_at: string
          id: string
          last_active_at: string
          name: string
          platform: string
          push_provider: string
          push_token: string | null
          revoked_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          action_token_hash?: string | null
          action_token_prefix?: string | null
          app_version?: string
          created_at?: string
          id?: string
          last_active_at?: string
          name: string
          platform?: string
          push_provider?: string
          push_token?: string | null
          revoked_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          action_token_hash?: string | null
          action_token_prefix?: string | null
          app_version?: string
          created_at?: string
          id?: string
          last_active_at?: string
          name?: string
          platform?: string
          push_provider?: string
          push_token?: string | null
          revoked_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      direct_conversations: {
        Row: {
          conversation_id: string
          created_at: string
          updated_at: string
          user_high: string
          user_low: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          updated_at?: string
          user_high: string
          user_low: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          updated_at?: string
          user_high?: string
          user_low?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_conversations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlements: {
        Row: {
          created_at: string
          expires_at: string | null
          feature: string
          id: string
          source: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          feature: string
          id?: string
          source?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          feature?: string
          id?: string
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      inventory_balances: {
        Row: {
          business_id: string
          product_id: string
          qty_base: number
          updated_at: string
          variant_id: string
        }
        Insert: {
          business_id: string
          product_id: string
          qty_base?: number
          updated_at?: string
          variant_id: string
        }
        Update: {
          business_id?: string
          product_id?: string
          qty_base?: number
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_balances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: true
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          balance_after: number
          balance_before: number
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          note: string
          product_id: string
          qty_base: number
          ref_id: string | null
          ref_type: string
          stock_unit_id: string | null
          variant_id: string
        }
        Insert: {
          balance_after?: number
          balance_before?: number
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          note?: string
          product_id: string
          qty_base: number
          ref_id?: string | null
          ref_type?: string
          stock_unit_id?: string | null
          variant_id: string
        }
        Update: {
          balance_after?: number
          balance_before?: number
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          movement_type?: Database["public"]["Enums"]["inventory_movement_type"]
          note?: string
          product_id?: string
          qty_base?: number
          ref_id?: string | null
          ref_type?: string
          stock_unit_id?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "variant_stock_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_events: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: string
          id: string
          label: string
          ledger_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: string
          id?: string
          label: string
          ledger_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: string
          id?: string
          label?: string
          ledger_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_events_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "ledgers"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          ledger_id: string
          method: string
          note: string
          paid_at: string
          proof_path: string | null
          recorded_by: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          ledger_id: string
          method?: string
          note?: string
          paid_at?: string
          proof_path?: string | null
          recorded_by: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          ledger_id?: string
          method?: string
          note?: string
          paid_at?: string
          proof_path?: string | null
          recorded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_payments_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "ledgers"
            referencedColumns: ["id"]
          },
        ]
      }
      ledgers: {
        Row: {
          amount: number
          conversation_id: string | null
          counterpart_name: string
          counterpart_user_id: string | null
          created_at: string
          due_date: string | null
          id: string
          note: string
          owner_id: string
          paid_amount: number
          reminder: boolean
          sales_record_id: string | null
          status: Database["public"]["Enums"]["ledger_status"]
          type: Database["public"]["Enums"]["ledger_type"]
          updated_at: string
        }
        Insert: {
          amount: number
          conversation_id?: string | null
          counterpart_name: string
          counterpart_user_id?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          note?: string
          owner_id: string
          paid_amount?: number
          reminder?: boolean
          sales_record_id?: string | null
          status?: Database["public"]["Enums"]["ledger_status"]
          type: Database["public"]["Enums"]["ledger_type"]
          updated_at?: string
        }
        Update: {
          amount?: number
          conversation_id?: string | null
          counterpart_name?: string
          counterpart_user_id?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          note?: string
          owner_id?: string
          paid_amount?: number
          reminder?: boolean
          sales_record_id?: string | null
          status?: Database["public"]["Enums"]["ledger_status"]
          type?: Database["public"]["Enums"]["ledger_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledgers_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledgers_sales_record_id_fkey"
            columns: ["sales_record_id"]
            isOneToOne: false
            referencedRelation: "sales_records"
            referencedColumns: ["id"]
          },
        ]
      }
      message_hides: {
        Row: {
          created_at: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_hides_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_receipts: {
        Row: {
          delivered_at: string | null
          message_id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          delivered_at?: string | null
          message_id: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          delivered_at?: string | null
          message_id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_receipts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_mime: string | null
          attachment_name: string | null
          attachment_path: string | null
          attachment_size: number | null
          body: string
          client_id: string | null
          conversation_id: string
          created_at: string
          duration_sec: number | null
          edited_at: string | null
          id: string
          kind: Database["public"]["Enums"]["message_kind"]
          location_accuracy: number | null
          location_label: string | null
          location_lat: number | null
          location_lng: number | null
          location_maps_url: string | null
          payload: Json | null
          reply_to_id: string | null
          sender_id: string
          updated_at: string
        }
        Insert: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          body?: string
          client_id?: string | null
          conversation_id: string
          created_at?: string
          duration_sec?: number | null
          edited_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          location_accuracy?: number | null
          location_label?: string | null
          location_lat?: number | null
          location_lng?: number | null
          location_maps_url?: string | null
          payload?: Json | null
          reply_to_id?: string | null
          sender_id: string
          updated_at?: string
        }
        Update: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          body?: string
          client_id?: string | null
          conversation_id?: string
          created_at?: string
          duration_sec?: number | null
          edited_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          location_accuracy?: number | null
          location_label?: string | null
          location_lat?: number | null
          location_lng?: number | null
          location_maps_url?: string | null
          payload?: Json | null
          reply_to_id?: string | null
          sender_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          data: Json
          id: string
          is_read: boolean
          kind: string
          title: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          data?: Json
          id?: string
          is_read?: boolean
          kind?: string
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          data?: Json
          id?: string
          is_read?: boolean
          kind?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          business_id: string
          created_at: string
          discount: number
          id: string
          name: string
          order_id: string
          photo_ids: string[]
          price: number
          product_id: string | null
          qty: number
          qty_base: number
          qty_num: number
          stock_unit_ids: string[]
          unit: string
          variant_id: string | null
          variant_name: string
        }
        Insert: {
          business_id: string
          created_at?: string
          discount?: number
          id?: string
          name: string
          order_id: string
          photo_ids?: string[]
          price?: number
          product_id?: string | null
          qty?: number
          qty_base?: number
          qty_num?: number
          stock_unit_ids?: string[]
          unit?: string
          variant_id?: string | null
          variant_name?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          discount?: number
          id?: string
          name?: string
          order_id?: string
          photo_ids?: string[]
          price?: number
          product_id?: string | null
          qty?: number
          qty_base?: number
          qty_num?: number
          stock_unit_ids?: string[]
          unit?: string
          variant_id?: string | null
          variant_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          address: string
          business_id: string
          buyer_user_id: string | null
          created_at: string
          customer_id: string | null
          discount: number
          id: string
          note: string
          number: string
          shipping: number
          status: Database["public"]["Enums"]["order_status"]
          total: number
          updated_at: string
        }
        Insert: {
          address?: string
          business_id: string
          buyer_user_id?: string | null
          created_at?: string
          customer_id?: string | null
          discount?: number
          id?: string
          note?: string
          number: string
          shipping?: number
          status?: Database["public"]["Enums"]["order_status"]
          total?: number
          updated_at?: string
        }
        Update: {
          address?: string
          business_id?: string
          buyer_user_id?: string | null
          created_at?: string
          customer_id?: string | null
          discount?: number
          id?: string
          note?: string
          number?: string
          shipping?: number
          status?: Database["public"]["Enums"]["order_status"]
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      pin_search_log: {
        Row: {
          created_at: string
          id: number
          pin: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          pin: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: number
          pin?: string
          user_id?: string
        }
        Relationships: []
      }
      preparation_item_photos: {
        Row: {
          accuracy: number | null
          caption: string
          created_at: string
          id: string
          job_id: string
          job_item_id: string
          lat: number | null
          lng: number | null
          location_label: string
          maps_url: string
          sort_order: number
          storage_path: string
        }
        Insert: {
          accuracy?: number | null
          caption?: string
          created_at?: string
          id?: string
          job_id: string
          job_item_id: string
          lat?: number | null
          lng?: number | null
          location_label?: string
          maps_url?: string
          sort_order?: number
          storage_path: string
        }
        Update: {
          accuracy?: number | null
          caption?: string
          created_at?: string
          id?: string
          job_id?: string
          job_item_id?: string
          lat?: number | null
          lng?: number | null
          location_label?: string
          maps_url?: string
          sort_order?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "preparation_item_photos_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "preparation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preparation_item_photos_job_item_id_fkey"
            columns: ["job_item_id"]
            isOneToOne: false
            referencedRelation: "preparation_job_items"
            referencedColumns: ["id"]
          },
        ]
      }
      preparation_job_items: {
        Row: {
          actual_qty_base: number | null
          chat_order_slot_id: string | null
          created_at: string
          id: string
          job_id: string
          notes: string
          product_id: string
          product_name: string
          requested_qty: number
          requested_qty_base: number
          requested_unit: string
          require_location: boolean
          require_photo: boolean
          sort_order: number
          status: Database["public"]["Enums"]["preparation_item_status"]
          stock_unit_id: string | null
          unit_index: number
          unit_total: number
          updated_at: string
          variant_id: string
          variant_name: string
        }
        Insert: {
          actual_qty_base?: number | null
          chat_order_slot_id?: string | null
          created_at?: string
          id?: string
          job_id: string
          notes?: string
          product_id: string
          product_name?: string
          requested_qty: number
          requested_qty_base: number
          requested_unit?: string
          require_location?: boolean
          require_photo?: boolean
          sort_order?: number
          status?: Database["public"]["Enums"]["preparation_item_status"]
          stock_unit_id?: string | null
          unit_index?: number
          unit_total?: number
          updated_at?: string
          variant_id: string
          variant_name?: string
        }
        Update: {
          actual_qty_base?: number | null
          chat_order_slot_id?: string | null
          created_at?: string
          id?: string
          job_id?: string
          notes?: string
          product_id?: string
          product_name?: string
          requested_qty?: number
          requested_qty_base?: number
          requested_unit?: string
          require_location?: boolean
          require_photo?: boolean
          sort_order?: number
          status?: Database["public"]["Enums"]["preparation_item_status"]
          stock_unit_id?: string | null
          unit_index?: number
          unit_total?: number
          updated_at?: string
          variant_id?: string
          variant_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "preparation_job_items_chat_order_slot_id_fkey"
            columns: ["chat_order_slot_id"]
            isOneToOne: false
            referencedRelation: "chat_order_unit_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preparation_job_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "preparation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preparation_job_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preparation_job_items_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "variant_stock_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preparation_job_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      preparation_jobs: {
        Row: {
          assigned_user_id: string
          business_id: string
          chat_order_id: string | null
          code: string
          completed_at: string | null
          conversation_id: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          customer_name: string
          customer_user_id: string | null
          delivered_at: string | null
          delivered_message_id: string | null
          delivered_pin: string | null
          expires_at: string
          id: string
          notes: string
          opened_at: string | null
          order_id: string | null
          revoked_at: string | null
          status: Database["public"]["Enums"]["preparation_status"]
          token_hash: string
          token_prefix: string
          updated_at: string
        }
        Insert: {
          assigned_user_id: string
          business_id: string
          chat_order_id?: string | null
          code: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          customer_name?: string
          customer_user_id?: string | null
          delivered_at?: string | null
          delivered_message_id?: string | null
          delivered_pin?: string | null
          expires_at?: string
          id?: string
          notes?: string
          opened_at?: string | null
          order_id?: string | null
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["preparation_status"]
          token_hash: string
          token_prefix?: string
          updated_at?: string
        }
        Update: {
          assigned_user_id?: string
          business_id?: string
          chat_order_id?: string | null
          code?: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          customer_name?: string
          customer_user_id?: string | null
          delivered_at?: string | null
          delivered_message_id?: string | null
          delivered_pin?: string | null
          expires_at?: string
          id?: string
          notes?: string
          opened_at?: string | null
          order_id?: string | null
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["preparation_status"]
          token_hash?: string
          token_prefix?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "preparation_jobs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preparation_jobs_chat_order_id_fkey"
            columns: ["chat_order_id"]
            isOneToOne: false
            referencedRelation: "chat_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preparation_jobs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preparation_jobs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preparation_jobs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      product_photos: {
        Row: {
          business_id: string
          caption: string
          created_at: string
          created_by: string | null
          group_label: string
          id: string
          image_path: string
          image_url: string | null
          is_primary: boolean
          location_accuracy: number | null
          location_label: string
          location_lat: number | null
          location_lng: number | null
          location_mode: string
          location_url: string
          media_version: number
          needs_variant_confirmation: boolean
          preparation_job_id: string | null
          preparation_job_item_id: string | null
          product_id: string
          sort_order: number
          source_photo_id: string | null
          source_type: string
          stock_unit_id: string | null
          thumbnail_path: string | null
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          business_id: string
          caption?: string
          created_at?: string
          created_by?: string | null
          group_label?: string
          id?: string
          image_path: string
          image_url?: string | null
          is_primary?: boolean
          location_accuracy?: number | null
          location_label?: string
          location_lat?: number | null
          location_lng?: number | null
          location_mode?: string
          location_url?: string
          media_version?: number
          needs_variant_confirmation?: boolean
          preparation_job_id?: string | null
          preparation_job_item_id?: string | null
          product_id: string
          sort_order?: number
          source_photo_id?: string | null
          source_type?: string
          stock_unit_id?: string | null
          thumbnail_path?: string | null
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          business_id?: string
          caption?: string
          created_at?: string
          created_by?: string | null
          group_label?: string
          id?: string
          image_path?: string
          image_url?: string | null
          is_primary?: boolean
          location_accuracy?: number | null
          location_label?: string
          location_lat?: number | null
          location_lng?: number | null
          location_mode?: string
          location_url?: string
          media_version?: number
          needs_variant_confirmation?: boolean
          preparation_job_id?: string | null
          preparation_job_item_id?: string | null
          product_id?: string
          sort_order?: number
          source_photo_id?: string | null
          source_type?: string
          stock_unit_id?: string | null
          thumbnail_path?: string | null
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_photos_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_photos_preparation_job_id_fkey"
            columns: ["preparation_job_id"]
            isOneToOne: false
            referencedRelation: "preparation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_photos_preparation_job_item_id_fkey"
            columns: ["preparation_job_item_id"]
            isOneToOne: false
            referencedRelation: "preparation_job_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_photos_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_photos_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "variant_stock_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_photos_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          allow_decimal: boolean
          base_quantity_grams: number | null
          base_unit: string
          business_id: string
          conversion_factor: number
          created_at: string
          display_unit: string
          id: string
          is_active: boolean
          name: string
          needs_review: boolean
          precision_scale: number
          price: number
          product_id: string
          sku: string
          sort_order: number
          stock_type: Database["public"]["Enums"]["stock_type"]
          units_per_display: number | null
          updated_at: string
        }
        Insert: {
          allow_decimal?: boolean
          base_quantity_grams?: number | null
          base_unit?: string
          business_id: string
          conversion_factor?: number
          created_at?: string
          display_unit?: string
          id?: string
          is_active?: boolean
          name: string
          needs_review?: boolean
          precision_scale?: number
          price?: number
          product_id: string
          sku?: string
          sort_order?: number
          stock_type?: Database["public"]["Enums"]["stock_type"]
          units_per_display?: number | null
          updated_at?: string
        }
        Update: {
          allow_decimal?: boolean
          base_quantity_grams?: number | null
          base_unit?: string
          business_id?: string
          conversion_factor?: number
          created_at?: string
          display_unit?: string
          id?: string
          is_active?: boolean
          name?: string
          needs_review?: boolean
          precision_scale?: number
          price?: number
          product_id?: string
          sku?: string
          sort_order?: number
          stock_type?: Database["public"]["Enums"]["stock_type"]
          units_per_display?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          business_id: string
          category: string
          created_at: string
          description: string
          discount_percent: number
          emoji: string
          id: string
          is_active: boolean
          name: string
          price: number
          sku: string
          stock: number
          updated_at: string
          variants: Json
        }
        Insert: {
          business_id: string
          category?: string
          created_at?: string
          description?: string
          discount_percent?: number
          emoji?: string
          id?: string
          is_active?: boolean
          name: string
          price?: number
          sku?: string
          stock?: number
          updated_at?: string
          variants?: Json
        }
        Update: {
          business_id?: string
          category?: string
          created_at?: string
          description?: string
          discount_percent?: number
          emoji?: string
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          sku?: string
          stock?: number
          updated_at?: string
          variants?: Json
        }
        Relationships: [
          {
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_color: string
          avatar_privacy: string
          avatar_url: string | null
          avatar_version: number
          bio: string
          created_at: string
          display_name: string
          id: string
          is_online: boolean
          last_seen_at: string
          pin: string
          updated_at: string
        }
        Insert: {
          avatar_color?: string
          avatar_privacy?: string
          avatar_url?: string | null
          avatar_version?: number
          bio?: string
          created_at?: string
          display_name?: string
          id: string
          is_online?: boolean
          last_seen_at?: string
          pin: string
          updated_at?: string
        }
        Update: {
          avatar_color?: string
          avatar_privacy?: string
          avatar_url?: string | null
          avatar_version?: number
          bio?: string
          created_at?: string
          display_name?: string
          id?: string
          is_online?: boolean
          last_seen_at?: string
          pin?: string
          updated_at?: string
        }
        Relationships: []
      }
      quick_replies: {
        Row: {
          body: string
          business_id: string
          created_at: string
          id: string
          shortcut: string
          updated_at: string
        }
        Insert: {
          body: string
          business_id: string
          created_at?: string
          id?: string
          shortcut: string
          updated_at?: string
        }
        Update: {
          body?: string
          business_id?: string
          created_at?: string
          id?: string
          shortcut?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_replies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_records: {
        Row: {
          business_id: string
          conversation_id: string | null
          created_at: string
          customer_id: string | null
          customer_user_id: string | null
          discount: number
          due_date: string | null
          extra_fee: number
          id: string
          idempotency_key: string
          message_id: string | null
          note: string
          order_id: string | null
          paid_amount: number
          payload: Json
          payment_method: Database["public"]["Enums"]["payment_method"]
          seller_id: string
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          business_id: string
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_user_id?: string | null
          discount?: number
          due_date?: string | null
          extra_fee?: number
          id?: string
          idempotency_key: string
          message_id?: string | null
          note?: string
          order_id?: string | null
          paid_amount?: number
          payload?: Json
          payment_method?: Database["public"]["Enums"]["payment_method"]
          seller_id: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          business_id?: string
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_user_id?: string | null
          discount?: number
          due_date?: string | null
          extra_fee?: number
          id?: string
          idempotency_key?: string
          message_id?: string | null
          note?: string
          order_id?: string | null
          paid_amount?: number
          payload?: Json
          payment_method?: Database["public"]["Enums"]["payment_method"]
          seller_id?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_records_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_records_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_records_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_records_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_records_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      status_audience: {
        Row: {
          status_id: string
          user_id: string
        }
        Insert: {
          status_id: string
          user_id: string
        }
        Update: {
          status_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_audience_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      status_items: {
        Row: {
          caption: string
          created_at: string
          duration_ms: number
          height: number
          id: string
          kind: Database["public"]["Enums"]["status_item_kind"]
          media_path: string | null
          owner_id: string
          sort_order: number
          status_id: string
          text_meta: Json
          thumb_path: string | null
          width: number
        }
        Insert: {
          caption?: string
          created_at?: string
          duration_ms?: number
          height?: number
          id?: string
          kind?: Database["public"]["Enums"]["status_item_kind"]
          media_path?: string | null
          owner_id: string
          sort_order?: number
          status_id: string
          text_meta?: Json
          thumb_path?: string | null
          width?: number
        }
        Update: {
          caption?: string
          created_at?: string
          duration_ms?: number
          height?: number
          id?: string
          kind?: Database["public"]["Enums"]["status_item_kind"]
          media_path?: string | null
          owner_id?: string
          sort_order?: number
          status_id?: string
          text_meta?: Json
          thumb_path?: string | null
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "status_items_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      status_mutes: {
        Row: {
          created_at: string
          muted_user_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          muted_user_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          muted_user_id?: string
          user_id?: string
        }
        Relationships: []
      }
      status_preferences: {
        Row: {
          created_at: string
          default_lifetime_minutes: number
          default_privacy: Database["public"]["Enums"]["status_privacy"]
          default_slide_ms: number
          share_view_receipts: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_lifetime_minutes?: number
          default_privacy?: Database["public"]["Enums"]["status_privacy"]
          default_slide_ms?: number
          share_view_receipts?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_lifetime_minutes?: number
          default_privacy?: Database["public"]["Enums"]["status_privacy"]
          default_slide_ms?: number
          share_view_receipts?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      status_reactions: {
        Row: {
          created_at: string
          emoji: string
          item_id: string
          status_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          item_id: string
          status_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          item_id?: string
          status_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_reactions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "status_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "status_reactions_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      status_views: {
        Row: {
          item_id: string
          status_id: string
          viewed_at: string
          viewer_id: string
        }
        Insert: {
          item_id: string
          status_id: string
          viewed_at?: string
          viewer_id: string
        }
        Update: {
          item_id?: string
          status_id?: string
          viewed_at?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_views_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "status_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "status_views_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      statuses: {
        Row: {
          caption: string
          created_at: string
          deleted_at: string | null
          expires_at: string
          id: string
          owner_id: string
          privacy: Database["public"]["Enums"]["status_privacy"]
          updated_at: string
        }
        Insert: {
          caption?: string
          created_at?: string
          deleted_at?: string | null
          expires_at: string
          id?: string
          owner_id: string
          privacy?: Database["public"]["Enums"]["status_privacy"]
          updated_at?: string
        }
        Update: {
          caption?: string
          created_at?: string
          deleted_at?: string | null
          expires_at?: string
          id?: string
          owner_id?: string
          privacy?: Database["public"]["Enums"]["status_privacy"]
          updated_at?: string
        }
        Relationships: []
      }
      stickers: {
        Row: {
          created_at: string
          emoji: string
          id: string
          owner_id: string
          path: string
        }
        Insert: {
          created_at?: string
          emoji?: string
          id?: string
          owner_id: string
          path: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          owner_id?: string
          path?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          notifications: Json
          privacy: Json
          security: Json
          theme: string
          updated_at: string
          user_id: string
          voice: Json
        }
        Insert: {
          created_at?: string
          notifications?: Json
          privacy?: Json
          security?: Json
          theme?: string
          updated_at?: string
          user_id: string
          voice?: Json
        }
        Update: {
          created_at?: string
          notifications?: Json
          privacy?: Json
          security?: Json
          theme?: string
          updated_at?: string
          user_id?: string
          voice?: Json
        }
        Relationships: []
      }
      variant_stock_units: {
        Row: {
          business_id: string
          chat_order_id: string | null
          chat_order_item_id: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_user_id: string | null
          delivered_at: string | null
          id: string
          note: string
          order_id: string | null
          order_item_id: string | null
          preparation_job_id: string | null
          preparation_job_item_id: string | null
          product_id: string
          qty_base: number
          ready_at: string | null
          released_at: string | null
          reserved_at: string | null
          source_type: Database["public"]["Enums"]["stock_unit_source"]
          status: Database["public"]["Enums"]["stock_unit_status"]
          unit_label: string
          unit_seq: number
          unit_slot_id: string | null
          updated_at: string
          updated_by: string | null
          variant_id: string
          version: number
        }
        Insert: {
          business_id: string
          chat_order_id?: string | null
          chat_order_item_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_user_id?: string | null
          delivered_at?: string | null
          id?: string
          note?: string
          order_id?: string | null
          order_item_id?: string | null
          preparation_job_id?: string | null
          preparation_job_item_id?: string | null
          product_id: string
          qty_base?: number
          ready_at?: string | null
          released_at?: string | null
          reserved_at?: string | null
          source_type?: Database["public"]["Enums"]["stock_unit_source"]
          status?: Database["public"]["Enums"]["stock_unit_status"]
          unit_label?: string
          unit_seq?: number
          unit_slot_id?: string | null
          updated_at?: string
          updated_by?: string | null
          variant_id: string
          version?: number
        }
        Update: {
          business_id?: string
          chat_order_id?: string | null
          chat_order_item_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_user_id?: string | null
          delivered_at?: string | null
          id?: string
          note?: string
          order_id?: string | null
          order_item_id?: string | null
          preparation_job_id?: string | null
          preparation_job_item_id?: string | null
          product_id?: string
          qty_base?: number
          ready_at?: string | null
          released_at?: string | null
          reserved_at?: string | null
          source_type?: Database["public"]["Enums"]["stock_unit_source"]
          status?: Database["public"]["Enums"]["stock_unit_status"]
          unit_label?: string
          unit_seq?: number
          unit_slot_id?: string | null
          updated_at?: string
          updated_by?: string | null
          variant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "variant_stock_units_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_stock_units_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_stock_units_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_stock_units_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_stock_units_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_stock_units_preparation_job_id_fkey"
            columns: ["preparation_job_id"]
            isOneToOne: false
            referencedRelation: "preparation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_stock_units_preparation_job_item_id_fkey"
            columns: ["preparation_job_item_id"]
            isOneToOne: false
            referencedRelation: "preparation_job_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_stock_units_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_stock_units_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vsu_order_fk"
            columns: ["chat_order_id"]
            isOneToOne: false
            referencedRelation: "chat_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vsu_order_item_fk"
            columns: ["chat_order_item_id"]
            isOneToOne: false
            referencedRelation: "chat_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vsu_slot_fk"
            columns: ["unit_slot_id"]
            isOneToOne: false
            referencedRelation: "chat_order_unit_slots"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_stock_unit: {
        Args: { _unit: string }
        Returns: {
          business_id: string
          chat_order_id: string | null
          chat_order_item_id: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_user_id: string | null
          delivered_at: string | null
          id: string
          note: string
          order_id: string | null
          order_item_id: string | null
          preparation_job_id: string | null
          preparation_job_item_id: string | null
          product_id: string
          qty_base: number
          ready_at: string | null
          released_at: string | null
          reserved_at: string | null
          source_type: Database["public"]["Enums"]["stock_unit_source"]
          status: Database["public"]["Enums"]["stock_unit_status"]
          unit_label: string
          unit_seq: number
          unit_slot_id: string | null
          updated_at: string
          updated_by: string | null
          variant_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "variant_stock_units"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_group_members: {
        Args: { _conversation: string; _member_ids: string[] }
        Returns: number
      }
      adjust_inventory: {
        Args: {
          _note?: string
          _qty_base: number
          _type?: Database["public"]["Enums"]["inventory_movement_type"]
          _variant: string
        }
        Returns: number
      }
      answer_call: {
        Args: { _call: string }
        Returns: {
          answered_at: string | null
          conversation_id: string | null
          created_at: string
          duration_sec: number
          end_reason: string | null
          ended_at: string | null
          id: string
          initiator_id: string
          kind: Database["public"]["Enums"]["call_kind"]
          max_participants: number
          provider: string
          room_name: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["call_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "calls"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_unit_balance: {
        Args: {
          _delta: number
          _kind: string
          _note: string
          _ref_key: string
          _unit: Database["public"]["Tables"]["variant_stock_units"]["Row"]
        }
        Returns: undefined
      }
      approve_chat_order: {
        Args: { _order: string }
        Returns: {
          approved_at: string | null
          business_id: string
          buyer_user_id: string | null
          cancelled_at: string | null
          confirmed_at: string | null
          conversation_id: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string
          delivered_at: string | null
          discount: number
          dispatched_at: string | null
          extra_fee: number
          id: string
          idempotency_key: string
          ledger_id: string | null
          note: string
          order_id: string | null
          preparation_job_id: string | null
          ready_at: string | null
          request_message_id: string | null
          result_message_id: string | null
          sales_record_id: string | null
          seller_id: string | null
          seller_note: string
          status: Database["public"]["Enums"]["chat_order_status"]
          subtotal: number
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      are_connected: { Args: { _a: string; _b: string }; Returns: boolean }
      assert_group_manager: {
        Args: { _conversation: string; _owner_only: boolean; _uid: string }
        Returns: string
      }
      bg_mark_delivered: {
        Args: { _conv: string; _message?: string; _token: string }
        Returns: Json
      }
      bg_mark_read: {
        Args: { _conv: string; _idempotency_key?: string; _token: string }
        Returns: Json
      }
      bg_rate_ok: {
        Args: { _action: string; _dev: string; _limit: number }
        Returns: boolean
      }
      bg_reply_message: {
        Args: {
          _body: string
          _conv: string
          _idempotency_key: string
          _token: string
        }
        Returns: Json
      }
      blocked_between: {
        Args: { _other: string }
        Returns: {
          blocked_me: boolean
          i_blocked: boolean
        }[]
      }
      business_role_of: {
        Args: { _biz: string; _uid: string }
        Returns: Database["public"]["Enums"]["business_role"]
      }
      business_staff_directory: {
        Args: { _business: string }
        Returns: {
          avatar_color: string
          display_name: string
          pin_confirmed_at: string
          role: Database["public"]["Enums"]["business_role"]
          staff_pin: string
          user_id: string
        }[]
      }
      can_manage_business: {
        Args: { _biz: string; _uid: string }
        Returns: boolean
      }
      can_read_avatar_object: { Args: { _name: string }; Returns: boolean }
      can_read_status_object: { Args: { _name: string }; Returns: boolean }
      can_see_ledger: {
        Args: { _ledger: string; _uid: string }
        Returns: boolean
      }
      can_see_prep_job: {
        Args: { _job: string; _uid: string }
        Returns: boolean
      }
      can_sell_business: {
        Args: { _biz: string; _uid: string }
        Returns: boolean
      }
      can_use_conversation: {
        Args: { _conversation: string; _user: string }
        Returns: boolean
      }
      can_view_avatar: {
        Args: { _owner: string; _viewer: string }
        Returns: boolean
      }
      can_view_full_profile: { Args: { _owner: string }; Returns: boolean }
      can_view_status: {
        Args: { _status: string; _uid: string }
        Returns: boolean
      }
      cancel_chat_order: {
        Args: { _order: string; _reason?: string; _void_ready?: boolean }
        Returns: {
          approved_at: string | null
          business_id: string
          buyer_user_id: string | null
          cancelled_at: string | null
          confirmed_at: string | null
          conversation_id: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string
          delivered_at: string | null
          discount: number
          dispatched_at: string | null
          extra_fee: number
          id: string
          idempotency_key: string
          ledger_id: string | null
          note: string
          order_id: string | null
          preparation_job_id: string | null
          ready_at: string | null
          request_message_id: string | null
          result_message_id: string | null
          sales_record_id: string | null
          seller_id: string | null
          seller_note: string
          status: Database["public"]["Enums"]["chat_order_status"]
          subtotal: number
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_contact_request: { Args: { _target: string }; Returns: Json }
      chat_order_actor_can_manage: {
        Args: { _order: string; _uid: string }
        Returns: boolean
      }
      chat_order_actor_can_read: {
        Args: { _order: string; _uid: string }
        Returns: boolean
      }
      commit_my_avatar: { Args: { _path: string }; Returns: Json }
      complete_preparation_job: { Args: { _job: string }; Returns: Json }
      confirm_chat_order: {
        Args: {
          _discount?: number
          _extra?: number
          _items?: Json
          _note?: string
          _order: string
        }
        Returns: {
          approved_at: string | null
          business_id: string
          buyer_user_id: string | null
          cancelled_at: string | null
          confirmed_at: string | null
          conversation_id: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string
          delivered_at: string | null
          discount: number
          dispatched_at: string | null
          extra_fee: number
          id: string
          idempotency_key: string
          ledger_id: string | null
          note: string
          order_id: string | null
          preparation_job_id: string | null
          ready_at: string | null
          request_message_id: string | null
          result_message_id: string | null
          sales_record_id: string | null
          seller_id: string | null
          seller_note: string
          status: Database["public"]["Enums"]["chat_order_status"]
          subtotal: number
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_staff_pin: {
        Args: {
          _business: string
          _label?: string
          _pin: string
          _role?: Database["public"]["Enums"]["business_role"]
        }
        Returns: Json
      }
      contact_relation: { Args: { _other: string }; Returns: Json }
      conv_role_of: {
        Args: { _conversation: string; _user: string }
        Returns: string
      }
      conversation_capability: {
        Args: { _conversation: string; _user: string }
        Returns: {
          callable: boolean
          manageable: boolean
          readable: boolean
          reason: string
          role: string
          sendable: boolean
        }[]
      }
      conversation_overview: {
        Args: never
        Returns: {
          callable: boolean
          conversation_id: string
          last_attachment_name: string
          last_location_lat: number
          last_message_at: string
          last_message_body: string
          last_message_id: string
          last_message_kind: Database["public"]["Enums"]["message_kind"]
          last_message_sender: string
          last_read_at: string
          manageable: boolean
          readable: boolean
          reason: string
          role: string
          sendable: boolean
          unread_count: number
        }[]
      }
      convert_to_base: {
        Args: { _qty: number; _unit: string; _variant: string }
        Returns: number
      }
      create_call_tx: {
        Args: {
          _conversation: string
          _kind: Database["public"]["Enums"]["call_kind"]
          _max_participants?: number
        }
        Returns: {
          answered_at: string | null
          conversation_id: string | null
          created_at: string
          duration_sec: number
          end_reason: string | null
          ended_at: string | null
          id: string
          initiator_id: string
          kind: Database["public"]["Enums"]["call_kind"]
          max_participants: number
          provider: string
          room_name: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["call_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "calls"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_chat_order: { Args: { _payload: Json }; Returns: string }
      create_group: {
        Args: { _member_ids: string[]; _title: string }
        Returns: string
      }
      create_preparation_job: {
        Args: {
          _assigned: string
          _business: string
          _conversation?: string
          _customer?: string
          _customer_name?: string
          _customer_user?: string
          _expires_hours?: number
          _items: Json
          _notes?: string
          _order?: string
        }
        Returns: Json
      }
      create_sale_tx: { Args: { _payload: Json }; Returns: Json }
      create_stock_unit: {
        Args: {
          _label?: string
          _note?: string
          _qty_base: number
          _variant: string
        }
        Returns: {
          business_id: string
          chat_order_id: string | null
          chat_order_item_id: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_user_id: string | null
          delivered_at: string | null
          id: string
          note: string
          order_id: string | null
          order_item_id: string | null
          preparation_job_id: string | null
          preparation_job_item_id: string | null
          product_id: string
          qty_base: number
          ready_at: string | null
          released_at: string | null
          reserved_at: string | null
          source_type: Database["public"]["Enums"]["stock_unit_source"]
          status: Database["public"]["Enums"]["stock_unit_status"]
          unit_label: string
          unit_seq: number
          unit_slot_id: string | null
          updated_at: string
          updated_by: string | null
          variant_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "variant_stock_units"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_user_business_role: {
        Args: { _business: string }
        Returns: Database["public"]["Enums"]["business_role"]
      }
      current_user_can_call_conversation: {
        Args: { _conversation: string }
        Returns: boolean
      }
      current_user_can_manage_business: {
        Args: { _business: string }
        Returns: boolean
      }
      current_user_can_manage_chat_order: {
        Args: { _order: string }
        Returns: boolean
      }
      current_user_can_manage_conversation: {
        Args: { _conversation: string }
        Returns: boolean
      }
      current_user_can_read_chat_order: {
        Args: { _order: string }
        Returns: boolean
      }
      current_user_can_read_conversation: {
        Args: { _conversation: string }
        Returns: boolean
      }
      current_user_can_read_stock_unit: {
        Args: { _unit: string }
        Returns: boolean
      }
      current_user_can_sell_business: {
        Args: { _business: string }
        Returns: boolean
      }
      current_user_can_send_conversation: {
        Args: { _conversation: string }
        Returns: boolean
      }
      current_user_is_business_member: {
        Args: { _business: string }
        Returns: boolean
      }
      current_user_is_call_participant: {
        Args: { _call: string }
        Returns: boolean
      }
      current_user_is_conv_member: {
        Args: { _conversation: string }
        Returns: boolean
      }
      customer_pin: { Args: { _customer: string }; Returns: string }
      decline_call: {
        Args: { _call: string }
        Returns: {
          answered_at: string | null
          conversation_id: string | null
          created_at: string
          duration_sec: number
          end_reason: string | null
          ended_at: string | null
          id: string
          initiator_id: string
          kind: Database["public"]["Enums"]["call_kind"]
          max_participants: number
          provider: string
          room_name: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["call_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "calls"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      deliver_preparation_job: {
        Args: { _job: string; _link: string }
        Returns: Json
      }
      device_from_action_token: {
        Args: { _token: string }
        Returns: {
          device_id: string
          user_id: string
        }[]
      }
      disconnect_contact: { Args: { _target: string }; Returns: Json }
      dispatch_chat_order: {
        Args: {
          _assigned: string
          _expires_hours?: number
          _order: string
          _slots: Json
        }
        Returns: Json
      }
      end_call: {
        Args: {
          _call: string
          _duration?: number
          _reason?: string
          _status: Database["public"]["Enums"]["call_status"]
        }
        Returns: {
          answered_at: string | null
          conversation_id: string | null
          created_at: string
          duration_sec: number
          end_reason: string | null
          ended_at: string | null
          id: string
          initiator_id: string
          kind: Database["public"]["Enums"]["call_kind"]
          max_participants: number
          provider: string
          room_name: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["call_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "calls"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      expire_stale_calls: { Args: never; Returns: number }
      finalize_chat_order_delivery: {
        Args: { _order: string; _payment: Json }
        Returns: Json
      }
      gen_mcm_pin: { Args: never; Returns: string }
      get_or_create_business_conversation: {
        Args: { _business: string; _customer: string }
        Returns: string
      }
      get_or_create_direct: { Args: { _other: string }; Returns: string }
      has_entitlement: {
        Args: { _feature: string; _user_id: string }
        Returns: boolean
      }
      i_am_connected_to: { Args: { _other: string }; Returns: boolean }
      is_business_member: {
        Args: { _biz: string; _uid: string }
        Returns: boolean
      }
      is_call_participant: {
        Args: { _call: string; _uid: string }
        Returns: boolean
      }
      is_conv_admin: { Args: { _conv: string; _uid: string }; Returns: boolean }
      is_conv_member: {
        Args: { _conv: string; _uid: string }
        Returns: boolean
      }
      join_call: {
        Args: { _call: string }
        Returns: {
          answered_at: string | null
          conversation_id: string | null
          created_at: string
          duration_sec: number
          end_reason: string | null
          ended_at: string | null
          id: string
          initiator_id: string
          kind: Database["public"]["Enums"]["call_kind"]
          max_participants: number
          provider: string
          room_name: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["call_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "calls"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_call: {
        Args: { _call: string; _duration?: number }
        Returns: {
          answered_at: string | null
          conversation_id: string | null
          created_at: string
          duration_sec: number
          end_reason: string | null
          ended_at: string | null
          id: string
          initiator_id: string
          kind: Database["public"]["Enums"]["call_kind"]
          max_participants: number
          provider: string
          room_name: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["call_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "calls"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_conversation: { Args: { _conversation: string }; Returns: boolean }
      lock_contact_pair: {
        Args: { _a: string; _b: string }
        Returns: undefined
      }
      lock_conversation_pair: {
        Args: { _a: string; _b: string }
        Returns: undefined
      }
      mark_conversation_read: {
        Args: { _conversation: string; _through_message_id?: string }
        Returns: string
      }
      mark_messages_delivered: { Args: { _conv: string }; Returns: number }
      mark_messages_read: { Args: { _conv: string }; Returns: number }
      my_connected_contacts: {
        Args: never
        Returns: {
          contact_id: string
        }[]
      }
      my_conversation_capability: {
        Args: { _conversation: string }
        Returns: {
          callable: boolean
          manageable: boolean
          readable: boolean
          reason: string
          role: string
          sendable: boolean
        }[]
      }
      my_pin: { Args: never; Returns: string }
      my_profile: {
        Args: never
        Returns: {
          avatar_color: string
          avatar_privacy: string
          avatar_url: string | null
          avatar_version: number
          bio: string
          created_at: string
          display_name: string
          id: string
          is_online: boolean
          last_seen_at: string
          pin: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pair_blocked: { Args: { _a: string; _b: string }; Returns: boolean }
      pins_for_me: {
        Args: { _ids: string[] }
        Returns: {
          id: string
          pin: string
        }[]
      }
      prep_job_id_by_token: { Args: { _token: string }; Returns: string }
      profile_cards: {
        Args: { _ids: string[] }
        Returns: {
          avatar_color: string
          avatar_url: string
          avatar_version: number
          display_name: string
          id: string
        }[]
      }
      profile_full: {
        Args: { _id: string }
        Returns: {
          avatar_color: string
          avatar_privacy: string
          avatar_url: string
          avatar_version: number
          bio: string
          display_name: string
          id: string
          is_online: boolean
          last_seen_at: string
          pin: string
        }[]
      }
      push_targets_for_conversation: {
        Args: { _conv: string; _sender: string }
        Returns: {
          allow_preview: boolean
          device_id: string
          muted: boolean
          platform: string
          push_token: string
          sound: boolean
          user_id: string
          vibrate: boolean
        }[]
      }
      push_targets_for_user: {
        Args: { _category: string; _user: string }
        Returns: {
          allow_preview: boolean
          device_id: string
          platform: string
          push_token: string
          sound: boolean
          vibrate: boolean
        }[]
      }
      record_ledger_payment: {
        Args: {
          _amount: number
          _ledger: string
          _method: string
          _note: string
        }
        Returns: {
          amount: number
          conversation_id: string | null
          counterpart_name: string
          counterpart_user_id: string | null
          created_at: string
          due_date: string | null
          id: string
          note: string
          owner_id: string
          paid_amount: number
          reminder: boolean
          sales_record_id: string | null
          status: Database["public"]["Enums"]["ledger_status"]
          type: Database["public"]["Enums"]["ledger_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ledgers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      register_push_device: {
        Args: {
          _app_version?: string
          _name: string
          _platform: string
          _push_token: string
        }
        Returns: Json
      }
      remove_group_member: {
        Args: { _conversation: string; _target: string }
        Returns: boolean
      }
      remove_my_avatar: { Args: never; Returns: Json }
      remove_saved_contact: { Args: { _target: string }; Returns: Json }
      request_chat_order_changes: {
        Args: { _note?: string; _order: string }
        Returns: {
          approved_at: string | null
          business_id: string
          buyer_user_id: string | null
          cancelled_at: string | null
          confirmed_at: string | null
          conversation_id: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string
          delivered_at: string | null
          discount: number
          dispatched_at: string | null
          extra_fee: number
          id: string
          idempotency_key: string
          ledger_id: string | null
          note: string
          order_id: string | null
          preparation_job_id: string | null
          ready_at: string | null
          request_message_id: string | null
          result_message_id: string | null
          sales_record_id: string | null
          seller_id: string | null
          seller_note: string
          status: Database["public"]["Enums"]["chat_order_status"]
          subtotal: number
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      respond_contact_request: {
        Args: {
          _action: Database["public"]["Enums"]["contact_request_status"]
          _request: string
        }
        Returns: {
          created_at: string
          id: string
          message: string
          requester_id: string
          status: Database["public"]["Enums"]["contact_request_status"]
          target_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "contact_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_my_push_devices: {
        Args: { _push_token?: string }
        Returns: number
      }
      revoke_push_device: { Args: { _device: string }; Returns: boolean }
      rotate_preparation_token: {
        Args: { _expires_hours?: number; _job: string }
        Returns: Json
      }
      safe_uuid: { Args: { _t: string }; Returns: string }
      save_contact_card: {
        Args: { _alias?: string; _source?: string; _target: string }
        Returns: Json
      }
      search_profile_by_pin: { Args: { _pin: string }; Returns: Json }
      send_contact_request: {
        Args: { _message?: string; _target: string }
        Returns: Json
      }
      set_avatar_privacy_audience: {
        Args: {
          _confirm_empty_only_share?: boolean
          _privacy: string
          _targets?: string[]
        }
        Returns: Json
      }
      set_contact_blocked: {
        Args: { _blocked: boolean; _target: string }
        Returns: Json
      }
      set_conversation_assignee: {
        Args: { _assignee: string; _conversation: string }
        Returns: boolean
      }
      set_conversation_inbox_status: {
        Args: {
          _conversation: string
          _status: Database["public"]["Enums"]["inbox_status"]
        }
        Returns: boolean
      }
      set_group_member_role: {
        Args: { _conversation: string; _role: string; _target: string }
        Returns: boolean
      }
      set_my_avatar_privacy: { Args: { _privacy: string }; Returns: undefined }
      set_my_presence: { Args: { _online: boolean }; Returns: undefined }
      status_feed: {
        Args: never
        Returns: {
          caption: string
          created_at: string
          expires_at: string
          item_count: number
          last_item_at: string
          muted: boolean
          owner_id: string
          privacy: Database["public"]["Enums"]["status_privacy"]
          status_id: string
          unseen_count: number
        }[]
      }
      status_owner_of: { Args: { _status: string }; Returns: string }
      transfer_group_ownership: {
        Args: { _conversation: string; _target: string }
        Returns: boolean
      }
      update_group_settings: {
        Args: {
          _avatar_color?: string
          _conversation: string
          _disappearing_hours?: number
          _title?: string
        }
        Returns: boolean
      }
      update_my_contact: {
        Args: {
          _alias?: string
          _is_favorite?: boolean
          _note?: string
          _starred?: boolean
          _target: string
        }
        Returns: Json
      }
      update_my_conversation_preferences: {
        Args: {
          _archived?: boolean
          _conversation: string
          _muted?: boolean
          _pinned?: boolean
        }
        Returns: boolean
      }
      update_my_profile: {
        Args: { _bio: string; _display_name: string }
        Returns: {
          avatar_color: string
          avatar_privacy: string
          avatar_url: string | null
          avatar_version: number
          bio: string
          created_at: string
          display_name: string
          id: string
          is_online: boolean
          last_seen_at: string
          pin: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_stock_unit: {
        Args: { _reason?: string; _unit: string }
        Returns: {
          business_id: string
          chat_order_id: string | null
          chat_order_item_id: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_user_id: string | null
          delivered_at: string | null
          id: string
          note: string
          order_id: string | null
          order_item_id: string | null
          preparation_job_id: string | null
          preparation_job_item_id: string | null
          product_id: string
          qty_base: number
          ready_at: string | null
          released_at: string | null
          reserved_at: string | null
          source_type: Database["public"]["Enums"]["stock_unit_source"]
          status: Database["public"]["Enums"]["stock_unit_status"]
          unit_label: string
          unit_seq: number
          unit_slot_id: string | null
          updated_at: string
          updated_by: string | null
          variant_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "variant_stock_units"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      business_role: "owner" | "admin" | "agent" | "cashier" | "viewer"
      call_kind: "audio" | "video"
      call_status:
        | "ringing"
        | "ongoing"
        | "ended"
        | "missed"
        | "declined"
        | "failed"
        | "unconfigured"
      chat_order_status:
        | "buyer_requested"
        | "seller_confirmed"
        | "changes_requested"
        | "buyer_approved"
        | "dispatched_to_preparation"
        | "preparing"
        | "ready_for_payment"
        | "delivered"
        | "cancelled"
      contact_request_status:
        | "pending"
        | "accepted"
        | "rejected"
        | "blocked"
        | "cancelled"
      conversation_type: "direct" | "group" | "business"
      inbox_status: "open" | "pending" | "closed"
      inventory_movement_type:
        | "preparation"
        | "sale"
        | "adjustment"
        | "restock"
        | "return"
      ledger_status:
        | "pending_approval"
        | "active"
        | "partially_paid"
        | "paid"
        | "rejected"
        | "disputed"
        | "cancelled"
      ledger_type: "receivable" | "payable"
      message_kind:
        | "text"
        | "image"
        | "document"
        | "voice"
        | "system"
        | "ledger"
        | "order"
        | "sales_card"
        | "location"
        | "product_card"
        | "sticker"
      order_status: "new" | "processing" | "shipped" | "completed" | "cancelled"
      payment_method: "cash" | "transfer" | "dp" | "credit"
      preparation_item_status: "pending" | "in_progress" | "done"
      preparation_status:
        | "draft"
        | "sent"
        | "opened"
        | "in_progress"
        | "ready"
        | "completed"
        | "cancelled"
      status_item_kind: "image" | "text" | "video"
      status_privacy: "contacts" | "contacts_except" | "only_share_with"
      stock_type: "weight" | "count"
      stock_unit_source: "manual" | "preparation" | "legacy" | "return"
      stock_unit_status:
        | "draft"
        | "available"
        | "reserved"
        | "preparing"
        | "ready"
        | "delivered"
        | "void"
      unit_slot_mode: "existing" | "prepare_new"
      unit_slot_status:
        | "pending"
        | "reserved"
        | "preparing"
        | "ready"
        | "delivered"
        | "cancelled"
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
      business_role: ["owner", "admin", "agent", "cashier", "viewer"],
      call_kind: ["audio", "video"],
      call_status: [
        "ringing",
        "ongoing",
        "ended",
        "missed",
        "declined",
        "failed",
        "unconfigured",
      ],
      chat_order_status: [
        "buyer_requested",
        "seller_confirmed",
        "changes_requested",
        "buyer_approved",
        "dispatched_to_preparation",
        "preparing",
        "ready_for_payment",
        "delivered",
        "cancelled",
      ],
      contact_request_status: [
        "pending",
        "accepted",
        "rejected",
        "blocked",
        "cancelled",
      ],
      conversation_type: ["direct", "group", "business"],
      inbox_status: ["open", "pending", "closed"],
      inventory_movement_type: [
        "preparation",
        "sale",
        "adjustment",
        "restock",
        "return",
      ],
      ledger_status: [
        "pending_approval",
        "active",
        "partially_paid",
        "paid",
        "rejected",
        "disputed",
        "cancelled",
      ],
      ledger_type: ["receivable", "payable"],
      message_kind: [
        "text",
        "image",
        "document",
        "voice",
        "system",
        "ledger",
        "order",
        "sales_card",
        "location",
        "product_card",
        "sticker",
      ],
      order_status: ["new", "processing", "shipped", "completed", "cancelled"],
      payment_method: ["cash", "transfer", "dp", "credit"],
      preparation_item_status: ["pending", "in_progress", "done"],
      preparation_status: [
        "draft",
        "sent",
        "opened",
        "in_progress",
        "ready",
        "completed",
        "cancelled",
      ],
      status_item_kind: ["image", "text", "video"],
      status_privacy: ["contacts", "contacts_except", "only_share_with"],
      stock_type: ["weight", "count"],
      stock_unit_source: ["manual", "preparation", "legacy", "return"],
      stock_unit_status: [
        "draft",
        "available",
        "reserved",
        "preparing",
        "ready",
        "delivered",
        "void",
      ],
      unit_slot_mode: ["existing", "prepare_new"],
      unit_slot_status: [
        "pending",
        "reserved",
        "preparing",
        "ready",
        "delivered",
        "cancelled",
      ],
    },
  },
} as const
