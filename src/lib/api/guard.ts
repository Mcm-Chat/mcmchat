import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useRealtimeSync } from "./queries";
import { usePresence } from "./presence";
import { usePushRegistration } from "@/lib/push/use-push";

/** Semua halaman aplikasi butuh sesi nyata; tanpa sesi dialihkan ke halaman masuk. */
export function useRequireAuth() {
  const { session, user, profile, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/login", replace: true });
  }, [loading, session, navigate]);
  useRealtimeSync(user?.id);
  const onlineIds = usePresence(user?.id);
  usePushRegistration(user?.id);
  return { userId: user?.id, profile, onlineIds, loading: loading || (!!session && !profile) };
}
