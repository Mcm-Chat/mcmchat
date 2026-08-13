import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, MessageCircle, QrCode, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/mcm/primitives";
import { waktuRelatif } from "@/lib/mcm/format";
import { recallToken, rememberToken } from "@/lib/api/prepare";
import {
  revokeTaskJob,
  rotateTaskToken,
  taskUrl,
  TASK_STATUS_LABEL,
  type JobWithItems,
} from "@/lib/api/tasks";

export function taskStatusTone(
  status: string,
): "success" | "warning" | "neutral" | "danger" | "primary" {
  if (status === "completed") return "success";
  if (status === "cancelled") return "danger";
  if (status === "draft" || status === "sent") return "neutral";
  return "warning";
}

export function TaskStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant={
        status === "completed" ? "default" : status === "cancelled" ? "destructive" : "secondary"
      }
    >
      {TASK_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

export function progressOf(job: JobWithItems) {
  const total = job.items.length;
  const done = job.items.filter((i) => i.status === "done").length;
  return { done, total };
}

export function ManagerTaskCard({
  job,
  employeeName,
  onChanged,
}: {
  job: JobWithItems;
  employeeName: string;
  onChanged: () => void;
}) {
  const [qrOpen, setQrOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [token, setToken] = useState<string | null>(() => recallToken(job.id));
  const [busy, setBusy] = useState(false);
  const url = token ? taskUrl(token) : "";
  const expired = new Date(job.expires_at).getTime() < Date.now() || !!job.revoked_at;
  const { done, total } = progressOf(job);

  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast.success("Tautan tugas disalin");
  };

  const rotate = async () => {
    setBusy(true);
    try {
      const res = await rotateTaskToken(job.id);
      rememberToken(job.id, res.token);
      setToken(res.token);
      toast.success("Tautan baru diterbitkan; tautan lama tidak berlaku");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menerbitkan tautan");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await revokeTaskJob(job.id);
      toast.success("Tautan tugas dicabut");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mencabut tautan");
    } finally {
      setBusy(false);
      setRevokeOpen(false);
    }
  };

  return (
    <div className="card-soft space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{job.code}</span>
        <TaskStatusBadge status={job.status} />
        {expired && !job.revoked_at && <Badge variant="destructive">Tautan nonaktif</Badge>}
      </div>
      <p className="truncate text-xs text-muted-foreground">
        Pelanggan: {job.customer_name || "—"} · Pegawai: {employeeName}
      </p>
      <p className="text-xs text-muted-foreground">
        {total} item · {done}/{total} selesai · {waktuRelatif(job.created_at)}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" className="rounded-lg" asChild>
          <Link to="/tasks/$id" params={{ id: job.id }}>
            Buka detail
          </Link>
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="rounded-lg"
          disabled={!token}
          onClick={() => setQrOpen(true)}
        >
          <QrCode className="size-4" /> Barcode
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="rounded-lg"
          disabled={!token}
          onClick={() => void copy()}
        >
          <Copy className="size-4" /> Salin link
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-lg"
          disabled={busy}
          onClick={() => void rotate()}
        >
          <RefreshCw className="size-4" /> Terbitkan ulang
        </Button>
        {job.conversation_id && (
          <Button size="sm" variant="ghost" className="rounded-lg" asChild>
            <Link to="/chat/$id" params={{ id: job.conversation_id }}>
              <MessageCircle className="size-4" /> Buka Chat
            </Link>
          </Button>
        )}
        {!job.revoked_at && (
          <Button
            size="sm"
            variant="ghost"
            className="rounded-lg text-destructive"
            onClick={() => setRevokeOpen(true)}
          >
            <X className="size-4" /> Cabut
          </Button>
        )}
      </div>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-[340px] rounded-2xl text-center">
          <DialogHeader>
            <DialogTitle>{job.code}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            {url && <QRCodeSVG value={url} size={240} includeMargin />}
            <p className="break-all text-[11px] text-muted-foreground">{url}</p>
            <Button variant="secondary" className="w-full rounded-xl" onClick={() => void copy()}>
              <Copy className="size-4" /> Salin tautan
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title="Cabut tugas ini?"
        description="Tautan dan barcode yang sudah dibagikan langsung tidak berlaku lagi."
        confirmLabel="Cabut"
        destructive
        onConfirm={() => void revoke()}
      />
    </div>
  );
}

export function EmployeeTaskCard({ job }: { job: JobWithItems }) {
  const { done, total } = progressOf(job);
  const token = recallToken(job.id);
  return (
    <div className="card-soft space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{job.code}</span>
        <TaskStatusBadge status={job.status} />
      </div>
      <p className="truncate text-xs text-muted-foreground">
        Pelanggan: {job.customer_name || "—"}
      </p>
      <p className="text-xs text-muted-foreground">
        {done}/{total} item selesai · {waktuRelatif(job.created_at)}
      </p>
      <div className="flex flex-wrap gap-2">
        {token ? (
          <Button size="sm" className="rounded-lg" asChild>
            <a href={taskUrl(token)}>Buka halaman penyiapan</a>
          </Button>
        ) : (
          <Button size="sm" variant="secondary" className="rounded-lg" asChild>
            <Link to="/tasks/$id" params={{ id: job.id }}>
              Lihat detail
            </Link>
          </Button>
        )}
        {job.conversation_id && (
          <Button size="sm" variant="ghost" className="rounded-lg" asChild>
            <Link to="/chat/$id" params={{ id: job.conversation_id }}>
              <MessageCircle className="size-4" /> Buka Chat
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
