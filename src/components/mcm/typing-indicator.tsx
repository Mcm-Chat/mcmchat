/**
 * Indikator "sedang mengetik…" untuk chat aktif.
 * Murni presentasional: sinyal datang dari Realtime broadcast (useTyping),
 * jadi komponen ini hanya merender gelembung titik animasi + label nama.
 */
export function TypingIndicator({
  names,
  className = "",
}: {
  names: string[];
  className?: string;
}) {
  if (names.length === 0) return null;

  const label =
    names.length === 1
      ? `${names[0]} sedang mengetik…`
      : names.length === 2
        ? `${names[0]} dan ${names[1]} sedang mengetik…`
        : `${names[0]} dan ${names.length - 1} lainnya sedang mengetik…`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 px-3 pb-1 ${className}`}
    >
      <span className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-card/90 px-3 py-2 shadow-xs backdrop-blur">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden="true"
            className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70"
            style={{ animationDelay: `${i * 150}ms`, animationDuration: "900ms" }}
          />
        ))}
      </span>
      <span className="truncate text-[11px] font-medium text-muted-foreground">{label}</span>
    </div>
  );
}
