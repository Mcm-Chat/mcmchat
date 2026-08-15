import { useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/mcm/user-avatar";
import { useAuth } from "@/lib/auth";
import { useContacts } from "@/lib/api/queries";
import type { ContactWithProfile } from "@/lib/api/contacts";
import { cn } from "@/lib/utils";

/**
 * Dialog pemilih kontak tersimpan. Hanya menampilkan kontak yang PIN-nya
 * terbaca oleh pengguna (kontak terhubung); pemilihan mengembalikan PIN.
 */
export function SavedContactPicker({
  open,
  onOpenChange,
  onPick,
  title = "Pilih kontak tersimpan",
  description = "Pilih kontak untuk mengisi PIN MCM secara otomatis.",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (contact: { pin: string; name: string; id: string }) => void;
  title?: string;
  description?: string;
}) {
  const { user } = useAuth();
  const { data: contacts, isLoading } = useContacts(user?.id);
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const list = (contacts ?? []).filter((c: ContactWithProfile) => !!c.profile.pin);
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (c) =>
        c.profile.display_name.toLowerCase().includes(term) ||
        c.profile.pin.toLowerCase().includes(term) ||
        (c.alias ?? "").toLowerCase().includes(term),
    );
  }, [contacts, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama atau PIN"
            aria-label="Cari kontak tersimpan"
            className="h-11 rounded-xl pl-9"
          />
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {isLoading && <p className="p-3 text-sm text-muted-foreground">Memuat kontak…</p>}
          {!isLoading && rows.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">
              Belum ada kontak tersimpan dengan PIN. Gunakan input manual di bawah.
            </p>
          )}
          {rows.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onPick({
                  pin: c.profile.pin,
                  name: c.alias || c.profile.display_name,
                  id: c.profile.id,
                });
                onOpenChange(false);
              }}
              className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-muted/60"
            >
              <UserAvatar
                userId={c.profile.id}
                path={c.profile.avatar_url}
                version={c.profile.avatar_version ?? 0}
                name={c.profile.display_name}
                color={c.profile.avatar_color}
                size="sm"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {c.alias || c.profile.display_name}
                </span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {c.profile.pin}
                </span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Field PIN dua jalur: pilih dari kontak tersimpan atau ketik manual.
 * Nilai tetap dikendalikan pemanggil agar validasi/format tidak berubah.
 */
export function PinField({
  id,
  value,
  onChange,
  onPickContact,
  placeholder,
  maxLength,
  disabled,
  inputClassName,
  action,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onPickContact?: (contact: { pin: string; name: string; id: string }) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  inputClassName?: string;
  action?: React.ReactNode;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          {...(maxLength ? { maxLength } : {})}
          disabled={disabled}
          className={cn("h-11 rounded-xl", inputClassName)}
        />
        {action}
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full rounded-xl"
        disabled={disabled}
        onClick={() => setPickerOpen(true)}
      >
        <Users className="size-4" /> Pilih dari kontak tersimpan
      </Button>
      <SavedContactPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(c) => {
          onChange(c.pin);
          onPickContact?.(c);
        }}
      />
    </div>
  );
}
