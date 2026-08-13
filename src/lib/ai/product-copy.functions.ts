import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().max(80).optional().default(""),
  price: z.number().nonnegative().optional(),
  specs: z.string().trim().max(2000).optional().default(""),
  tone: z.enum(["ringkas", "persuasif", "formal"]).optional().default("ringkas"),
});

/**
 * Susun deskripsi produk katalog dari judul + spesifikasi memakai Lovable AI.
 * Hanya untuk pengguna terautentikasi; kunci API tidak pernah keluar dari server.
 */
export const generateProductDescription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => input.parse(raw))
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { ok: false as const, reason: "AI belum aktif untuk proyek ini" };

    const facts = [
      `Nama produk: ${data.name}`,
      data.category ? `Kategori: ${data.category}` : "",
      typeof data.price === "number" ? `Harga dasar: Rp ${data.price.toLocaleString("id-ID")}` : "",
      data.specs ? `Spesifikasi/catatan: ${data.specs}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-3-flash",
        messages: [
          {
            role: "system",
            content:
              "Anda penulis katalog produk berbahasa Indonesia. Tulis deskripsi produk yang rapi, jujur, dan tidak melebih-lebihkan. " +
              "Keluarkan 2-4 kalimat mengalir, lalu maksimal 4 poin '- ' berisi keunggulan/spesifikasi. " +
              "Jangan mengarang spesifikasi yang tidak diberikan. Jangan pakai judul, emoji, atau markdown selain tanda '-'.",
          },
          { role: "user", content: `Gaya bahasa: ${data.tone}\n\n${facts}` },
        ],
      }),
    });

    if (res.status === 429) return { ok: false as const, reason: "Terlalu banyak permintaan, coba lagi sebentar lagi" };
    if (res.status === 402) return { ok: false as const, reason: "Kredit AI habis. Tambahkan kredit workspace." };
    if (!res.ok) return { ok: false as const, reason: "Gagal menghubungi layanan AI" };

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) return { ok: false as const, reason: "AI tidak mengembalikan teks" };
    return { ok: true as const, description: text.slice(0, 2000) };
  });
