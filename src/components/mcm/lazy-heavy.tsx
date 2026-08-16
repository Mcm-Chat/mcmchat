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
    <Suspense
      fallback={props.open ? <OverlayLoading label="Menyiapkan editor foto…" /> : null}
    >
      <PhotoEditorLazy {...props} />
    </Suspense>
  );
}
