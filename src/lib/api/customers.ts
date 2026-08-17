import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "./db";
import type { Tables } from "@/integrations/supabase/types";

export type CustomerRow = Omit<Tables<"customers">, "pin">;

/**
 * PIN pelanggan bukan kolom biasa.
 *
 * Grant kolom `customers.pin` sudah dicabut untuk `authenticated` dan seluruh
 * akses `anon` ke tabel `customers` dicabut. Satu-satunya jalur baca PIN adalah
 * RPC SECURITY DEFINER `customer_pin()`, yang hanya mengembalikan nilai bila
 * pemanggil pemilik/admin bisnis pelanggan tersebut (`can_manage_business`).
 *
 * Karena itu klien HARUS memilih kolom secara eksplisit lewat
 * `CUSTOMER_SAFE_COLUMNS` — `select("*")` akan gagal begitu kolom PIN tidak
 * lagi ter-grant, dan lebih penting lagi menandakan niat baca yang salah.
 */
export const CUSTOMER_SAFE_COLUMNS =
  "id, business_id, user_id, name, address, note, created_at, updated_at";

export async function listCustomers(businessId: string): Promise<CustomerRow[]> {
  return unwrap(
    await supabase
      .from("customers")
      .select(CUSTOMER_SAFE_COLUMNS)
      .eq("business_id", businessId)
      .order("created_at", { ascending: false }),
    "Gagal memuat pelanggan",
  ) as CustomerRow[];
}

/**
 * PIN pelanggan untuk pengelola bisnis. Mengembalikan `null` bila pemanggil
 * bukan pemilik/admin — bukan melempar, agar UI cukup menyembunyikan PIN.
 */
export async function customerPin(customerId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("customer_pin", { _customer: customerId });
  if (error) return null;
  return data ?? null;
}
