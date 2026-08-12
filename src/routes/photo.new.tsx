import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { LoadingSkeleton } from "@/components/mcm/primitives";
import { PhotoFlow } from "@/components/mcm/photo-parts";
import { useRequireAuth } from "@/lib/api/guard";
import { qk, useConversations } from "@/lib/api/queries";

export const Route = createFileRoute("/photo/new")({
  head: () => ({
    meta: [
      { title: "Kirim Foto & Lokasi — MCM" },
      { name: "description", content: "Pilih penerima, ambil foto, sertakan lokasi GPS, lalu kirim dalam satu pesan." },
      { property: "og:title", content: "Kirim Foto & Lokasi — MCM" },
      { property: "og:description", content: "Foto dan lokasi terkirim menyatu dalam satu pesan." },
    ],
  }),
  component: PhotoNew,
});

function PhotoNew() {
  const { userId, loading } = useRequireAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: conversations, isLoading } = useConversations(userId);

  return (
    <AppShell nav={false} header={<MobileHeader title="Kirim foto" subtitle="Pilih penerima, foto, lalu lokasi" back />} className="flex flex-col">
      {loading || isLoading || !userId ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <PhotoFlow
          userId={userId}
          conversations={conversations ?? []}
          onCancel={() => void navigate({ to: "/chat" })}
          onDone={(ids, messageId) => {
            void qc.invalidateQueries({ queryKey: qk.conversations(userId) });
            void navigate({ to: "/chat/$id", params: { id: ids[0]! }, search: { hl: messageId } });
          }}
        />
      )}
    </AppShell>
  );
}
