import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/**
 * Segmen di dalam hub Bisnis. Tiap segmen adalah rute nyata (bukan state
 * lokal) supaya bisa di-deep-link, di-refresh, dan punya metadata sendiri.
 */
export const BUSINESS_SEGMENTS = [
  { to: "/business", label: "Katalog" },
  { to: "/business/tugas", label: "Tugas" },
  { to: "/business/kelola", label: "Kelola" },
] as const;

export function BusinessSegments() {
  return (
    <nav aria-label="Segmen bisnis" className="px-4 pb-2.5">
      <ul className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
        {BUSINESS_SEGMENTS.map((s) => (
          <li key={s.to}>
            <Link
              to={s.to}
              activeOptions={{ exact: true }}
              className={cn(
                "flex h-9 items-center justify-center rounded-lg text-xs font-semibold text-muted-foreground transition-colors",
                "data-[status=active]:bg-background data-[status=active]:text-foreground data-[status=active]:shadow-sm",
              )}
            >
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
