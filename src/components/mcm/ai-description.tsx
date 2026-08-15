import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { generateProductDescription } from "@/lib/ai/product-copy.functions";

type Tone = "ringkas" | "persuasif" | "formal";
const TONES: Array<{ id: Tone; label: string }> = [
  { id: "ringkas", label: "Ringkas" },
  { id: "persuasif", label: "Persuasif" },
  { id: "formal", label: "Formal" },
];

/** Tombol + dialog untuk menyusun deskripsi produk dengan AI. */
export function AiDescriptionButton({
  name,
  category,
  price,
  currentDescription,
  onApply,
}: {
  name: string;
  category?: string | undefined;
  price?: number | undefined;
  currentDescription?: string | undefined;
  onApply: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [specs, setSpecs] = useState("");
  const [tone, setTone] = useState<Tone>("ringkas");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const generate = useServerFn(generateProductDescription);

  const run = async () => {
    if (name.trim().length < 2) {
      toast.error("Isi nama produk dulu");
      return;
    }
    setBusy(true);
    try {
      const res = await generate({
        data: {
          name: name.trim(),
          category: category?.trim() ?? "",
          price: Number.isFinite(price) ? price : undefined,
          specs: [specs.trim(), currentDescription?.trim()]
            .filter(Boolean)
            .join("\n")
            .slice(0, 2000),
          tone,
        },
      });
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      setDraft(res.description);
    } catch {
      toast.error("Gagal membuat deskripsi");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 rounded-xl"
        onClick={() => setOpen(true)}
      >
        <Sparkles className="mr-1.5 size-4" /> Buat dengan AI
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Deskripsi produk dengan AI</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Spesifikasi / catatan</Label>
              <Textarea
                value={specs}
                onChange={(e) => setSpecs(e.target.value)}
                rows={3}
                placeholder="Contoh: berat 250 g, biji arabika Gayo, roast medium, kemasan zipper"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map((t) => (
                <Button
                  key={t.id}
                  type="button"
                  variant={tone === t.id ? "default" : "outline"}
                  size="sm"
                  className="h-9 rounded-xl"
                  onClick={() => setTone(t.id)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
            <Button type="button" className="w-full rounded-xl" onClick={run} disabled={busy}>
              {busy ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 size-4" />
              )}
              {draft ? "Buat ulang" : "Buat deskripsi"}
            </Button>
            {draft ? (
              <div className="space-y-1.5">
                <Label>Hasil (bisa diedit)</Label>
                <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={7} />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              className="w-full rounded-xl"
              disabled={!draft.trim()}
              onClick={() => {
                onApply(draft.trim());
                setOpen(false);
                toast.success("Deskripsi diterapkan");
              }}
            >
              Pakai deskripsi ini
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
