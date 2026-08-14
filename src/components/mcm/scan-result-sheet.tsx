import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { MessageCircle, ScanLine, Trash2, UserPlus, UserRound } from "lucide-react";
import { UserAvatar } from "@/components/mcm/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  cancelContactRequest,
  getContactRelation,
  removeContact,
  respondToRequest,
  saveContact,
  sendContactRequest,
  setBlocked,
  type ContactRelation,
  type ProfileLite,
} from "@/lib/api/contacts";
import { getOrCreateDirect } from "@/lib/api/chat";

export type ScanUsage = { profile: ProfileLite };

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

  useEffect(() => {
    if (!open || !profile) return;
    setRelation(null);
    setAlias("");
    setSaved(false);
    let active = true;
    void getContactRelation(userId, profile.id)
      .then((r) => active && setRelation(r))
      .catch(() => active && toast.error("Gagal memuat status kontak."));
    return () => {
      active = false;
    };
  }, [open, profile, userId]);

  const refresh = async () => {
    if (!profile) return;
    setRelation(await getContactRelation(userId, profile.id));
  };

  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast.success(done);
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Kontak gagal disimpan. Periksa koneksi lalu coba lagi.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!profile) return null;
  const blockedMe = relation?.blockedMe ?? false;

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

        <p className="mt-3 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          {blockedMe
            ? "Pengguna tidak tersedia."
            : relation?.blockedByMe
              ? "Kontak ini Anda blokir."
              : relation?.incomingRequest
                ? "Pengguna ini meminta menjadi kontak."
                : relation?.saved && relation.outgoingPending
                  ? "Tersimpan — menunggu persetujuan"
                  : relation?.saved
                    ? "Sudah tersimpan"
                    : relation?.outgoingPending
                      ? "Permintaan kontak sudah dikirim."
                      : "Belum tersimpan di kontak Anda."}
        </p>

        {saved && (
          <p className="mt-2 text-xs font-medium text-primary">Kontak berhasil disimpan</p>
        )}

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
                  onClick={() =>
                    void run(async () => {
                      await saveContact(userId, profile.id, "qr", alias.trim() || null);
                      if (!relation?.outgoingPending && !relation?.incomingRequest) {
                        await sendContactRequest(
                          userId,
                          profile.id,
                          "Halo, saya ingin terhubung di MCM.",
                        );
                      }
                      setSaved(true);
                    }, "Kontak berhasil disimpan")
                  }
                >
                  <UserPlus className="size-4" />{" "}
                  {relation?.incomingRequest ? "Simpan tanpa menerima" : "Simpan Kontak"}
                </Button>
              )}

              {relation?.outgoingPending && (
                <Button
                  variant="outline"
                  className="h-12 rounded-xl"
                  disabled={busy}
                  onClick={() =>
                    void run(() => cancelContactRequest(userId, profile.id), "Permintaan dibatalkan")
                  }
                >
                  Batalkan Permintaan
                </Button>
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
                        const conv = await getOrCreateDirect(userId, profile.id);
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

              {relation?.saved && (
                <Button
                  variant="ghost"
                  className="h-12 rounded-xl text-destructive"
                  disabled={busy}
                  onClick={() =>
                    void run(() => removeContact(userId, profile.id), "Kontak dihapus")
                  }
                >
                  <Trash2 className="size-4" /> Hapus dari Kontak
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
    </Sheet>
  );
}
