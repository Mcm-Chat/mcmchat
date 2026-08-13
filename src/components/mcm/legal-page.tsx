import type { ReactNode } from "react";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";

export type LegalSection = { heading: string; body: ReactNode };

export function LegalPage({
  title,
  updatedAt,
  intro,
  sections,
}: {
  title: string;
  updatedAt: string;
  intro: string;
  sections: LegalSection[];
}) {
  return (
    <AppShell
      nav={false}
      header={<MobileHeader title={title} subtitle={`Diperbarui ${updatedAt}`} back />}
    >
      <div className="space-y-5 px-4 py-5 pb-10">
        <p className="text-sm leading-relaxed text-muted-foreground">{intro}</p>
        {sections.map((s) => (
          <section key={s.heading} className="space-y-1.5">
            <h2 className="text-sm font-semibold text-foreground">{s.heading}</h2>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{s.body}</div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
