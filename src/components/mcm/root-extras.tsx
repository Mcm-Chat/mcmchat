/**
 * Widget global non-kritis (sesi push, pendengar panggilan masuk, dialog
 * penolakan akses push, penjaga privasi layar). Semuanya hanya berguna
 * setelah aplikasi hidup di perangkat, jadi modulnya dimuat terpisah agar
 * bundel awal — layar pertama yang dilihat pengguna — tetap ringan.
 */
import { useAuth } from "@/lib/auth";
import { usePushSession } from "@/lib/push/use-push";
import { useAppLinks } from "@/lib/deeplink/use-app-links";
import { IncomingCallListener } from "@/components/mcm/incoming-call";
import { PushDeniedDialog } from "@/components/mcm/push-denied-dialog";
import { ScreenPrivacyGuard } from "@/components/mcm/screen-privacy-guard";

function PushSession() {
  const { user } = useAuth();
  usePushSession(user?.id);
  return null;
}

function AppLinks() {
  useAppLinks();
  return null;
}

export default function RootExtras() {
  return (
    <>
      <PushSession />
      <AppLinks />
      <IncomingCallListener />
      <PushDeniedDialog />
      <ScreenPrivacyGuard />
    </>
  );
}
