/**
 * Ubah nama kontak dari mana pun (daftar kontak, chat, riwayat panggilan).
 * Nama hanya berlaku untuk buku kontak saya — lawan bicara tidak melihatnya.
 */
import { useEffect, useId, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ALIAS_MAX,
  setContactAlias,
  useContactAliases,
  useRefreshAliases,
} from "@/lib/contacts/alias";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Id pengguna yang namanya diubah. */
  contactId: string;
  /** Nama asli dari profil, dipakai saat alias dikosongkan. */
  realName: string;
};

export function RenameContactDialog({ open, onOpenChange, contactId, realName }: Props) {
  const { userId, aliases } = useContactAliases();
  const refresh = useRefreshAliases();
  const inputId = useId();
  const current = aliases?.get(contactId) ?? "";
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setValue(aliases?.get(contactId) ?? "");
  }, [open, contactId, aliases]);

  const save = async (next: string) => {
    if (!userId) return;
    setSaving(true);
    try {
      const alias = await setContactAlias(userId, contactId, next);
      refresh();
      toast.success(alias ? `Nama diubah menjadi "${alias}"` : "Nama asli dipakai kembali");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Nama gagal disimpan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Ubah nama kontak</DialogTitle>
          <DialogDescription>
            Nama ini hanya terlihat oleh Anda. Kosongkan untuk memakai nama asli
            {realName ? ` (${realName})` : ""}.
          </DialogDescription>
        </DialogHeader>
        <label htmlFor={inputId} className="sr-only">
          Nama kontak
        </label>
        <Input
          id={inputId}
          value={value}
          autoFocus
          maxLength={ALIAS_MAX}
          placeholder={realName || "Nama kontak"}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save(value);
            }
          }}
        />
        <p className="text-xs text-muted-foreground">
          Ditampilkan sebagai:{" "}
          <span className="font-medium text-foreground">
            {value.trim() || realName || "Pengguna MCM"}
          </span>
        </p>
        <DialogFooter className="gap-2 sm:gap-2">
          {current && (
            <Button
              variant="ghost"
              className="h-11 rounded-xl"
              disabled={saving}
              onClick={() => void save("")}
            >
              Pakai nama asli
            </Button>
          )}
          <Button className="h-11 rounded-xl" disabled={saving} onClick={() => void save(value)}>
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Tombol pensil siap pakai: buka dialog ubah nama untuk satu kontak. */
export function RenameContactButton({
  contactId,
  realName,
  size = "icon",
  className,
  label,
}: {
  contactId: string;
  realName: string;
  size?: "icon" | "sm";
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const { nameOf } = useContactAliases();
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={size}
        className={className}
        aria-label={`Ubah nama ${nameOf(contactId, realName)}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Pencil className="size-4" />
        {label ? <span className="ml-1.5">{label}</span> : null}
      </Button>
      <RenameContactDialog
        open={open}
        onOpenChange={setOpen}
        contactId={contactId}
        realName={realName}
      />
    </>
  );
}
