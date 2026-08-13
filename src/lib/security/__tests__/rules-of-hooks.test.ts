import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

/**
 * Regresi: melarang hook React setelah conditional return.
 *
 * Bug nyata yang dicegah: `useState`/`useEffect` di ProfilePage dideklarasikan
 * setelah `if (loading || !profile) return ...`, sehingga jumlah hook berubah
 * saat profil selesai dimuat dan React melempar
 * "Rendered more hooks than during the previous render".
 */
describe("react-hooks/rules-of-hooks", () => {
  const lint = async (patterns: string[]) => {
    // prettier dimatikan agar hanya pelanggaran hook yang tersisa.
    const eslint = new ESLint({ overrideConfig: { rules: { "prettier/prettier": "off" } } });
    const results = await eslint.lintFiles(patterns);
    return results.flatMap((r) =>
      r.messages
        .filter((m) => m.ruleId === "react-hooks/rules-of-hooks")
        .map((m) => `${r.filePath.replace(process.cwd() + "/", "")}:${m.line} ${m.message}`),
    );
  };

  it("tidak ada pelanggaran di seluruh src", { timeout: 180_000 }, async () => {
    const violations = await lint(["src"]);
    expect(violations).toEqual([]);
  });

  it("aturan benar-benar aktif dan mendeteksi hook setelah early return", { timeout: 60_000 }, async () => {
    const eslint = new ESLint({ overrideConfig: { rules: { "prettier/prettier": "off" } } });
    const results = await eslint.lintText(
      [
        'import { useState } from "react";',
        "export function Probe({ loading }: { loading: boolean }) {",
        "  const [a] = useState(0);",
        "  if (loading) return <div>{a}</div>;",
        "  const [b] = useState(1);",
        "  return <div>{b}</div>;",
        "}",
        "",
      ].join("\n"),
      { filePath: "src/__rules_of_hooks_probe__.tsx" },
    );
    const ids = results.flatMap((r) => r.messages.map((m) => m.ruleId));
    expect(ids).toContain("react-hooks/rules-of-hooks");
  });
});
