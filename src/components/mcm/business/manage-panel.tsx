import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { BusinessSegments } from "@/components/mcm/business/segments";
import { BusinessHubEmpty } from "@/components/mcm/business/hub-empty";
import { LoadingSkeleton, SettingRow } from "@/components/mcm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useRequireAuth } from "@/lib/api/guard";
import { useMyBusiness } from "@/lib/api/queries";
import {
  canManage,
  MEMBER_SAFE_COLUMNS,
  ROLE_LABEL,
  type BusinessMemberRow,
} from "@/lib/api/business";

type MemberWithProfile = Omit<BusinessMemberRow, "staff_pin"> & {
  profile: { display_name: string; pin: string } | null;
};

/**
 * Segmen "Kelola" hub Bisnis: data bisnis, profil publik, dan tim.
 * Sebelumnya menumpang di halaman Profil; logikanya dipindah utuh ke sini.
 */
export function BusinessManagePanel() {
  const { userId, loading } = useRequireAuth();
  const { data: myBiz, isLoading: bizLoading, isError: bizError, refetch: refetchBiz } =
    useMyBusiness(userId);
  const [bizForm, setBizForm] = useState({
    name: "",
    category: "",
    description: "",
    address: "",
    hours: "",
    contact: "",
    greeting: "",
    away_message: "",
    is_public: true,
  });
  const [savingBiz, setSavingBiz] = useState(false);
  const [members, setMembers] = useState<MemberWithProfile[]>([]);

  useEffect(() => {
    if (myBiz) {
      const b = myBiz.business;
      setBizForm({
        name: b.name,
        category: b.category,
        description: b.description,
        address: b.address,
        hours: b.hours,
        contact: b.contact,
        greeting: b.greeting,
        away_message: b.away_message,
        is_public: b.is_public,
      });
      void supabase
        .from("business_members")
        .select(MEMBER_SAFE_COLUMNS)
        .eq("business_id", b.id)
        .then(async ({ data }) => {
          const rows = data ?? [];
          const ids = rows.map((r) => r.user_id);
          const { pinsFor } = await import("@/lib/api/pins");
          const { fetchProfileCards } = await import("@/lib/api/profiles");
          const [cards, pins] = await Promise.all([fetchProfileCards(ids), pinsFor(ids)]);
          const pmap = new Map(
            [...cards.values()].map((p) => [
              p.id,
              { id: p.id, display_name: p.display_name, pin: pins.get(p.id) ?? "" },
            ]),
          );
          setMembers(rows.map((r) => ({ ...r, profile: pmap.get(r.user_id) ?? null })));
        });
    }
  }, [myBiz]);

  const saveBusiness = async () => {
    if (!myBiz) return;
    setSavingBiz(true);
    try {
      const { error } = await supabase
        .from("businesses")
        .update(bizForm)
        .eq("id", myBiz.business.id);
      if (error) throw new Error(error.message);
      void refetchBiz();
      toast.success("Data bisnis diperbarui");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan data bisnis");
    } finally {
      setSavingBiz(false);
    }
  };

  const changeRole = async (memberId: string, role: BusinessMemberRow["role"]) => {
    try {
      const { error } = await supabase.from("business_members").update({ role }).eq("id", memberId);
      if (error) throw new Error(error.message);
      setMembers((p) => p.map((m) => (m.id === memberId ? { ...m, role } : m)));
      toast.success("Peran diperbarui");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memperbarui peran");
    }
  };

  const removeMember = async (memberId: string) => {
    try {
      const { error } = await supabase.from("business_members").delete().eq("id", memberId);
      if (error) throw new Error(error.message);
      setMembers((p) => p.filter((m) => m.id !== memberId));
      toast.success("Anggota dihapus dari tim");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus anggota");
    }
  };

  if (loading || bizLoading) {
    return (
      <AppShell header={<MobileHeader title="Bisnis" />}>
        <LoadingSkeleton rows={5} />
      </AppShell>
    );
  }

  if (!userId) return null;
  if (!bizError && !myBiz) return <BusinessHubEmpty userId={userId} />;

  const role = myBiz?.role;

  return (
    <AppShell
      header={
        <MobileHeader title="Bisnis" subtitle="Kelola bisnis">
          <BusinessSegments />
        </MobileHeader>
      }
    >
      <div className="space-y-3 p-4">
      <div className="card-soft space-y-3 p-4">
        <p className="text-sm font-semibold">Bisnis</p>
        {bizLoading ? (
          <LoadingSkeleton rows={2} avatar={false} />
        ) : bizError ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Gagal memuat data bisnis.</p>
            <Button
              size="sm"
              variant="outline"
              className="rounded-lg"
              onClick={() => void refetchBiz()}
            >
              Coba lagi
            </Button>
          </div>
        ) : !myBiz ? (
          <p className="text-xs text-muted-foreground">
            Anda belum tergabung dalam bisnis apa pun.
          </p>
        ) : (
          <div className="space-y-1.5">
            {canManage(role) ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-0">
                    <Label className="text-xs">Nama bisnis</Label>
                    <Input
                      value={bizForm.name}
                      maxLength={60}
                      onChange={(e) => setBizForm((p) => ({ ...p, name: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-0">
                    <Label className="text-xs">Kategori</Label>
                    <Input
                      value={bizForm.category}
                      maxLength={40}
                      onChange={(e) => setBizForm((p) => ({ ...p, category: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-0">
                  <Label className="text-xs">Deskripsi</Label>
                  <Textarea
                    value={bizForm.description}
                    maxLength={280}
                    rows={2}
                    onChange={(e) => setBizForm((p) => ({ ...p, description: e.target.value }))}
                  />
                </div>
                <div className="space-y-0">
                  <Label className="text-xs">Alamat</Label>
                  <Input
                    value={bizForm.address}
                    maxLength={140}
                    onChange={(e) => setBizForm((p) => ({ ...p, address: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-0">
                    <Label className="text-xs">Jam operasional</Label>
                    <Input
                      value={bizForm.hours}
                      maxLength={80}
                      onChange={(e) => setBizForm((p) => ({ ...p, hours: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-0">
                    <Label className="text-xs">Kontak</Label>
                    <Input
                      value={bizForm.contact}
                      maxLength={80}
                      onChange={(e) => setBizForm((p) => ({ ...p, contact: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-0">
                  <Label className="text-xs">Pesan sapaan</Label>
                  <Textarea
                    value={bizForm.greeting}
                    maxLength={200}
                    rows={2}
                    onChange={(e) => setBizForm((p) => ({ ...p, greeting: e.target.value }))}
                  />
                </div>
                <div className="space-y-0">
                  <Label className="text-xs">Pesan tidak aktif</Label>
                  <Textarea
                    value={bizForm.away_message}
                    maxLength={200}
                    rows={2}
                    onChange={(e) => setBizForm((p) => ({ ...p, away_message: e.target.value }))}
                  />
                </div>
                <SettingRow
                  label="Profil bisnis publik"
                  description="Terlihat oleh pengguna lain lewat pencarian"
                  right={
                    <Switch
                      checked={bizForm.is_public}
                      onCheckedChange={(v) => setBizForm((p) => ({ ...p, is_public: v }))}
                    />
                  }
                />
                <Button
                  className="w-full rounded-xl"
                  disabled={savingBiz}
                  onClick={() => void saveBusiness()}
                >
                  {savingBiz ? "Menyimpan…" : "Simpan data bisnis"}
                </Button>
              </>
            ) : (
              <p className="text-sm font-medium">{myBiz.business.name}</p>
            )}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Tim</p>
              {members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 p-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {m.profile?.display_name ?? "Pengguna"}
                    </p>
                    <p className="text-xs text-muted-foreground">{ROLE_LABEL[m.role]}</p>
                  </div>
                  {canManage(role) && m.role !== "owner" && (
                    <div className="flex shrink-0 items-center gap-1">
                      <select
                        className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
                        aria-label={`Ubah peran ${m.profile?.display_name ?? "anggota"}`}
                        value={m.role}
                        onChange={(e) =>
                          void changeRole(m.id, e.target.value as BusinessMemberRow["role"])
                        }
                      >
                        {(["admin", "agent", "cashier", "viewer"] as const).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-destructive"
                        onClick={() => void removeMember(m.id)}
                      >
                        Hapus
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      </div>
    </AppShell>
  );
}
