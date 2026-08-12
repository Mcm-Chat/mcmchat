/** Tipe bersama untuk halaman tugas pegawai (aman diimpor dari klien). */
export type PrepPhoto = {
  id: string;
  url: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  location_label: string;
  maps_url: string;
  caption: string;
};

export type PrepItem = {
  id: string;
  product_name: string;
  variant_name: string;
  requested_qty: number;
  requested_unit: string;
  requested_qty_base: number;
  actual_qty_base: number | null;
  base_unit: string;
  stock_type: "weight" | "count";
  require_photo: boolean;
  require_location: boolean;
  status: string;
  notes: string;
  photos: PrepPhoto[];
};

export type PrepTask = {
  id: string;
  code: string;
  status: string;
  customer_name: string;
  notes: string;
  expires_at: string;
  completed_at: string | null;
  business_name: string;
  items: PrepItem[];
};
