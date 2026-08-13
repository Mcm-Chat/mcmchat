import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, MessageCircle } from "lucide-react";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { EmptyState, LoadingSkeleton } from "@/components/mcm/primitives";
import { ManagerTaskCard, TaskStatusBadge } from "@/components/mcm/task-parts";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useRequireAuth } from "@/lib/api/guard";
import { canManage, myBusiness } from "@/lib/api/business";
import { getJobDetail, listBusinessEmployees, listItemPhotos } from "@/lib/api/tasks";
import { useSignedUrl } from "@/lib/api/use-signed-url";
import { tanggalPanjang, waktuRelatif } from "@/lib/mcm/format";

export const Route = createFileRoute("/tasks/$id")({
  head: () => ({
    meta: [
      { title: "Detail Tugas — MCM" },
      {
        name: "description",
        content: "Rincian perintah penyiapan: item, jumlah, foto, dan lokasi.",
      },
      { property: "og:title", content: "Detail Tugas — MCM" },
      { property: "og:description", content: "Rincian tugas penyiapan MCM." },
    ],
  }),
  component: TaskDetail,
});

function PhotoRow({
  photo,
}: {
  photo: {
    id: string;
    storage_path: string;
    caption: string;
    location_label: string;
    maps_url: string;
  };
}) {
  const url = useSignedUrl("product-photos", photo.storage_path);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border p-2">
      {url ? (
        <img
          src={url}
          alt={photo.caption || "Foto tugas"}
          className="size-16 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <div className="size-16 shrink-0 rounded-lg bg-muted" />
      )}
      <div className="min-w-0 flex-1 text-xs">
        {photo.caption && <p className="truncate font-medium">{photo.caption}</p>}
        {photo.location_label && (
          <p className="truncate text-muted-foreground">{photo.location_label}</p>
        )}
        {photo.maps_url && (
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
            <a href={photo.maps_url} target="_blank" rel="noreferrer">
              <MapPin className="mr-1 size-3" /> Buka Lokasi
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

function TaskDetail() {
  const { id } = Route.useParams();
  const { userId, loading } = useRequireAuth();
  const qc = useQueryClient();

  const { data: biz } = useQuery({
    queryKey: ["my-business", userId],
    queryFn: () => myBusiness(userId!),
    enabled: !!userId,
  });
  const isManager = canManage(biz?.role);

  const jobQuery = useQuery({
    queryKey: ["tasks", "detail", id],
    queryFn: () => getJobDetail(id),
    enabled: !!id,
  });

  const photosQuery = useQuery({
    queryKey: ["tasks", "photos", id],
    queryFn: () => listItemPhotos(id),
    enabled: !!id,
  });

  const employeesQuery = useQuery({
    queryKey: ["tasks", "employees", biz?.business.id],
    queryFn: () => listBusinessEmployees(biz!.business.id),
    enabled: !!biz?.business.id && isManager,
  });

  useEffect(() => {
    const channel = supabase
      .channel(`task-detail-rt-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "preparation_jobs", filter: `id=eq.${id}` },
        () => {
          void qc.invalidateQueries({ queryKey: ["tasks", "detail", id] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "preparation_job_items", filter: `job_id=eq.${id}` },
        () => {
          void qc.invalidateQueries({ queryKey: ["tasks", "detail", id] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "preparation_item_photos",
          filter: `job_id=eq.${id}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ["tasks", "photos", id] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, qc]);

  if (loading || jobQuery.isLoading) {
    return (
      <AppShell header={<MobileHeader title="Detail Tugas" back variant="gradient" />}>
        <LoadingSkeleton rows={5} />
      </AppShell>
    );
  }

  if (jobQuery.error || !jobQuery.data) {
    return (
      <AppShell header={<MobileHeader title="Detail Tugas" back variant="gradient" />}>
        <EmptyState
          title="Tugas tidak ditemukan"
          icon={MessageCircle}
          description={
            jobQuery.error instanceof Error
              ? jobQuery.error.message
              : "Tugas mungkin sudah dihapus."
          }
          action={
            <Button className="rounded-xl" onClick={() => void jobQuery.refetch()}>
              Coba lagi
            </Button>
          }
        />
      </AppShell>
    );
  }

  const job = jobQuery.data;
  const employeeName =
    (employeesQuery.data ?? []).find((e) => e.id === job.assigned_user_id)?.name ?? "Pegawai";
  const photosByItem = new Map<string, typeof photosQuery.data>();
  for (const p of photosQuery.data ?? []) {
    const list = photosByItem.get(p.job_item_id) ?? [];
    list.push(p);
    photosByItem.set(p.job_item_id, list);
  }

  return (
    <AppShell header={<MobileHeader title={job.code} back variant="gradient" />}>
      <div className="space-y-3 p-3">
        {isManager && (
          <ManagerTaskCard
            job={job}
            employeeName={employeeName}
            onChanged={() => void jobQuery.refetch()}
          />
        )}

        {!isManager && (
          <div className="card-soft space-y-2 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{job.code}</span>
              <TaskStatusBadge status={job.status} />
            </div>
            <p className="text-xs text-muted-foreground">Pelanggan: {job.customer_name || "—"}</p>
            <p className="text-xs text-muted-foreground">
              Kedaluwarsa: {tanggalPanjang(job.expires_at)}
            </p>
            {job.notes && (
              <p className="rounded-lg bg-muted px-2 py-1.5 text-xs">Catatan: {job.notes}</p>
            )}
            {job.conversation_id && (
              <Button size="sm" variant="secondary" className="rounded-lg" asChild>
                <Link to="/chat/$id" params={{ id: job.conversation_id }}>
                  <MessageCircle className="size-4" /> Buka Chat
                </Link>
              </Button>
            )}
          </div>
        )}

        <div className="card-soft space-y-3 p-3">
          <h2 className="text-sm font-semibold">Item tugas</h2>
          <p className="text-xs text-muted-foreground">Dibuat {waktuRelatif(job.created_at)}</p>
          <ul className="space-y-3">
            {job.items.map((item) => (
              <li
                key={item.id}
                className="space-y-2 border-t border-border pt-2 first:border-t-0 first:pt-0"
              >
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate font-medium">
                    {item.product_name} — {item.variant_name}
                  </span>
                  <TaskStatusBadge status={item.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Diminta: {Number(item.requested_qty)} {item.requested_unit} · Aktual:{" "}
                  {item.actual_qty_base === null
                    ? "belum diisi"
                    : `${Number(item.actual_qty_base)} (satuan dasar)`}
                </p>
                {item.notes && (
                  <p className="rounded-lg bg-muted px-2 py-1 text-xs">{item.notes}</p>
                )}
                {job.status === "completed" && (photosByItem.get(item.id) ?? []).length > 0 && (
                  <div className="space-y-1.5">
                    {(photosByItem.get(item.id) ?? []).map((p) => (
                      <PhotoRow key={p!.id} photo={p!} />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
