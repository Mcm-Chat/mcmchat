import { useCallback, useState } from "react";
import type { MessageLocation } from "./types";

export const mapsUrlFor = (lat: number, lng: number) =>
  `https://www.google.com/maps?q=${lat},${lng}`;

export const koordinat = (lat: number, lng: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

/**
 * Sanitasi link lokasi yang diketik/ditempel pengguna.
 * Hanya HTTPS yang diterima; `javascript:`/`data:`/skema lain ditolak.
 * Link asli tidak diubah bentuknya, hanya divalidasi.
 */
export function sanitizeMapsUrl(raw: string): string | null {
  const s = raw.trim();
  if (s === "") return "";
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  return u.toString();
}

/** Ambil koordinat dari URL Maps bila terbaca, tanpa mengubah URL aslinya. */
export function extractCoords(raw: string): { lat: number; lng: number } | null {
  const m =
    raw.match(/[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) ??
    raw.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) ??
    raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export const DEMO_LOCATION: MessageLocation = {
  latitude: -6.2146,
  longitude: 106.8451,
  accuracy: 25,
  label: "Bundaran HI, Jakarta Pusat",
  mapsUrl: mapsUrlFor(-6.2146, 106.8451),
  capturedAt: new Date(0).toISOString(),
  source: "demo",
};

export type GeoStatus = "idle" | "loading" | "ready" | "error";

export function useGeolocation() {
  const [status, setStatus] = useState<GeoStatus>("idle");
  const [error, setError] = useState<string>("");
  const [location, setLocation] = useState<MessageLocation | null>(null);

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("error");
      setError("Perangkat/browser ini tidak mendukung GPS.");
      return;
    }
    setStatus("loading");
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setLocation({
          latitude,
          longitude,
          accuracy: Math.round(accuracy),
          label: koordinat(latitude, longitude),
          mapsUrl: mapsUrlFor(latitude, longitude),
          capturedAt: new Date().toISOString(),
          source: "gps",
        });
        setStatus("ready");
      },
      (err) => {
        setStatus("error");
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Izin lokasi ditolak browser."
            : err.code === err.TIMEOUT
              ? "Waktu pengambilan lokasi habis."
              : "Lokasi tidak tersedia saat ini.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }, []);

  const setManual = useCallback((lat: number, lng: number) => {
    setLocation({
      latitude: lat,
      longitude: lng,
      accuracy: 0,
      label: `Lokasi manual (${koordinat(lat, lng)})`,
      mapsUrl: mapsUrlFor(lat, lng),
      capturedAt: new Date().toISOString(),
      source: "manual",
    });
    setStatus("ready");
    setError("");
  }, []);

  const useDemo = useCallback(() => {
    setLocation({ ...DEMO_LOCATION, capturedAt: new Date().toISOString() });
    setStatus("ready");
    setError("");
  }, []);

  const clear = useCallback(() => {
    setLocation(null);
    setStatus("idle");
    setError("");
  }, []);

  return { status, error, location, request, setManual, useDemo, clear };
}

export async function fileToDataUrl(file: File, max = 720): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("Gagal membaca berkas"));
    fr.readAsDataURL(file);
  });
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Gagal memuat gambar"));
      el.src = dataUrl;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return dataUrl;
  }
}
/** Kecilkan foto sebelum diunggah agar hemat kuota (maks sisi terpanjang 1280px). */
export async function compressImage(
  file: File,
  max = 1280,
): Promise<{ blob: Blob; previewUrl: string }> {
  const dataUrl = await fileToDataUrl(file, max);
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return { blob, previewUrl: dataUrl };
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}
