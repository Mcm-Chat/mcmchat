import { Link } from "@tanstack/react-router";
import { Package, Printer, Download, Boxes } from "lucide-react";
import { rupiah, tanggal, waktuRelatif } from "@/lib/mcm/format";
import { orderTotal, productPrice } from "@/lib/mcm/store";
import type { Business, Order, OrderStatus, Product } from "@/lib/mcm/types";
import { StatusBadge, type Tone } from "./primitives";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export const ORDER_META: Record<OrderStatus, { label: string; tone: Tone }> = {
  baru: { label: "Baru", tone: "primary" },
  diproses: { label: "Diproses", tone: "warning" },
  dikirim: { label: "Dikirim", tone: "navy" },
  selesai: { label: "Selesai", tone: "success" },
  dibatalkan: { label: "Dibatalkan", tone: "danger" },
};

export function ProductCard({ product, onClick }: { product: Product; onClick: () => void }) {
  const final = productPrice(product);
  const cover = (product.photos ?? [])[0];
  return (
    <button
      type="button"
      onClick={onClick}
      className="card-soft flex w-full flex-col overflow-hidden text-left transition-colors hover:bg-muted/40"
    >
      {cover ? (
        <img src={cover.imageUrl} alt={cover.caption || product.name} className="h-24 w-full object-cover" />
      ) : (
        <div className="flex h-24 items-center justify-center bg-gradient-to-br from-primary/12 to-navy/10 text-4xl">
          {product.emoji}
        </div>
      )}
      <div className="flex flex-1 flex-col p-3">
        <p className="line-clamp-2 text-sm font-semibold">{product.name}</p>
        <p className="text-[11px] text-muted-foreground">{product.category} • {product.sku}</p>
        {(product.photos ?? []).length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {product.photos.length} foto • {product.photos.filter((ph) => ph.locationUrl.trim()).length} lokasi
          </p>
        )}
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="text-sm font-bold">{rupiah(final)}</span>
          {product.discountPercent > 0 && (
            <span className="text-[11px] text-muted-foreground line-through">{rupiah(product.price)}</span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {product.discountPercent > 0 && <StatusBadge tone="danger">-{product.discountPercent}%</StatusBadge>}
          <StatusBadge tone={product.stock > 0 ? "success" : "neutral"}>
            {product.stock > 0 ? `Stok ${product.stock}` : "Habis"}
          </StatusBadge>
          {!product.active && <StatusBadge tone="neutral">Nonaktif</StatusBadge>}
        </div>
      </div>
    </button>
  );
}

export function OrderCard({ order }: { order: Order }) {
  const meta = ORDER_META[order.status];
  return (
    <div className="card-soft flex items-center gap-3 p-4 transition-colors hover:bg-muted/40">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Package className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold">{order.customerName}</p>
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          {order.number} • {order.items.length} item • {waktuRelatif(order.at)}
        </p>
        <p className="mt-1 text-sm font-bold">{rupiah(orderTotal(order))}</p>
      </div>
    </div>
  );
}

export function InvoiceView({ order, business }: { order: Order; business: Business }) {
  const subtotal = order.items.reduce((s, i) => s + i.price * i.qty, 0);
  return (
    <div className="card-soft space-y-4 p-4">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="text-lg font-bold">{business.name}</p>
          <p className="text-[11px] text-muted-foreground">{business.address}</p>
          <p className="text-[11px] text-muted-foreground">PIN Bisnis {business.pin}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold tracking-wide uppercase">Invoice</p>
          <p className="font-mono text-xs">{order.number}</p>
          <p className="text-[11px] text-muted-foreground">{tanggal(order.at)}</p>
        </div>
      </div>
      <div>
        <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Ditagihkan kepada</p>
        <p className="text-sm font-semibold">{order.customerName}</p>
        <p className="text-[11px] text-muted-foreground">PIN {order.customerPin}</p>
        <p className="text-[11px] text-muted-foreground">{order.address}</p>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="pb-1 font-medium">Item</th>
            <th className="pb-1 text-center font-medium">Qty</th>
            <th className="pb-1 text-right font-medium">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((i) => (
            <tr key={i.productId} className="border-b border-border/60">
              <td className="py-1.5">{i.name}</td>
              <td className="py-1.5 text-center">{i.qty}</td>
              <td className="py-1.5 text-right">{rupiah(i.price * i.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span>{rupiah(subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Ongkos kirim</span>
          <span>{rupiah(order.shipping)}</span>
        </div>
        <div className="flex justify-between border-t border-border pt-1.5 text-sm font-bold">
          <span>Total</span>
          <span>{rupiah(orderTotal(order))}</span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Pembayaran: {business.quickReplies.find((q) => q.shortcut === "/rekening")?.text ?? "Transfer bank"}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1 rounded-xl" onClick={() => window.print()}>
          <Printer className="size-4" /> Cetak
        </Button>
        <Button
          variant="outline"
          className="flex-1 rounded-xl"
          onClick={() => alert("Unduh PDF akan tersedia setelah layanan dokumen tersambung.")}
        >
          <Download className="size-4" /> Unduh PDF
        </Button>
      </div>
    </div>
  );
}

export function QuickReplyPicker({
  replies,
  onPick,
}: {
  replies: { shortcut: string; text: string }[];
  onPick: (text: string) => void;
}) {
  return (
    <Command className="rounded-xl border border-border">
      <CommandInput placeholder="Cari balasan cepat…" />
      <CommandList>
        <CommandEmpty>Tidak ada balasan cepat yang cocok.</CommandEmpty>
        <CommandGroup heading="Balasan cepat">
          {replies.map((r) => (
            <CommandItem key={r.shortcut} value={`${r.shortcut} ${r.text}`} onSelect={() => onPick(r.text)}>
              <Boxes className="size-4" />
              <span className="font-semibold text-primary">{r.shortcut}</span>
              <span className={cn("truncate text-xs text-muted-foreground")}>{r.text}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
