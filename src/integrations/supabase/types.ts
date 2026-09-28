export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      admin_users: {
        Row: {
          created_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      claims: {
        Row: {
          claimed_quantity: number;
          created_at: string;
          id: string;
          listing_id: string;
          ngo_id: string;
          note: string | null;
          status: Database["public"]["Enums"]["claim_status"];
          updated_at: string;
        };
        Insert: {
          claimed_quantity: number;
          created_at?: string;
          id?: string;
          listing_id: string;
          ngo_id: string;
          note?: string | null;
          status?: Database["public"]["Enums"]["claim_status"];
          updated_at?: string;
        };
        Update: {
          claimed_quantity?: number;
          created_at?: string;
          id?: string;
          listing_id?: string;
          ngo_id?: string;
          note?: string | null;
          status?: Database["public"]["Enums"]["claim_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "claims_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "food_listings";
            referencedColumns: ["id"];
          },
        ];
      };
      delivery_verifications: {
        Row: {
          created_at: string;
          expires_at: string;
          failed_attempts: number;
          ngo_id: string;
          pickup_id: string;
          pin_code: string;
          verified_at: string | null;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          failed_attempts?: number;
          ngo_id: string;
          pickup_id: string;
          pin_code: string;
          verified_at?: string | null;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          failed_attempts?: number;
          ngo_id?: string;
          pickup_id?: string;
          pin_code?: string;
          verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "delivery_verifications_pickup_id_fkey";
            columns: ["pickup_id"];
            isOneToOne: true;
            referencedRelation: "pickups";
            referencedColumns: ["id"];
          },
        ];
      };
      delivery_feedback: {
        Row: {
          category: Database["public"]["Enums"]["feedback_category"];
          comment: string;
          created_at: string;
          id: string;
          pickup_id: string;
          rating: number;
          reviewer_id: string;
          reviewer_role: Database["public"]["Enums"]["app_role"];
          subject_id: string;
          subject_role: Database["public"]["Enums"]["app_role"];
        };
        Insert: {
          category: Database["public"]["Enums"]["feedback_category"];
          comment: string;
          created_at?: string;
          id?: string;
          pickup_id: string;
          rating: number;
          reviewer_id: string;
          reviewer_role: Database["public"]["Enums"]["app_role"];
          subject_id: string;
          subject_role: Database["public"]["Enums"]["app_role"];
        };
        Update: {
          category?: Database["public"]["Enums"]["feedback_category"];
          comment?: string;
          created_at?: string;
          id?: string;
          pickup_id?: string;
          rating?: number;
          reviewer_id?: string;
          reviewer_role?: Database["public"]["Enums"]["app_role"];
          subject_id?: string;
          subject_role?: Database["public"]["Enums"]["app_role"];
        };
        Relationships: [
          {
            foreignKeyName: "delivery_feedback_pickup_id_fkey";
            columns: ["pickup_id"];
            isOneToOne: false;
            referencedRelation: "pickups";
            referencedColumns: ["id"];
          },
        ];
      };
      food_listings: {
        Row: {
          allergens: string | null;
          best_before: string;
          city: string | null;
          claimed_quantity: number;
          created_at: string;
          description: string | null;
          diet: Database["public"]["Enums"]["diet_tag"];
          donor_id: string;
          food_type: string;
          id: string;
          latitude: number | null;
          longitude: number | null;
          photo_url: string | null;
          pickup_address: string;
          prepared_at: string;
          quantity: number;
          status: Database["public"]["Enums"]["listing_status"];
          storage: Database["public"]["Enums"]["storage_temp"];
          title: string;
          unit: string;
          updated_at: string;
        };
        Insert: {
          allergens?: string | null;
          best_before: string;
          city?: string | null;
          claimed_quantity?: number;
          created_at?: string;
          description?: string | null;
          diet?: Database["public"]["Enums"]["diet_tag"];
          donor_id: string;
          food_type: string;
          id?: string;
          latitude?: number | null;
          longitude?: number | null;
          photo_url?: string | null;
          pickup_address: string;
          prepared_at?: string;
          quantity: number;
          status?: Database["public"]["Enums"]["listing_status"];
          storage?: Database["public"]["Enums"]["storage_temp"];
          title: string;
          unit?: string;
          updated_at?: string;
        };
        Update: {
          allergens?: string | null;
          best_before?: string;
          city?: string | null;
          claimed_quantity?: number;
          created_at?: string;
          description?: string | null;
          diet?: Database["public"]["Enums"]["diet_tag"];
          donor_id?: string;
          food_type?: string;
          id?: string;
          latitude?: number | null;
          longitude?: number | null;
          photo_url?: string | null;
          pickup_address?: string;
          prepared_at?: string;
          quantity?: number;
          status?: Database["public"]["Enums"]["listing_status"];
          storage?: Database["public"]["Enums"]["storage_temp"];
          title?: string;
          unit?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      impact_records: {
        Row: {
          city: string | null;
          co2_avoided_kg: number;
          completed_at: string;
          created_at: string;
          donor_id: string;
          food_type: string | null;
          id: string;
          meals_saved: number;
          ngo_id: string;
          pickup_id: string;
          weight_kg: number;
        };
        Insert: {
          city?: string | null;
          co2_avoided_kg?: number;
          completed_at?: string;
          created_at?: string;
          donor_id: string;
          food_type?: string | null;
          id?: string;
          meals_saved?: number;
          ngo_id: string;
          pickup_id: string;
          weight_kg?: number;
        };
        Update: {
          city?: string | null;
          co2_avoided_kg?: number;
          completed_at?: string;
          created_at?: string;
          donor_id?: string;
          food_type?: string | null;
          id?: string;
          meals_saved?: number;
          ngo_id?: string;
          pickup_id?: string;
          weight_kg?: number;
        };
        Relationships: [
          {
            foreignKeyName: "impact_records_pickup_id_fkey";
            columns: ["pickup_id"];
            isOneToOne: false;
            referencedRelation: "pickups";
            referencedColumns: ["id"];
          },
        ];
      };
      pickups: {
        Row: {
          actual_pickup_time: string | null;
          claim_id: string;
          created_at: string;
          delivered_time: string | null;
          id: string;
          scheduled_time: string;
          status: Database["public"]["Enums"]["pickup_status"];
          updated_at: string;
          volunteer_id: string | null;
        };
        Insert: {
          actual_pickup_time?: string | null;
          claim_id: string;
          created_at?: string;
          delivered_time?: string | null;
          id?: string;
          scheduled_time: string;
          status?: Database["public"]["Enums"]["pickup_status"];
          updated_at?: string;
          volunteer_id?: string | null;
        };
        Update: {
          actual_pickup_time?: string | null;
          claim_id?: string;
          created_at?: string;
          delivered_time?: string | null;
          id?: string;
          scheduled_time?: string;
          status?: Database["public"]["Enums"]["pickup_status"];
          updated_at?: string;
          volunteer_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "pickups_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: false;
            referencedRelation: "claims";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          address: string | null;
          city: string | null;
          created_at: string;
          email: string | null;
          food_preferences: string[];
          full_name: string;
          id: string;
          latitude: number | null;
          longitude: number | null;
          org_name: string | null;
          phone: string | null;
          service_radius_km: number;
          updated_at: string;
          verified: boolean;
        };
        Insert: {
          address?: string | null;
          city?: string | null;
          created_at?: string;
          email?: string | null;
          food_preferences?: string[];
          full_name?: string;
          id: string;
          latitude?: number | null;
          longitude?: number | null;
          org_name?: string | null;
          phone?: string | null;
          service_radius_km?: number;
          updated_at?: string;
          verified?: boolean;
        };
        Update: {
          address?: string | null;
          city?: string | null;
          created_at?: string;
          email?: string | null;
          food_preferences?: string[];
          full_name?: string;
          id?: string;
          latitude?: number | null;
          longitude?: number | null;
          org_name?: string | null;
          phone?: string | null;
          service_radius_km?: number;
          updated_at?: string;
          verified?: boolean;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_delivery_request: { Args: { _pickup_id: string }; Returns: boolean };
      can_access_claim: { Args: { _claim_id: string }; Returns: boolean };
      can_access_listing: { Args: { _listing_id: string }; Returns: boolean };
      can_access_pickup: { Args: { _pickup_id: string }; Returns: boolean };
      can_access_profile: { Args: { _profile_id: string }; Returns: boolean };
      claim_food_listing: {
        Args: {
          _claimed_quantity: number;
          _listing_id: string;
          _note?: string | null;
        };
        Returns: string;
      };
      create_delivery_request: {
        Args: { _claim_id: string; _scheduled_time: string };
        Returns: { delivery_pin: string; pickup_id: string }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      has_current_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] };
        Returns: boolean;
      };
      is_admin: { Args: never; Returns: boolean };
      my_submitted_feedback_keys: {
        Args: never;
        Returns: {
          category: Database["public"]["Enums"]["feedback_category"];
          pickup_id: string;
        }[];
      };
      submit_delivery_feedback: {
        Args: {
          _category: Database["public"]["Enums"]["feedback_category"];
          _comment: string;
          _pickup_id: string;
          _rating: number;
        };
        Returns: string;
      };
      verify_delivery_pin: {
        Args: { _pickup_id: string; _pin: string };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "donor" | "ngo" | "volunteer" | "admin";
      claim_status:
        | "pending"
        | "confirmed"
        | "scheduled"
        | "picked_up"
        | "delivered"
        | "completed"
        | "cancelled";
      diet_tag: "veg" | "non_veg" | "vegan" | "mixed";
      feedback_category: "delivery_partner" | "food" | "food_receiver" | "restaurant";
      listing_status:
        | "posted"
        | "claimed"
        | "scheduled"
        | "picked_up"
        | "delivered"
        | "completed"
        | "expired"
        | "cancelled";
      pickup_status:
        "scheduled" | "en_route" | "picked_up" | "delivered" | "completed" | "cancelled";
      storage_temp: "hot" | "refrigerated" | "frozen" | "room_temp";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["donor", "ngo", "volunteer", "admin"],
      claim_status: [
        "pending",
        "confirmed",
        "scheduled",
        "picked_up",
        "delivered",
        "completed",
        "cancelled",
      ],
      diet_tag: ["veg", "non_veg", "vegan", "mixed"],
      listing_status: [
        "posted",
        "claimed",
        "scheduled",
        "picked_up",
        "delivered",
        "completed",
        "expired",
        "cancelled",
      ],
      pickup_status: ["scheduled", "en_route", "picked_up", "delivered", "completed", "cancelled"],
      storage_temp: ["hot", "refrigerated", "frozen", "room_temp"],
    },
  },
} as const;
