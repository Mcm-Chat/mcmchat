/**
 * Pembungkus komposer dengan state teks TERISOLASI.
 *
 * Mengetik hanya me-render ulang komponen ini, bukan halaman chat (daftar
 * pesan tervirtualisasi), sehingga gulir tetap mulus di ponsel kelas bawah.
 * Draf disimpan ke localStorage secara ter-debounce, bukan tiap ketukan.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ChatComposer } from "@/components/mcm/chat-parts";
import type { MessageRow } from "@/lib/api/messages";

export type ComposerHandle = {
  /** Isi ulang teks komposer (mis. saat mulai mengedit pesan). */
  setText: (v: string) => void;
  /** Bersihkan komposer. */
  clear: () => void;
};

type Props = {
  draftKey: string;
  onSend: (body: string) => void | Promise<void>;
  onTyping: () => void;
  onAttach: (kind: "image" | "document" | "camera") => void;
  onVoice: (blob: Blob, seconds: number) => void;
  onNewLedger: () => void;
  onNewSale?: (() => void) | undefined;
  onNewPreparation?: (() => void) | undefined;
  onLocation?: (() => void) | undefined;
  onSticker?: (() => void) | undefined;
  editing?: boolean | undefined;
  onCancelEdit?: (() => void) | undefined;
  replyPreview?: MessageRow | undefined;
  replySenderName?: string | undefined;
  onCancelReply?: (() => void) | undefined;
};

export const ComposerHost = forwardRef<ComposerHandle, Props>(function ComposerHost(
  {
    draftKey,
    onSend,
    onTyping,
    onAttach,
    onVoice,
    onNewLedger,
    onNewSale,
    onNewPreparation,
    onLocation,
    onSticker,
    editing,
    onCancelEdit,
    replyPreview,
    replySenderName,
    onCancelReply,
  },
  ref,
) {
  const [text, setText] = useState("");
  const textRef = useRef("");
  textRef.current = text;

  useImperativeHandle(ref, () => ({ setText, clear: () => setText("") }), []);

  // Muat draf saat percakapan berganti.
  useEffect(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(draftKey) : null;
    setText(saved ?? "");
  }, [draftKey]);

  // Simpan draf ter-debounce agar mengetik tidak menyentuh localStorage tiap huruf.
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const t = setTimeout(() => {
      if (textRef.current) localStorage.setItem(draftKey, textRef.current);
      else localStorage.removeItem(draftKey);
    }, 400);
    return () => clearTimeout(t);
  }, [text, draftKey]);

  return (
    <ChatComposer
      value={text}
      onChange={(v) => {
        setText(v);
        if (v) onTyping();
      }}
      onSend={() => {
        const body = textRef.current.trim();
        if (!body) return;
        setText("");
        return onSend(body);
      }}
      onAttach={onAttach}
      onVoice={onVoice}
      onNewLedger={onNewLedger}
      onNewSale={onNewSale}
      onNewPreparation={onNewPreparation}
      onLocation={onLocation}
      onSticker={onSticker}
      editing={editing}
      onCancelEdit={onCancelEdit}
      replyPreview={replyPreview}
      replySenderName={replySenderName}
      onCancelReply={onCancelReply}
    />
  );
});
