/**
 * Pembungkus lazy untuk modul UI berat (pemindai QR memuat jsQR, editor foto
 * memuat kanvas anotasi). Keduanya hanya diunduh saat benar-benar dibuka,
 * sehingga layar utama tetap ringan di ponsel.
 */
import { Suspense, lazy, type ComponentProps } from "react";
import { OverlayLoading } from "./route-skeletons";

const QrScannerLazy = lazy(() =>
  import("./qr-scanner").then((m) => ({ default: m.QrScannerDialog })),
);
const PhotoEditorLazy = lazy(() =>
  import("./photo-editor").then((m) => ({ default: m.PhotoEditorDialog })),
);
const SaleDialogLazy = lazy(() =>
  import("./sale-dialog").then((m) => ({ default: m.SaleDialog })),
);
const LedgerFormDialogLazy = lazy(() =>
  import("./ledger-form").then((m) => ({ default: m.LedgerFormDialog })),
);
const ForwardDialogLazy = lazy(() =>
  import("./forward-dialog").then((m) => ({ default: m.ForwardDialog })),
);
const AvatarEditorLazy = lazy(() =>
  import("./avatar-editor").then((m) => ({ default: m.AvatarEditor })),
);

export function QrScannerDialog(props: ComponentProps<typeof QrScannerLazy>) {
  if (!props.open) return null;
  return (
    <Suspense fallback={<OverlayLoading label="Menyiapkan pemindai QR…" />}>
      <QrScannerLazy {...props} />
    </Suspense>
  );
}

export function PhotoEditorDialog(props: ComponentProps<typeof PhotoEditorLazy>) {
  return (
    <Suspense fallback={<OverlayLoading label="Menyiapkan editor foto…" />}>
      <PhotoEditorLazy {...props} />
    </Suspense>
  );
}

/**
 * Dialog berat lain: hanya diunduh saat dibuka. Gerbang `open` penting —
 * tanpa itu React tetap me-resolve chunk saat layar pertama dirender.
 */
export function SaleDialog(props: ComponentProps<typeof SaleDialogLazy>) {
  if (!props.open) return null;
  return (
    <Suspense fallback={<OverlayLoading label="Menyiapkan penjualan…" />}>
      <SaleDialogLazy {...props} />
    </Suspense>
  );
}

export function LedgerFormDialog(props: ComponentProps<typeof LedgerFormDialogLazy>) {
  if (!props.open) return null;
  return (
    <Suspense fallback={<OverlayLoading label="Menyiapkan catatan…" />}>
      <LedgerFormDialogLazy {...props} />
    </Suspense>
  );
}

export function ForwardDialog(props: ComponentProps<typeof ForwardDialogLazy>) {
  if (!props.open) return null;
  return (
    <Suspense fallback={<OverlayLoading label="Menyiapkan teruskan…" />}>
      <ForwardDialogLazy {...props} />
    </Suspense>
  );
}

export function AvatarEditor(props: ComponentProps<typeof AvatarEditorLazy>) {
  return (
    <Suspense fallback={<OverlayLoading label="Menyiapkan editor foto profil…" />}>
      <AvatarEditorLazy {...props} />
    </Suspense>
  );
}
