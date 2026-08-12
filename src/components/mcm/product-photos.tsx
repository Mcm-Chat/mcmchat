import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, ExternalLink, ImagePlus, MapPin, RefreshCw, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fileToDataUrl, mapsUrlFor } from "@/lib/mcm/geo";
import { isValidLocationUrl, reindexPhotos, uid } from "@/lib/mcm/store";
import type { ProductPhoto } from "@/lib/mcm/types";

export const emptyPhoto = (productId: string, imageUrl: string, sortOrder: number): ProductPhoto => ({
  id: uid("pp"),
  productId,
  imageUrl,
  locationUrl: "",
  caption: "",
  sortOrder,
  createdAt: new Date().toISOString(),
});

async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link lokasi disalin");
  } catch {
    toast.error("Tidak bisa menyalin link");
  }
}

/** Editor multi-foto: setiap foto punya kolom link lokasi sendiri. */
export function ProductPhotoEditor({
  productId,
  photos,
  onChange,
}: {
  productId: string;
  photos: ProductPhoto[];
  onChange: (next: ProductPhoto[]) => void;
}) {
  const addRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const selectedIds = selected.filter((id) => photos.some((p) => p.id === id));
  const allSelected = photos.length > 0 && selectedIds.length === photos.length;

  const patch = (id: string, part: Partial<ProductPhoto>) =>
    onChange(photos.map((p) => (p.id === id ? { ...p, ...part } : p)));

  const toggleSelect = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const applyLocationTo = (ids: string[]) => {
    if (ids.length === 0) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Perangkat ini tidak mendukung GPS");
      return;
    }
    toast.info("Mengambil lokasi…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const url = mapsUrlFor(pos.coords.latitude, pos.coords.longitude);
        onChange(photos.map((p) => (ids.includes(p.id) ? { ...p, locationUrl: url } : p)));
        toast.success(
          ids.length === 1 ? "Link lokasi dibuat dari GPS" : `Lokasi diterapkan ke ${ids.length} foto terpilih`,
        );
      },
      () => toast.error("Lokasi tidak tersedia. Tempel link Maps secara manual."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const added: ProductPhoto[] = [];
      for (const f of Array.from(files)) {
        const url = await fileToDataUrl(f, 720);
        added.push(emptyPhoto(productId, url, photos.length + added.length));
      }
      onChange(reindexPhotos([...photos, ...added]));
      toast.success(`${added.length} foto ditambahkan`);
    } catch {
      toast.error("Gagal memproses foto");
    } finally {
      setBusy(false);
    }
  };

  const replaceFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f || !replaceId) return;
    setBusy(true);
    try {
      const url = await fileToDataUrl(f, 720);
      patch(replaceId, { imageUrl: url });
      toast.success("Foto diganti, link lokasi tetap");
    } catch {
      toast.error("Gagal memproses foto");
    } finally {
      setBusy(false);
      setReplaceId(null);
    }
  };

  const takeLocation = (id: string) => applyLocationTo([id]);

  const move = (index: number, dir: -1 | 1) => {
    const next = [...photos];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    const a = next[index]!;
    const b = next[target]!;
    next[index] = b;
    next[target] = a;
    onChange(reindexPhotos(next));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Foto produk & lokasi</Label>
        <span className="text-[11px] text-muted-foreground">{photos.length} foto</span>
      </div>

      <input
        ref={addRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={replaceRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void replaceFile(e.target.files);
          e.target.value = "";
        }}
      />

      <Button
        type="button"
        variant="outline"
        className="w-full rounded-xl"
        disabled={busy}
        onClick={() => addRef.current?.click()}
      >
        <ImagePlus className="size-4" /> Tambah foto
      </Button>

      {photos.length > 1 && (
        <div className="card-soft space-y-2 p-3" data-testid="bulk-location-bar">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs font-medium">
              <Checkbox
                checked={allSelected}
                aria-label="Pilih semua foto"
                onCheckedChange={(v) => setSelected(v === true ? photos.map((p) => p.id) : [])}
              />
              Pilih semua
            </label>
            <span className="text-[11px] text-muted-foreground">{selectedIds.length} dipilih</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full rounded-lg text-[11px]"
            disabled={selectedIds.length === 0}
            onClick={() => applyLocationTo(selectedIds)}
          >
            <MapPin className="size-3.5" /> Ambil Lokasi Saat Ini untuk {selectedIds.length || 0} foto terpilih
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Foto yang tidak dipilih tetap memakai link lokasinya sendiri.
          </p>
        </div>
      )}

      {photos.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          Belum ada foto. Setiap foto bisa punya link lokasi berbeda.
        </p>
      )}

      <div className="space-y-3">
        {photos.map((ph, i) => {
          const invalid = !isValidLocationUrl(ph.locationUrl);
          return (
            <div key={ph.id} className="card-soft space-y-2 p-3" data-testid={`photo-editor-${i + 1}`}>
              <div className="flex gap-3">
                <img
                  src={ph.imageUrl}
                  alt={ph.caption || `Foto produk ${i + 1}`}
                  className="size-20 shrink-0 rounded-xl object-cover"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs font-semibold">
                      <Checkbox
                        checked={selectedIds.includes(ph.id)}
                        aria-label={`Pilih foto ${i + 1}`}
                        onCheckedChange={() => toggleSelect(ph.id)}
                      />
                      Foto {i + 1}
                    </label>
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="ghost" size="icon" className="size-8 rounded-lg" aria-label={`Naikkan foto ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="size-8 rounded-lg" aria-label={`Turunkan foto ${i + 1}`} disabled={i === photos.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-lg"
                        aria-label={`Ganti foto ${i + 1}`}
                        onClick={() => {
                          setReplaceId(ph.id);
                          replaceRef.current?.click();
                        }}
                      >
                        <RefreshCw className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-lg text-destructive"
                        aria-label={`Hapus foto ${i + 1}`}
                        onClick={() => onChange(reindexPhotos(photos.filter((x) => x.id !== ph.id)))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <Input
                    value={ph.caption}
                    maxLength={60}
                    placeholder="Keterangan foto (opsional)"
                    aria-label={`Keterangan foto ${i + 1}`}
                    className="h-9 rounded-lg text-xs"
                    onChange={(e) => patch(ph.id, { caption: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Link Lokasi</Label>
                <Input
                  value={ph.locationUrl}
                  placeholder="https://maps.google.com/…"
                  aria-label={`Link lokasi foto ${i + 1}`}
                  className={`h-9 rounded-lg text-xs ${invalid ? "border-destructive" : ""}`}
                  onChange={(e) => patch(ph.id, { locationUrl: e.target.value })}
                />
                {invalid && <p className="text-[11px] text-destructive">URL tidak valid. Gunakan tautan http(s).</p>}
                <div className="flex flex-wrap gap-1.5">
                  <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg text-[11px]" onClick={() => takeLocation(ph.id)}>
                    <MapPin className="size-3.5" /> Ambil Lokasi Saat Ini
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg text-[11px]"
                    disabled={!ph.locationUrl.trim()}
                    onClick={() => void copyLink(ph.locationUrl)}
                  >
                    <Copy className="size-3.5" /> Salin Link
                  </Button>
                  {ph.locationUrl.trim() && !invalid && (
                    <a
                      href={ph.locationUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px]"
                    >
                      <ExternalLink className="size-3.5" /> Buka
                    </a>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Galeri foto pada detail produk: tombol lokasi selalu memakai link foto itu sendiri. */
export function ProductGallery({ photos }: { photos: ProductPhoto[] }) {
  if (photos.length === 0) {
    return <p className="text-xs text-muted-foreground">Belum ada foto untuk produk ini.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {photos.map((ph, i) => (
        <div key={ph.id} className="card-soft overflow-hidden" data-testid={`gallery-photo-${i + 1}`}>
          <img src={ph.imageUrl} alt={ph.caption || `Foto produk ${i + 1}`} className="h-32 w-full object-cover" />
          <div className="space-y-2 p-3">
            <p className="truncate text-xs font-semibold">{ph.caption || `Foto ${i + 1}`}</p>
            {ph.locationUrl.trim() ? (
              <>
                <p className="truncate text-[11px] text-muted-foreground">{ph.locationUrl}</p>
                <div className="flex gap-1.5">
                  <a
                    href={ph.locationUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Buka Lokasi foto ${i + 1}`}
                    className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-primary px-2 text-[11px] font-medium text-primary-foreground"
                  >
                    <MapPin className="size-3.5" /> Buka Lokasi
                  </a>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg text-[11px]"
                    aria-label={`Salin Link foto ${i + 1}`}
                    onClick={() => void copyLink(ph.locationUrl)}
                  >
                    <Copy className="size-3.5" /> Salin Link
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">Tanpa link lokasi.</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
