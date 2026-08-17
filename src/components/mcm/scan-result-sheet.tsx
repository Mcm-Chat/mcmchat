import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, MessageCircle, ScanLine, Send, Trash2, UserPlus, UserRound } from "lucide-react";
import { UserAvatar } from "@/components/mcm/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  cancelContactRequest,
  getContactRelation,
  removeSavedContact,
  disconnectContact,
  respondToRequest,
  saveContact,
  sendContactRequest,
  setBlocked,
  type ContactRelation,
  type ProfileLite,
} from "@/lib/api/contacts";
import { getOrCreateDirect } from "@/lib/api/chat";
import { useBackDismiss } from "@/lib/mobile/back-guard";
import { supabase } from "@/integrations/supabase/client";
import { uniqueTopic } from "@/lib/realtime/topic";

export type ScanUsage = { profile: ProfileLite };

type BadgeTone = "danger" | "success" | "primary" | "warn" | "muted";

const TONE_CLASS: Record<BadgeTone, string> = {
  danger: "bg-destructive/10 text-destructive",
  success: "bg-emerald-500/15 text-emerald-600",
  primary: "bg-primary/10 text-primary",
  warn: "bg-amber-500/15 text-amber-600",
  muted: "bg-muted text-muted-foreground",
};

function relationBadge(relation: ContactRelation | null): { label: string; tone: BadgeTone } {
  if (!relation) return { label: "Memuat status…", tone: "muted" };
  if (relation.blockedMe) return { label: "Anda diblokir", tone: "danger" };
  if (relation.blockedByMe) return { label: "Anda memblokir", tone: "danger" };
  if (relation.connected) return { label: "Sudah terhubung", tone: "success" };
  if (relation.incomingRequest) return { label: "Permintaan masuk menunggu", tone: "primary" };
  if (relation.outgoingPending)
    return {
      label: relation.saved ? "Tersimpan — menunggu jawaban" : "Permintaan keluar menunggu",
      tone: "warn",
    };
  if (relation.saved) return { label: "Tersimpan (belum terhubung)", tone: "muted" };
  return { label: "Belum terhubung", tone: "muted" };
}

function RelationBadge({ relation }: { relation: ContactRelation | null }) {
  const { label, tone } = relationBadge(relation);
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {label}
    </span>
  );
}

const timeWib = (d: Date) =>
  new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(d);

/**
 * Hasil pindai QR kontak: menampilkan profil, status relasi, dan aksi
 * "Simpan Kontak" / "Gunakan Tanpa Menyimpan" / "Batal".
 */
export function ScanResultSheet({
  open,
  profile,
  userId,
  onOpenChange,
  onScanAgain,
  onManualPin,
  onUseWithoutSaving,
}: {
  open: boolean;
  profile: ProfileLite | null;
  userId: string;
  onOpenChange: (v: boolean) => void;
  onScanAgain: () => void;
  onManualPin: () => void;
  onUseWithoutSaving?: (usage: ScanUsage) => void;
}) {
  const navigate = useNavigate();
  const [relation, setRelation] = useState<ContactRelation | null>(null);
  const [alias, setAlias] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useBackDismiss(open, () => onOpenChange(false));

  const profileId = profile?.id ?? null;

  const refresh = useCallback(async () => {
    if (!profileId) return;
    setRefreshing(true);
    try {
      const next = await getContactRelation(userId, profileId);
      setRelation(next);
      setUpdatedAt(new Date());
    } finally {
      setRefreshing(false);
    }
  }, [profileId, userId]);

  useEffect(() => {
    if (!open || !profileId) return;
    setRelation(null);
    setAlias("");
    setSaved(false);
    setConfirmOpen(false);
    setUpdatedAt(null);
    void refresh().catch(() => toast.error("Gagal memuat status kontak."));
  }, [open, profileId, refresh]);

  // Sinkron realtime: perubahan permintaan/kontak langsung memperbarui badge status.
  useEffect(() => {
    if (!open || !profileId) return;
    const channel = supabase
      .channel(uniqueTopic(`mcm-scan-relation-${userId}-${profileId}`))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "contact_requests" },
        () => void refresh().catch(() => undefined),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "contacts" },
        () => void refresh().catch(() => undefined),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [open, profileId, userId, refresh]);

  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast.success(done);
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Kontak gagal disimpan. Periksa koneksi lalu coba lagi.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!profile) return null;
  const blockedMe = relation?.blockedMe ?? false;
  const willSendRequest = !relation?.outgoingPending && !relation?.incomingRequest;

  const confirmSave = () =>
    void run(async () => {
      await saveContact(userId, profile.id, "qr", alias.trim() || null);
      if (!relation?.outgoingPending && !relation?.incomingRequest) {
        await sendContactRequest(userId, profile.id, "Halo, saya ingin terhubung di MCM.");
      }
      setSaved(true);
      setConfirmOpen(false);
    }, "Kontak berhasil disimpan");

  const resendRequest = async () => {
    setBusy(true);
    try {
      const result = await sendContactRequest(userId, profile.id, "Halo, saya ingin terhubung di MCM.");
      if (result.code === "resent" || result.code === "sent") {
        toast.success("Permintaan dikirim ulang");
      } else if (result.code === "accepted_incoming") {
        toast.success("Kontak langsung diterima");
      } else {
        toast.success("Status permintaan diperbarui");
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengirim ulang permintaan.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-3xl pb-8">
        <SheetHeader className="text-left">
          <SheetTitle>Hasil pindai</SheetTitle>
          <SheetDescription>Periksa profil sebelum menyimpan sebagai kontak.</SheetDescription>
        </SheetHeader>

        <div className="mt-2 flex items-center gap-3">
          <UserAvatar
            userId={profile.id}
            path={profile.avatar_url}
            version={profile.avatar_version}
            name={profile.display_name}
            color={profile.avatar_color}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{profile.display_name}</p>
            <p className="font-mono text-xs text-muted-foreground">{profile.pin}</p>
            {!blockedMe && profile.bio && (
              <p className="truncate text-xs text-muted-foreground">{profile.bio}</p>
            )}
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-muted/60 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <RelationBadge relation={relation} />
            {refreshing && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Memperbarui…
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {blockedMe
              ? "Pengguna tidak tersedia."
              : relation?.blockedByMe
                ? "Kontak ini Anda blokir."
                : relation?.incomingRequest
                  ? "Pengguna ini meminta menjadi kontak."
                  : relation?.connected
                    ? "Chat dan panggilan aktif."
                    : relation?.outgoingPending
                      ? "Menunggu jawaban dari pengguna ini."
                      : relation?.saved
                        ? "Tersimpan satu arah."
                        : "Belum tersimpan di kontak Anda."}
            {updatedAt && ` · Diperbarui ${timeWib(updatedAt)} WIB`}
          </p>
        </div>

        {saved && <p className="mt-2 text-xs font-medium text-primary">Kontak berhasil disimpan</p>}

        {!blockedMe && !relation?.saved && (
          <div className="mt-3 space-y-1.5">
            <Label htmlFor="alias">Nama panggilan (opsional)</Label>
            <Input
              id="alias"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder={profile.display_name}
              className="h-11 rounded-xl"
            />
          </div>
        )}

        <div className="mt-4 grid gap-2">
          {blockedMe ? null : (
            <>
              {relation?.blockedByMe && (
                <Button
                  className="h-12 rounded-xl"
                  disabled={busy}
                  onClick={() =>
                    void run(() => setBlocked(userId, profile.id, false), "Blokir dibuka")
                  }
                >
                  Buka Blokir
                </Button>
              )}

              {relation?.incomingRequest && !relation.blockedByMe && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    className="h-12 rounded-xl"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => respondToRequest(relation.incomingRequest!, "accepted"),
                        "Permintaan diterima",
                      )
                    }
                  >
                    Terima
                  </Button>
                  <Button
                    variant="outline"
                    className="h-12 rounded-xl"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => respondToRequest(relation.incomingRequest!, "rejected"),
                        "Permintaan ditolak",
                      )
                    }
                  >
                    Tolak
                  </Button>
                </div>
              )}

              {!relation?.saved && !relation?.blockedByMe && (
                <Button
                  className="h-12 rounded-xl"
                  disabled={busy || !relation}
                  onClick={() => setConfirmOpen(true)}
                >
                  <UserPlus className="size-4" />{" "}
                  {relation?.incomingRequest ? "Simpan tanpa menerima" : "Simpan Kontak"}
                </Button>
              )}

              {relation?.outgoingPending && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="default"
                    className="h-12 rounded-xl"
                    disabled={busy}
                    onClick={() => void resendRequest()}
                  >
                    <Send className="size-4" /> Kirim Ulang
                  </Button>
                  <Button
                    variant="outline"
                    className="h-12 rounded-xl"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => cancelContactRequest(userId, profile.id),
                        "Permintaan dibatalkan",
                      )
                    }
                  >
                    Batalkan
                  </Button>
                </div>
              )}

              {(relation?.saved || saved) && !relation?.blockedByMe && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="secondary"
                    className="h-12 rounded-xl"
                    disabled={busy || !relation?.connected}
                    title={
                      relation?.connected
                        ? undefined
                        : "Chat aktif setelah permintaan kontak diterima"
                    }
                    onClick={() =>
                      void run(async () => {
                        const conv = await getOrCreateDirect(profile.id);
                        onOpenChange(false);
                        await navigate({ to: "/chat/$id", params: { id: conv } });
                      })
                    }
                  >
                    <MessageCircle className="size-4" /> Buka Chat
                  </Button>
                  <Button
                    variant="secondary"
                    className="h-12 rounded-xl"
                    onClick={() => {
                      onOpenChange(false);
                      void navigate({ to: "/contacts/$id", params: { id: profile.id } });
                    }}
                  >
                    <UserRound className="size-4" /> Lihat Profil
                  </Button>
                </div>
              )}

              {(relation?.saved || saved) && !relation?.connected && !relation?.blockedByMe && (
                <p className="text-xs text-muted-foreground">
                  Disimpan satu arah. Chat dan panggilan aktif setelah permintaan diterima.
                </p>
              )}

              {relation?.saved && !relation?.connected && (
                <Button
                  variant="ghost"
                  className="h-12 rounded-xl text-destructive"
                  disabled={busy}
                  onClick={() =>
                    void run(() => removeSavedContact(userId, profile.id), "Kartu kontak dihapus")
                  }
                >
                  <Trash2 className="size-4" /> Hapus Kartu Kontak
                </Button>
              )}

              {relation?.connected && (
                <Button
                  variant="ghost"
                  className="h-12 rounded-xl text-destructive"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm("Putuskan hubungan dengan kontak ini?")) return;
                    void run(() => disconnectContact(userId, profile.id), "Hubungan diputus");
                  }}
                >
                  <Trash2 className="size-4" /> Putuskan Hubungan
                </Button>
              )}

              {!relation?.saved && (
                <Button
                  variant="outline"
                  className="h-12 rounded-xl"
                  onClick={() => {
                    onUseWithoutSaving?.({ profile });
                    onOpenChange(false);
                  }}
                >
                  Gunakan Tanpa Menyimpan
                </Button>
              )}
            </>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="ghost"
              className="h-12 rounded-xl"
              onClick={() => {
                onOpenChange(false);
                onScanAgain();
              }}
            >
              <ScanLine className="size-4" /> Scan Lagi
            </Button>
            <Button
              variant="ghost"
              className="h-12 rounded-xl"
              onClick={() => {
                onOpenChange(false);
                onManualPin();
              }}
            >
              Masukkan PIN Manual
            </Button>
          </div>
        </div>
      </SheetContent>
      <AlertDialog open={confirmOpen} onOpenChange={(v) => !busy && setConfirmOpen(v)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>Kirim permintaan kontak?</AlertDialogTitle>
            <AlertDialogDescription>
              {willSendRequest
                ? "Simpan sebagai kontak dan kirim permintaan agar bisa chat dan telepon."
                : "Simpan sebagai kontak. Permintaan yang sudah ada tidak dikirim ulang."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="rounded-2xl border bg-muted/40 p-3">
            <div className="flex items-center gap-3">
              <UserAvatar
                userId={profile.id}
                path={profile.avatar_url}
                version={profile.avatar_version}
                name={profile.display_name}
                color={profile.avatar_color}
                size="lg"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold">{profile.display_name}</p>
                <p className="font-mono text-xs text-muted-foreground">{profile.pin}</p>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <RelationBadge relation={relation} />
            </div>
          </div>

          {alias.trim() && (
            <p className="text-xs text-muted-foreground">
              Disimpan dengan nama panggilan: <span className="font-medium">{alias.trim()}</span>
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} className="h-11 rounded-xl">
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="h-11 rounded-xl"
              onClick={(e) => {
                e.preventDefault();
                confirmSave();
              }}
            >
              {busy ? "Mengirim…" : willSendRequest ? "Kirim permintaan" : "Simpan kontak"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
