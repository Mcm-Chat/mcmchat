/**
 * Kunci UI saat panggilan masuk sedang berdering.
 *
 * Banner panggilan masuk adalah modal: selama tampil, navigasi bawah tidak
 * boleh bisa ditekan atau di-Tab, supaya pengguna tidak tersesat ke menu lain
 * dan kehilangan tombol Jawab/Tolak. Store kecil ini dipakai lintas komponen
 * (banner global di root, BottomNavigation di dalam AppShell).
 */
import { useSyncExternalStore } from "react";

let active = false;
const listeners = new Set<() => void>();

export function setIncomingCallActive(next: boolean) {
  if (active === next) return;
  active = next;
  if (typeof document !== "undefined") {
    if (next) document.body.setAttribute("data-incoming-call", "");
    else document.body.removeAttribute("data-incoming-call");
  }
  for (const l of listeners) l();
}

export function isIncomingCallActive() {
  return active;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useIncomingCallActive() {
  return useSyncExternalStore(
    subscribe,
    () => active,
    () => false,
  );
}
