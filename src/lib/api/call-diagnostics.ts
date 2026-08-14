import { supabase } from "@/integrations/supabase/client";
import type { DiagnosticResult } from "@/lib/calls/diagnostics";

export type DiagnosticRun = {
  id: string;
  kind: string;
  status: "pass" | "fail" | "warn";
  latency_ms: number | null;
  code: string;
  detail: string;
  created_at: string;
};

/** Menyimpan satu hasil tes diagnostik ke riwayat milik pengguna login. */
export async function recordDiagnosticRun(userId: string, r: DiagnosticResult, kind = "livekit") {
  const status = r.status === "pending" ? "warn" : r.status;
  const { error } = await supabase.from("call_diagnostic_runs").insert({
    user_id: userId,
    kind,
    status,
    latency_ms: r.latencyMs ?? null,
    code: r.code ?? "",
    detail: r.detail,
  });
  if (error) throw new Error("Hasil tes gagal disimpan ke riwayat.");
}

export async function listDiagnosticRuns(limit = 20): Promise<DiagnosticRun[]> {
  const { data, error } = await supabase
    .from("call_diagnostic_runs")
    .select("id, kind, status, latency_ms, code, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Riwayat diagnostik gagal dimuat.");
  return (data ?? []) as DiagnosticRun[];
}

export async function clearDiagnosticRuns(userId: string) {
  const { error } = await supabase.from("call_diagnostic_runs").delete().eq("user_id", userId);
  if (error) throw new Error("Riwayat diagnostik gagal dihapus.");
}
