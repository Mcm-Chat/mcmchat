import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
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

  const load = useCallback(async (uid: string | undefined) => {
    if (!uid) {
      setProfile(null);
      setSettings(null);
      return;
    }
    const [p, s] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("user_settings").select("*").eq("user_id", uid).maybeSingle(),
    ]);
    setProfile(p.data ?? null);
    setSettings(s.data ?? null);
  }, []);

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
