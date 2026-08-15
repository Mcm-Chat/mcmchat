/**
 * Tombol Back Android (WebView) menutup overlay paling atas lebih dulu (LIFO),
 * bukan meninggalkan halaman dan bukan menutup semua overlay sekaligus.
 *
 * Implementasi tanpa plugin tambahan: seluruh overlay yang aktif terdaftar pada
 * satu registry global. Registry memelihara TEPAT SATU entri history "penanda".
 * Satu Back mengonsumsi penanda itu, menutup overlay teratas, lalu memasang
 * ulang penanda bila masih ada overlay di bawahnya. Penutupan lewat UI hanya
 * mencabut entri dari stack; penanda dibuang saat stack kosong sehingga tidak
 * pernah terjadi history loop.
 */
import { useEffect, useRef } from "react";

export const BACK_GUARD_KEY = "__mcmOverlay";

type Entry = { id: number; dismiss: () => void };

let stack: Entry[] = [];
let markerActive = false;
let listening = false;
let seq = 0;
/**
 * Jumlah `history.back()` yang KITA picu sendiri saat melepas penanda.
 * Popstate hasil panggilan itu harus diabaikan; tanpa penghitung ini, overlay
 * baru yang dibuka pada tick yang sama (mis. tile pada sheet "Tindakan" yang
 * menutup sheet lalu membuka dialog) langsung ikut tertutup oleh popstate
 * susulan sehingga terlihat seperti tombol mati.
 */
let pendingSelfPop = 0;

export function isGuardState(state: unknown): boolean {
  return (
    !!state &&
    typeof state === "object" &&
    (state as Record<string, unknown>)[BACK_GUARD_KEY] === true
  );
}

/** Jumlah overlay yang sedang terdaftar (dipakai tes/diagnostik). */
export function backGuardDepth(): number {
  return stack.length;
}

/** Apakah penanda history sedang terpasang (dipakai tes/diagnostik). */
export function backGuardMarkerActive(): boolean {
  return markerActive;
}

function onPop() {
  if (pendingSelfPop > 0) {
    pendingSelfPop--;
    if (stack.length === 0) stopListening();
    return;
  }
  if (!markerActive) return; // penanda bukan milik kita / sudah dilepas.
  markerActive = false;
  const top = stack.pop();
  if (!top) {
    stopListening();
    return;
  }
  if (stack.length > 0) armMarker();
  else stopListening();
  top.dismiss();
}

function startListening() {
  if (listening || typeof window === "undefined") return;
  window.addEventListener("popstate", onPop);
  listening = true;
}

function stopListening() {
  // Tetap mendengarkan selama masih ada popstate milik kita yang mengudara,
  // agar popstate itu tidak bocor ke overlay berikutnya.
  if (pendingSelfPop > 0) return;
  if (!listening || typeof window === "undefined") return;
  window.removeEventListener("popstate", onPop);
  listening = false;
}

function armMarker() {
  if (markerActive || typeof window === "undefined") return;
  // Pertahankan state router yang sudah ada (metadata TanStack Router).
  const prev = window.history.state;
  const base = prev && typeof prev === "object" ? (prev as Record<string, unknown>) : {};
  window.history.pushState({ ...base, [BACK_GUARD_KEY]: true }, "");
  markerActive = true;
}

function disarmMarker() {
  if (!markerActive || typeof window === "undefined") return;
  markerActive = false;
  if (isGuardState(window.history.state)) {
    pendingSelfPop += 1;
    window.history.back();
  }
}

function register(dismiss: () => void): number {
  const id = ++seq;
  stack.push({ id, dismiss });
  startListening();
  armMarker();
  return id;
}

function unregister(id: number) {
  const i = stack.findIndex((e) => e.id === id);
  if (i === -1) return;
  stack.splice(i, 1);
  if (stack.length === 0) {
    disarmMarker();
    stopListening();
  }
}

/** Reset penuh registry — hanya untuk tes. */
export function __resetBackGuard() {
  stack = [];
  markerActive = false;
  pendingSelfPop = 0;
  stopListening();
}

export function useBackDismiss(open: boolean, onDismiss: () => void): void {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const id = register(() => dismiss.current());
    return () => unregister(id);
  }, [open]);
}
