import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { myPin } from "@/lib/api/pins";
import { getActiveUserId, setActiveUser } from "@/lib/session-scope";
import { useUserSettings } from "@/lib/settings/use-settings";
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
  const { settings } = useUserSettings(session?.user.id);
  const [loading, setLoading] = useState(true);
  const loadVersion = useRef(0);
  const authVersion = useRef(0);
  const invalidateLoad = useCallback(() => {
    ++loadVersion.current;
  }, []);

  /**
   * Identitas akun aktif adalah sumber kebenaran untuk seluruh data lokal.
   * Saat berganti (termasuk logout), cache media, signed URL, antrean outbox,
   * langganan realtime, dan key localStorage akun lama dibuang.
   */
  const applyAccount = useCallback((uid: string | null) => {
    if (!setActiveUser(uid)) return false;
    __resetAvatarCache();
    clearSignedUrlCache();
    void supabase.removeAllChannels();
    resetOutboxForAccount();
    return true;
  }, []);

  const load = useCallback(
    async (uid: string | undefined) => {
      const request = ++loadVersion.current;
      if (applyAccount(uid ?? null)) setProfile(null);
      if (!uid) {
        setProfile(null);
        return;
      }
      // Kolom `pin` tidak lagi termasuk grant tabel; PIN sendiri diambil via RPC.
      // `avatar_privacy` dan `avatar_version` wajib ikut: tanpa keduanya, layar
      // profil mengembalikan pilihan privasi ke "contacts" setelah refresh dan
      // cache-buster avatar tidak pernah berubah.
      const [p, pin] = await Promise.all([supabase.rpc("my_profile"), myPin().catch(() => "")]);
      // A previous account's slow response must never populate the new session.
      if (request !== loadVersion.current || getActiveUserId() !== uid) return;
      setProfile(p.data ? ({ ...p.data, pin } as Profile) : null);
    },
    [applyAccount],
  );

  useEffect(() => {
    let active = true;
    const initialVersion = authVersion.current;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      ++authVersion.current;
      setSession(next);
      void load(next?.user.id).finally(() => {
        if (active) setLoading(false);
      });
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!active || initialVersion !== authVersion.current) return;
      setSession(data.session);
      void load(data.session?.user.id).finally(() => {
        if (active) setLoading(false);
      });
    });
    return () => {
      active = false;
      invalidateLoad();
      sub.subscription.unsubscribe();
    };
  }, [load, invalidateLoad]);

  const refresh = useCallback(async () => {
    const request = authVersion.current;
    const { data } = await supabase.auth.getSession();
    if (request !== authVersion.current) return;
    setSession(data.session);
    await load(data.session?.user.id);
  }, [load]);

  const signOut = useCallback(async () => {
    // Cabut token push + kredensial aksi perangkat sebelum sesi dihapus.
    const { revokeNativePush } = await import("@/lib/push/native");
    await revokeNativePush().catch(() => undefined);
    const { revokeWebPush } = await import("@/lib/push/web");
    await revokeWebPush().catch(() => undefined);
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error("Gagal keluar. Periksa koneksi lalu coba lagi.");
    ++loadVersion.current;
    applyAccount(null);
    setSession(null);
    setProfile(null);
  }, [applyAccount]);

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
