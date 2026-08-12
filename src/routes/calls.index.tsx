import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, PhoneMissed, Phone, PhoneCall, Trash2, Video } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { ConfirmDialog, EmptyState, MCMAvatar, ProtoNote } from "@/components/mcm/primitives";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { durasi, waktuRelatif } from "@/lib/mcm/format";
import { useMCM } from "@/lib/mcm/store";

export const Route = createFileRoute("/calls/")({
  head: () => ({
    meta: [
      { title: "Panggilan — MCM" },
      { name: "description", content: "Riwayat panggilan suara dan video MCM lengkap dengan durasi dan panggilan tak terjawab." },
      { property: "og:title", content: "Panggilan — MCM" },
      { property: "og:description", content: "Riwayat panggilan suara dan video Anda." },
    ],
  }),
  component: CallsPage,
});

function CallsPage() {
  const { state, update } = useMCM();
  const [tab, setTab] = useState("semua");
  const [clear, setClear] = useState(false);

  const calls = state.calls
    .filter((c) => (tab === "takterjawab" ? c.missed : true))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <AppShell
      header={
        <MobileHeader
          title="Panggilan"
          subtitle={`${state.calls.filter((c) => c.missed).length} panggilan tak terjawab`}
          actions={
            <Button variant="ghost" size="icon" aria-label="Bersihkan riwayat" onClick={() => setClear(true)}>
              <Trash2 className="size-5" />
            </Button>
          }
        >
          <div className="px-3 pb-3">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-full rounded-xl">
                <TabsTrigger value="semua" className="flex-1 rounded-lg">
                  Semua
                </TabsTrigger>
                <TabsTrigger value="takterjawab" className="flex-1 rounded-lg">
                  Tak terjawab
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </MobileHeader>
      }
    >
      {calls.length === 0 ? (
        <EmptyState icon={PhoneCall} title="Belum ada panggilan" description="Mulai panggilan suara atau video dari halaman kontak atau ruang chat." />
      ) : (
        <ul className="divide-y divide-border/70">
          {calls.map((c) => {
            const contact = state.contacts.find((x) => x.id === c.contactId);
            return (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <MCMAvatar initials={contact?.initials ?? c.contactName.slice(0, 2)} color={contact?.avatarColor ?? "from-slate-500 to-slate-700"} />
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-semibold ${c.missed ? "text-destructive" : ""}`}>{c.contactName}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    {c.missed ? <PhoneMissed className="size-3.5 text-destructive" /> : c.direction === "in" ? <ArrowDownLeft className="size-3.5 text-success" /> : <ArrowUpRight className="size-3.5 text-primary" />}
                    {c.kind === "video" ? "Video" : "Suara"} • {c.missed ? "Tak terjawab" : durasi(c.durationSec)} • {waktuRelatif(c.at)}
                  </p>
                </div>
                <Button variant="ghost" size="icon" aria-label={`Panggil ${c.contactName}`} asChild>
                  <Link to="/call/$id" params={{ id: c.contactId }} search={{ kind: c.kind }}>
                    {c.kind === "video" ? <Video className="size-5" /> : <Phone className="size-5" />}
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="px-4 py-6">
        <ProtoNote>Panggilan berjalan dalam mode simulasi. Panggilan nyata memerlukan WebRTC dengan server signalling & TURN.</ProtoNote>
      </div>

      <ConfirmDialog
        open={clear}
        onOpenChange={setClear}
        title="Bersihkan riwayat panggilan?"
        description="Seluruh riwayat panggilan akan dihapus dari perangkat ini."
        confirmLabel="Bersihkan"
        destructive
        onConfirm={() => {
          update((d) => {
            d.calls = [];
            return d;
          });
          toast.success("Riwayat panggilan dibersihkan");
        }}
      />
    </AppShell>
  );
}
