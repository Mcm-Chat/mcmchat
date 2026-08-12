import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { PhotoFlow } from "@/components/mcm/photo-parts";

export const Route = createFileRoute("/photo/new")({
  head: () => ({
    meta: [
      { title: "Kirim Foto — MCM" },
      { name: "description", content: "Pilih penerima, ambil foto, sertakan lokasi GPS, lalu kirim ke satu atau banyak chat MCM." },
      { property: "og:title", content: "Kirim Foto — MCM" },
      { property: "og:description", content: "Kirim foto beserta lokasi ke kontak dan grup MCM." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PhotoNew,
});

function PhotoNew() {
  const navigate = useNavigate();
  return (
    <AppShell
      nav={false}
      header={
        <MobileHeader
          back
          onBack={() => {
            void navigate({ to: "/chat" });
          }}
          title="Kirim Foto"
          subtitle="Pilih penerima dulu, lalu foto dan lokasi"
        />
      }
      className="flex flex-col"
    >
      <PhotoFlow
        onCancel={() => {
          void navigate({ to: "/chat" });
        }}
        onDone={(chatIds, messageId) => {
          void navigate({ to: "/chat/$id", params: { id: chatIds[0]! }, search: { hl: messageId } });
        }}
      />
    </AppShell>
  );
}