import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import type { CallDevices } from "@/lib/calls/provider";

/**
 * Pemilih mikrofon/kamera saat panggilan berlangsung. Pergantian dilakukan
 * dengan mengganti track pada sesi yang sama — panggilan tidak terputus.
 */
export function CallDeviceSheet({
  open,
  onOpenChange,
  devices,
  micDeviceId,
  cameraDeviceId,
  onPickMic,
  onPickCamera,
  videoEnabled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  devices: CallDevices;
  micDeviceId: string | null;
  cameraDeviceId: string | null;
  onPickMic: (id: string) => void;
  onPickCamera: (id: string) => void;
  videoEnabled: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl">
        <SheetHeader className="text-left">
          <SheetTitle>Perangkat panggilan</SheetTitle>
          <SheetDescription>
            Ganti mikrofon atau kamera tanpa keluar dari panggilan.
          </SheetDescription>
        </SheetHeader>

        <div className="max-h-[55dvh] space-y-6 overflow-y-auto px-4 pb-6">
          <section aria-label="Mikrofon">
            <p className="mb-2 text-sm font-semibold">Mikrofon</p>
            {devices.mics.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada mikrofon terdeteksi.</p>
            ) : (
              <RadioGroup
                value={micDeviceId ?? undefined}
                onValueChange={onPickMic}
                className="gap-2"
              >
                {devices.mics.map((d) => (
                  <div key={d.deviceId} className="flex items-center gap-3 rounded-xl border p-3">
                    <RadioGroupItem value={d.deviceId} id={`mic-${d.deviceId}`} />
                    <Label htmlFor={`mic-${d.deviceId}`} className="flex-1 cursor-pointer text-sm">
                      {d.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}
          </section>

          <section aria-label="Kamera">
            <p className="mb-2 text-sm font-semibold">Kamera</p>
            {!videoEnabled ? (
              <p className="text-sm text-muted-foreground">
                Panggilan suara — kamera tidak dipakai.
              </p>
            ) : devices.cameras.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada kamera terdeteksi.</p>
            ) : (
              <RadioGroup
                value={cameraDeviceId ?? undefined}
                onValueChange={onPickCamera}
                className="gap-2"
              >
                {devices.cameras.map((d) => (
                  <div key={d.deviceId} className="flex items-center gap-3 rounded-xl border p-3">
                    <RadioGroupItem value={d.deviceId} id={`cam-${d.deviceId}`} />
                    <Label htmlFor={`cam-${d.deviceId}`} className="flex-1 cursor-pointer text-sm">
                      {d.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
