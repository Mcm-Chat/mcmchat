import { createFileRoute, redirect } from "@tanstack/react-router";
import { isValidPin, normalizePin } from "@/lib/api/contacts";

/**
 * Tautan undangan publik `https://mcmchat.id/contact/<pin>` (dipakai QR dan
 * App Link Android). Selalu dialihkan ke layar tambah kontak dengan PIN terisi.
 */
export const Route = createFileRoute("/contact/$pin")({
  beforeLoad: ({ params }) => {
    const pin = normalizePin(params.pin ?? "");
    throw redirect({
      to: "/contacts/add",
      search: isValidPin(pin) ? { pin } : {},
      replace: true,
    });
  },
  component: () => null,
});
