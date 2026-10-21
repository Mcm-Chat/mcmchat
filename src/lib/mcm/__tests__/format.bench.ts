// Local microbenchmark, not an estimate of whole-screen or real-device speed.
// Run: npx vitest bench --run src/lib/mcm/__tests__/format.bench.ts
import { bench, describe } from "vitest";
import { jam, labelHari, rupiah } from "../format";

const history = Array.from({ length: 1_000 }, (_, i) =>
  new Date(Date.UTC(2025, 0, 1, 0, i * 10)).toISOString(),
);
const visible = history.slice(-40);

// Preserve the pre-optimization implementations for reproducible comparisons.
function previousLabelHari(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Hari ini";
  if (d.toDateString() === yesterday.toDateString()) return "Kemarin";
  return new Date(iso).toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

describe("date metadata for 1,000 loaded chat messages", () => {
  bench("previous per-call locale setup", () => {
    history.map(previousLabelHari);
  });
  bench("cached formatter", () => {
    history.map(labelHari);
  });
});

describe("timestamps for 40 visible chat bubbles", () => {
  bench("previous per-call locale setup", () => {
    visible.map((iso) =>
      new Date(iso).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Jakarta",
      }),
    );
  });
  bench("cached formatter", () => {
    visible.map(jam);
  });
});

const amounts = Array.from({ length: 1_000 }, (_, i) => i * 1_234.56);
describe("rupiah amounts for 1,000 rows", () => {
  bench("previous per-call locale setup", () => {
    amounts.map((value) =>
      new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      }).format(Math.round(value)),
    );
  });
  bench("cached formatter", () => {
    amounts.map(rupiah);
  });
});
