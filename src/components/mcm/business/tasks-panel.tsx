import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { CreatePreparationDialog } from "@/components/mcm/prepare-parts";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { BusinessSegments } from "@/components/mcm/business/segments";
import { BusinessHubEmpty } from "@/components/mcm/business/hub-empty";
import { EmptyState, LoadingSkeleton } from "@/components/mcm/primitives";
import { EmployeeTaskCard, ManagerTaskCard } from "@/components/mcm/task-parts";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useRequireAuth } from "@/lib/api/guard";
import { canManage, myBusiness } from "@/lib/api/business";
import {
  listAssignedJobs,
  listBusinessEmployees,
  listBusinessJobs,
  type JobWithItems,
} from "@/lib/api/tasks";


const TAB_STATUSES: Record<string, string[] | null> = {
  semua: null,
  dikirim: ["draft", "sent"],
  diproses: ["opened", "in_progress", "ready"],
  selesai: ["completed", "cancelled"],
};

export function TasksPanel() {
  const { userId, loading } = useRequireAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  const {
    data: biz,
    isLoading: bizLoading,
    error: bizError,
    refetch: refetchBiz,
  } = useQuery({
    queryKey: ["my-business", userId],
    queryFn: () => myBusiness(userId!),
    enabled: !!userId,
  });

  const isManager = canManage(biz?.role);
  const businessId = biz?.business.id;

  const jobsQuery = useQuery({
    queryKey: ["tasks", "business", businessId],
    queryFn: () => listBusinessJobs(businessId!),
    enabled: !!businessId && isManager,
  });

  const myJobsQuery = useQuery({
    queryKey: ["tasks", "assigned", userId],
    queryFn: () => listAssignedJobs(userId!),
    enabled: !!userId && !isManager && !bizLoading,
  });

  const employeesQuery = useQuery({
    queryKey: ["tasks", "employees", businessId],
    queryFn: () => listBusinessEmployees(businessId!),
    enabled: !!businessId && isManager,
  });

  useEffect(() => {
    if (!businessId) return;
    const channel = supabase
      .channel(`tasks-rt-${businessId}-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "preparation_jobs" }, () => {
        void qc.invalidateQueries({ queryKey: ["tasks"] });
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "preparation_job_items" },
        () => {
          void qc.invalidateQueries({ queryKey: ["tasks"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [businessId, userId, qc]);

  const [tab, setTab] = useState("semua");
  const [employeeFilter, setEmployeeFilter] = useState("semua");
  const [customerQuery, setCustomerQuery] = useState("");

  const employeeById = useMemo(
    () => new Map((employeesQuery.data ?? []).map((e) => [e.id, e.name])),
    [employeesQuery.data],
  );

  const filteredManagerJobs = useMemo(() => {
    const all = jobsQuery.data ?? [];
    const statuses = TAB_STATUSES[tab];
    return all
      .filter((j) => (statuses ? statuses.includes(j.status) : true))
      .filter((j) => (employeeFilter === "semua" ? true : j.assigned_user_id === employeeFilter))
      .filter((j) => j.customer_name.toLowerCase().includes(customerQuery.trim().toLowerCase()));
  }, [jobsQuery.data, tab, employeeFilter, customerQuery]);

  const refreshManager = () =>
    void qc.invalidateQueries({ queryKey: ["tasks", "business", businessId] });

  if (loading || bizLoading) {
    return (
      <AppShell header={<MobileHeader title="Bisnis" />}>
        <LoadingSkeleton rows={5} />
      </AppShell>
    );
  }

  if (!bizError && !biz) return <BusinessHubEmpty userId={userId!} />;

  if (bizError || !biz) {
    return (
      <AppShell header={<MobileHeader title="Bisnis" />}>
        <BusinessSegments />
        <EmptyState
          icon={ClipboardList}
          title={bizError ? "Gagal memuat data" : "Belum bergabung ke bisnis"}
          description={
            bizError instanceof Error
              ? bizError.message
              : "Buat atau gabung ke sebuah bisnis untuk melihat tugas penyiapan."
          }
          action={
            bizError ? (
              <Button className="h-11 rounded-xl" onClick={() => void refetchBiz()}>
                Coba lagi
              </Button>
            ) : (
              <Button
                className="h-11 rounded-xl"
                onClick={() => void navigate({ to: "/business" })}
              >
                Buka pengaturan bisnis
              </Button>
            )
          }
        />
      </AppShell>
    );
  }

  if (isManager) {
    return (
      <AppShell
        header={
          <MobileHeader
            title="Bisnis"
            subtitle="Perintah penyiapan"
            actions={
              <Button size="sm" className="h-11 rounded-xl" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" /> Buat
              </Button>
            }
          >
            <BusinessSegments />
          </MobileHeader>
        }
      >
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full justify-start overflow-x-auto rounded-none border-b border-border bg-transparent px-2">
            <TabsTrigger value="semua">Semua</TabsTrigger>
            <TabsTrigger value="dikirim">Dikirim</TabsTrigger>
            <TabsTrigger value="diproses">Diproses</TabsTrigger>
            <TabsTrigger value="selesai">Selesai</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="grid grid-cols-2 gap-2 p-4">
          <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Pegawai" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="semua">Semua pegawai</SelectItem>
              {(employeesQuery.data ?? []).map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={customerQuery}
            onChange={(e) => setCustomerQuery(e.target.value)}
            placeholder="Cari pelanggan"
            maxLength={60}
          />
        </div>

        {jobsQuery.isLoading ? (
          <LoadingSkeleton rows={5} />
        ) : jobsQuery.error ? (
          <EmptyState
            icon={ClipboardList}
            title="Gagal memuat tugas"
            description={
              jobsQuery.error instanceof Error ? jobsQuery.error.message : "Terjadi kesalahan"
            }
            action={
              <Button className="rounded-xl" onClick={() => void jobsQuery.refetch()}>
                Coba lagi
              </Button>
            }
          />
        ) : filteredManagerJobs.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Belum ada tugas"
            description="Buat perintah penyiapan untuk pelanggan; tautan dan barcode dikirim otomatis ke PIN MCM pegawai."
            action={
              <Button className="h-11 rounded-xl" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" /> Buat Penyiapan
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2 p-4">
            {filteredManagerJobs.map((job: JobWithItems) => (
              <li key={job.id}>
                <ManagerTaskCard
                  job={job}
                  employeeName={employeeById.get(job.assigned_user_id) ?? "Pegawai"}
                  onChanged={refreshManager}
                />
              </li>
            ))}
          </ul>
        )}

        <Button
          className="fixed right-4 bottom-[calc(max(env(safe-area-inset-bottom),var(--mcm-kb,0px))+4.75rem)] z-40 h-14 rounded-full px-5 shadow-lg"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-5" /> Buat Penyiapan
        </Button>

        {businessId && (
          <CreatePreparationDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            businessId={businessId}
            onCreated={() => {
              setTab("semua");
              refreshManager();
            }}
          />
        )}
      </AppShell>
    );
  }

  return (
    <AppShell
      header={
        <MobileHeader title="Bisnis" subtitle="Tugas saya">
          <BusinessSegments />
        </MobileHeader>
      }
    >
      {myJobsQuery.isLoading ? (
        <LoadingSkeleton rows={5} />
      ) : myJobsQuery.error ? (
        <EmptyState
          icon={ClipboardList}
          title="Gagal memuat tugas"
          description={
            myJobsQuery.error instanceof Error ? myJobsQuery.error.message : "Terjadi kesalahan"
          }
          action={
            <Button className="rounded-xl" onClick={() => void myJobsQuery.refetch()}>
              Coba lagi
            </Button>
          }
        />
      ) : (myJobsQuery.data ?? []).length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Belum ada tugas"
          description="Tugas penyiapan yang ditugaskan kepada Anda akan muncul di sini."
        />
      ) : (
        <ul className="space-y-2 p-4">
          {(myJobsQuery.data ?? []).map((job) => (
            <li key={job.id}>
              <EmployeeTaskCard job={job} />
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
