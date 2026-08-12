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
      business_members: {
        Row: {
          business_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["business_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["business_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["business_role"]
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
          conversation_id: string | null
          created_at: string
          duration_sec: number
          ended_at: string | null
          id: string
          initiator_id: string
          kind: Database["public"]["Enums"]["call_kind"]
          provider: string
          room_name: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["call_status"]
          updated_at: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          duration_sec?: number
          ended_at?: string | null
          id?: string
          initiator_id: string
          kind?: Database["public"]["Enums"]["call_kind"]
          provider?: string
          room_name?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["call_status"]
          updated_at?: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          duration_sec?: number
          ended_at?: string | null
          id?: string
          initiator_id?: string
          kind?: Database["public"]["Enums"]["call_kind"]
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
          updated_at?: string
        }
        Relationships: []
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
      devices: {
        Row: {
          created_at: string
          id: string
          last_active_at: string
          name: string
          platform: string
          push_token: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_active_at?: string
          name: string
          platform?: string
          push_token?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_active_at?: string
          name?: string
          platform?: string
          push_token?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      product_photos: {
        Row: {
          business_id: string
          caption: string
          created_at: string
          id: string
          image_path: string
          image_url: string | null
          location_label: string
          location_lat: number | null
          location_lng: number | null
          location_url: string
          product_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          business_id: string
          caption?: string
          created_at?: string
          id?: string
          image_path: string
          image_url?: string | null
          location_label?: string
          location_lat?: number | null
          location_lng?: number | null
          location_url?: string
          product_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          business_id?: string
          caption?: string
          created_at?: string
          id?: string
          image_path?: string
          image_url?: string | null
          location_label?: string
          location_lat?: number | null
          location_lng?: number | null
          location_url?: string
          product_id?: string
          sort_order?: number
          updated_at?: string
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
            foreignKeyName: "product_photos_product_id_fkey"
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
          avatar_url: string | null
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
          avatar_url?: string | null
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
          avatar_url?: string | null
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
      user_settings: {
        Row: {
          created_at: string
          notifications: Json
          privacy: Json
          security: Json
          theme: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          notifications?: Json
          privacy?: Json
          security?: Json
          theme?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          notifications?: Json
          privacy?: Json
          security?: Json
          theme?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      business_role_of: {
        Args: { _biz: string; _uid: string }
        Returns: Database["public"]["Enums"]["business_role"]
      }
      can_manage_business: {
        Args: { _biz: string; _uid: string }
        Returns: boolean
      }
      can_see_ledger: {
        Args: { _ledger: string; _uid: string }
        Returns: boolean
      }
      can_sell_business: {
        Args: { _biz: string; _uid: string }
        Returns: boolean
      }
      find_profile_by_pin: {
        Args: { _pin: string }
        Returns: {
          avatar_color: string
          avatar_url: string
          bio: string
          display_name: string
          id: string
          pin: string
        }[]
      }
      gen_mcm_pin: { Args: never; Returns: string }
      is_business_member: {
        Args: { _biz: string; _uid: string }
        Returns: boolean
      }
      is_call_participant: {
        Args: { _call: string; _uid: string }
        Returns: boolean
      }
      is_conv_member: {
        Args: { _conv: string; _uid: string }
        Returns: boolean
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
      safe_uuid: { Args: { _t: string }; Returns: string }
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
      contact_request_status:
        | "pending"
        | "accepted"
        | "rejected"
        | "blocked"
        | "cancelled"
      conversation_type: "direct" | "group" | "business"
      inbox_status: "open" | "pending" | "closed"
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
      order_status: "new" | "processing" | "shipped" | "completed" | "cancelled"
      payment_method: "cash" | "transfer" | "dp" | "credit"
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
      contact_request_status: [
        "pending",
        "accepted",
        "rejected",
        "blocked",
        "cancelled",
      ],
      conversation_type: ["direct", "group", "business"],
      inbox_status: ["open", "pending", "closed"],
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
      ],
      order_status: ["new", "processing", "shipped", "completed", "cancelled"],
      payment_method: ["cash", "transfer", "dp", "credit"],
    },
  },
} as const
