import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { myPin } from "@/lib/api/pins";
import { setActiveUser } from "@/lib/session-scope";
import { __resetAvatarCache } from "@/lib/api/avatar";
import { clearSignedUrlCache } from "@/lib/api/storage";
import { resetOutboxForAccount } from "@/lib/api/outbox";
import type { Tables } from "@/integrations/supabase/types";

export type Profile = Tables<"profiles">;
export type UserSettings = Tables<"user_settings">;

type AuthCtx = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  settings: UserSettings | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Identitas akun aktif adalah sumber kebenaran untuk seluruh data lokal.
   * Saat berganti (termasuk logout), cache media, signed URL, antrean outbox,
   * langganan realtime, dan key localStorage akun lama dibuang.
   */
  const applyAccount = useCallback((uid: string | null) => {
    if (!setActiveUser(uid)) return;
    __resetAvatarCache();
    clearSignedUrlCache();
    void supabase.removeAllChannels();
    resetOutboxForAccount();
  }, []);

  const load = useCallback(
    async (uid: string | undefined) => {
      applyAccount(uid ?? null);
      if (!uid) {
        setProfile(null);
        setSettings(null);
        return;
      }
      // Kolom `pin` tidak lagi termasuk grant tabel; PIN sendiri diambil via RPC.
      // `avatar_privacy` dan `avatar_version` wajib ikut: tanpa keduanya, layar
      // profil mengembalikan pilihan privasi ke "contacts" setelah refresh dan
      // cache-buster avatar tidak pernah berubah.
      const [p, s, pin] = await Promise.all([
        supabase.rpc("my_profile"),
        supabase.from("user_settings").select("*").eq("user_id", uid).maybeSingle(),
        myPin().catch(() => ""),
      ]);
      setProfile(p.data ? ({ ...p.data, pin } as Profile) : null);
      setSettings(s.data ?? null);
    },
    [applyAccount],
  );

  useEffect(() => {
    let active = true;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      void load(next?.user.id);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      void load(data.session?.user.id).finally(() => setLoading(false));
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [load]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    await load(data.session?.user.id);
  }, [load]);

  const signOut = useCallback(async () => {
    // Cabut token push + kredensial aksi perangkat sebelum sesi dihapus.
    const { revokeNativePush } = await import("@/lib/push/native");
    await revokeNativePush().catch(() => undefined);
    const { revokeWebPush } = await import("@/lib/push/web");
    await revokeWebPush().catch(() => undefined);
    await supabase.auth.signOut();
    setProfile(null);
    setSettings(null);
  }, []);

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, profile, settings, loading, refresh, signOut }),
    [session, profile, settings, loading, refresh, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam AuthProvider");
  return ctx;
}
