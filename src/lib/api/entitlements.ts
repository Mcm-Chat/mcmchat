import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Abstraksi entitlement premium MCM.
 *
 * Sumber kebenaran adalah tabel `entitlements` di database yang HANYA bisa
 * ditulis oleh sistem penagihan di sisi server (service role). Klien tidak
 * pernah bisa memberi dirinya sendiri akses premium. Selama penyedia
 * pembayaran belum tersambung, tidak ada baris aktif sehingga seluruh
 * pengguna berstatus non-premium dan UI menampilkan "belum terhubung".
 */
export const FEATURE_VOICE_EFFECTS = "voice_effects";

export type EntitlementState = {
  loading: boolean;
  /** true hanya bila ada entitlement aktif dan belum kedaluwarsa. */
  active: boolean;
  /** Penagihan belum tersambung (tidak ada catatan langganan sama sekali). */
  billingLinked: boolean;
  expiresAt: string | null;
  source: string | null;
};

export async function checkEntitlement(userId: string, feature: string): Promise<EntitlementState> {
  const [{ data: active }, { data: row }] = await Promise.all([
    supabase.rpc("has_entitlement", { _user_id: userId, _feature: feature }),
    supabase.from("entitlements").select("status, source, expires_at").eq("user_id", userId).eq("feature", feature).maybeSingle(),
  ]);
  return {
    loading: false,
    active: Boolean(active),
    billingLinked: Boolean(row && row.source !== "unlinked"),
    expiresAt: row?.expires_at ?? null,
    source: row?.source ?? null,
  };
}

export function useEntitlement(userId: string | undefined, feature = FEATURE_VOICE_EFFECTS): EntitlementState {
  const [state, setState] = useState<EntitlementState>({
    loading: true,
    active: false,
    billingLinked: false,
    expiresAt: null,
    source: null,
  });

  useEffect(() => {
    if (!userId) {
      setState({ loading: false, active: false, billingLinked: false, expiresAt: null, source: null });
      return;
    }
    let alive = true;
    void checkEntitlement(userId, feature)
      .then((s) => alive && setState(s))
      .catch(() => alive && setState({ loading: false, active: false, billingLinked: false, expiresAt: null, source: null }));
    return () => {
      alive = false;
    };
  }, [userId, feature]);

  return state;
}
