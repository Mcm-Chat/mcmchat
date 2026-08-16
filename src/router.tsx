import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { PageSkeleton } from "@/components/mcm/route-skeletons";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Tidak pernah layar kosong saat rute berat diunduh: kerangka halaman
    // standar tampil hampir seketika dan bertahan minimal sesaat.
    defaultPendingComponent: () => <PageSkeleton />,
    defaultPendingMs: 120,
    defaultPendingMinMs: 300,
  });

  return router;
};
