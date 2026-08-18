import { createFileRoute, Outlet } from "@tanstack/react-router";

/** Layout hub Bisnis. Tiap segmen (Katalog/Tugas/Kelola) merender layarnya sendiri. */
export const Route = createFileRoute("/business")({
  component: () => <Outlet />,
});
