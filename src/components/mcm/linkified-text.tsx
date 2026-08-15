import { Fragment } from "react";
import { cn } from "@/lib/utils";

const PATTERN =
  /((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,!?)：:;]|[\w.+-]+@[\w-]+\.[\w.-]+|(?:\+62|0)\d{8,14})/gi;

function hrefOf(token: string): string {
  if (/^https?:\/\//i.test(token)) return token;
  if (/^www\./i.test(token)) return `https://${token}`;
  if (token.includes("@")) return `mailto:${token}`;
  return `tel:${token.replace(/\s+/g, "")}`;
}

/** Renders plain text with clickable links/emails/phone numbers in a distinct color. */
export function LinkifiedText({
  text,
  className,
  onBubble,
}: {
  text: string;
  className?: string;
  onBubble?: boolean;
}) {
  const parts: Array<string | { token: string }> = [];
  let last = 0;
  PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATTERN.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push({ token: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return (
    <span className={cn("[overflow-wrap:anywhere]", className)}>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <a
            key={i}
            href={hrefOf(p.token)}
            target={hrefOf(p.token).startsWith("http") ? "_blank" : undefined}
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              "font-medium underline underline-offset-2 active:opacity-70",
              onBubble
                ? "text-link-on-bubble decoration-current/60"
                : "text-link decoration-link/50",
            )}
          >
            {p.token}
          </a>
        ),
      )}
    </span>
  );
}
