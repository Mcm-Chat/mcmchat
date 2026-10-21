import { describe, expect, it } from "vitest";
import { isUnusedPdfRenderer } from "../../../../scripts/pdf-optional-dependencies";

describe("optional PDF renderer exclusion", () => {
  it.each(["canvg", "html2canvas", "dompurify"])(
    "excludes only jsPDF's unused %s import",
    (name) => {
      expect(isUnusedPdfRenderer(name, "/app/node_modules/jspdf/dist/jspdf.es.min.js")).toBe(true);
      expect(isUnusedPdfRenderer(name, "C:\\app\\node_modules\\jspdf\\dist\\jspdf.es.min.js")).toBe(
        true,
      );
      expect(isUnusedPdfRenderer(name, "/app/src/feature.ts")).toBe(false);
      expect(isUnusedPdfRenderer(name, undefined)).toBe(false);
    },
  );

  it.each(["fflate", "fast-png", "jspdf", "qrcode", "html2canvas-extension"])(
    "retains %s",
    (name) => {
      expect(isUnusedPdfRenderer(name, "/app/node_modules/jspdf/dist/jspdf.es.min.js")).toBe(false);
    },
  );
});
