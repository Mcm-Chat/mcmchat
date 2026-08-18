import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CALL_SHORTCUTS } from "@/lib/calls/use-call-shortcuts";

/** Daftar pintasan keyboard kontrol panggilan (bisa dibuka dengan tombol "?"). */
export function CallShortcutsHelp({
  open,
  onToggle,
  announcement,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  announcement: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <Button
        size="sm"
        variant="secondary"
        className="min-h-11 rounded-xl"
        aria-expanded={open}
        aria-controls="call-shortcuts-list"
        onClick={onToggle}
      >
        <Keyboard className="mr-1.5 size-4" aria-hidden="true" />
        Pintasan keyboard
      </Button>
      {open && (
        <ul
          id="call-shortcuts-list"
          className="w-full max-w-xs space-y-1 rounded-2xl bg-on-dark-surface p-3 text-xs text-navy-foreground/85"
        >
          {CALL_SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-3">
              <span>{s.label}</span>
              <kbd className="rounded-md border border-on-dark-border bg-on-dark-surface px-1.5 py-0.5 font-mono text-[10px]">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
