import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/mcm/user-avatar";
import {
  listAvatarAudience,
  saveAvatarPrivacyAudience,
  type AvatarPrivacy,
} from "@/lib/api/avatar";
import { listContacts } from "@/lib/api/contacts";
import {
  audienceModeFor,
  audienceSummary,
  filterAudienceCandidates,
  requiresEmptyConfirm,
  toggleSelection,
} from "@/lib/media/avatar-audience";

type Candidate = {
  id: string;
  display_name: string;
  pin: string;
  avatar_url: string | null;
  avatar_version: number | undefined;
  avatar_color: string;
};

/**
 * Pemilih audiens foto profil untuk mode `contacts_except` dan `only_share`.
 * Simpan bersifat atomik: mode privasi dan daftar audiens berubah bersama
 * melalui satu RPC. Batal/tutup dialog tidak mengubah apa pun di server.
 */
export function AvatarAudienceDialog({
  open,
  userId,
  privacy,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  userId: string;
  privacy: AvatarPrivacy;
  onOpenChange: (open: boolean) => void;
  onSaved: (privacy: AvatarPrivacy, count: number) => void | Promise<void>;
}) {
  const mode = audienceModeFor(privacy);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  useEffect(() => {
    if (!open || !mode) return;
    let active = true;
    setLoading(true);
    setConfirmEmpty(false);
    setQuery("");
    void Promise.all([listContacts(userId), listAvatarAudience(userId, mode)])
      .then(([contacts, targets]) => {
        if (!active) return;
        setCandidates(
          contacts
            .filter((c) => !c.is_blocked)
            .map((c) => ({
              id: c.contact_id,
              display_name: c.profile.display_name,
              pin: c.profile.pin,
              avatar_url: c.profile.avatar_url,
              avatar_version: c.profile.avatar_version,
              avatar_color: c.profile.avatar_color,
            })),
        );
        setSelected(targets);
      })
      .catch((err: unknown) => {
        if (active) toast.error(err instanceof Error ? err.message : "Gagal memuat kontak");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, userId, mode]);

  const visible = useMemo(() => filterAudienceCandidates(candidates, query), [candidates, query]);
  const blockedByEmpty = requiresEmptyConfirm(privacy, selected.length) && !confirmEmpty;

  const save = async () => {
    if (!mode || saving) return;
    if (privacy !== "contacts_except" && privacy !== "only_share") return;
    setSaving(true);
    try {
      const count = await saveAvatarPrivacyAudience(privacy, selected, confirmEmpty);
      await onSaved(privacy, count);
      toast.success("Audiens foto profil disimpan");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan audiens");
    } finally {
      setSaving(false);
    }
  };

  if (!mode) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 rounded-2xl">
        <DialogHeader>
          <DialogTitle>
            {privacy === "contacts_except" ? "Kecualikan kontak" : "Bagikan hanya dengan"}
          </DialogTitle>
          <DialogDescription>
            {privacy === "contacts_except"
              ? "Kontak yang dipilih tidak akan melihat foto profil Anda."
              : "Hanya kontak yang dipilih yang dapat melihat foto profil Anda."}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nama atau PIN"
            className="pl-9"
            aria-label="Cari kontak"
          />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{audienceSummary(privacy, selected.length)}</span>
          <div className="flex gap-2">
            <button
              type="button"
              className="text-primary"
              onClick={() => setSelected(visible.map((c) => c.id))}
            >
              Pilih semua
            </button>
            <button type="button" className="text-primary" onClick={() => setSelected([])}>
              Kosongkan
            </button>
          </div>
        </div>

        <div className="min-h-32 flex-1 space-y-1 overflow-y-auto">
          {loading && (
            <p className="py-8 text-center text-sm text-muted-foreground">Memuat kontak…</p>
          )}
          {!loading && visible.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {candidates.length === 0 ? "Belum ada kontak." : "Tidak ada kontak yang cocok."}
            </p>
          )}
          {!loading &&
            visible.map((c) => (
              <label
                key={c.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted"
              >
                <Checkbox
                  checked={selected.includes(c.id)}
                  onCheckedChange={() => setSelected((p) => toggleSelection(p, c.id))}
                  aria-label={`Pilih ${c.display_name}`}
                />
                <UserAvatar
                  userId={c.id}
                  path={c.avatar_url}
                  version={c.avatar_version}
                  name={c.display_name}
                  color={c.avatar_color}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.display_name}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {c.pin}
                  </span>
                </span>
              </label>
            ))}
        </div>

        {requiresEmptyConfirm(privacy, selected.length) && (
          <label className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs">
            <Checkbox
              checked={confirmEmpty}
              onCheckedChange={(v) => setConfirmEmpty(v === true)}
              aria-label="Konfirmasi tanpa penerima"
            />
            <span>Tanpa penerima, hasilnya sama dengan “Tidak seorang pun”. Saya mengerti.</span>
          </label>
        )}

        <DialogFooter>
          <Button
            className="min-h-11 w-full rounded-xl"
            disabled={saving || loading || blockedByEmpty}
            onClick={() => void save()}
          >
            {saving ? "Menyimpan…" : "Simpan audiens"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
