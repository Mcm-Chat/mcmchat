/**
 * jsPDF documents excluding these optional HTML/SVG renderers when unused:
 * node_modules/jspdf/README.md, "Optional dependencies".
 *
 * Both app exporters draw PDF text/tables directly; the ledger embeds a PNG QR.
 * Keep the real jsPDF implementation and all used dependencies bundled. Scope
 * this exclusion to jsPDF itself, so another feature importing a renderer still
 * gets the actual dependency. Adding HTML/SVG PDF output requires removing its
 * exclusion and updating the PDF regression fixtures first.
 */
const unusedPdfRenderers = new Set(["canvg", "html2canvas", "dompurify"]);

export function isUnusedPdfRenderer(source: string, importer: string | undefined): boolean {
  return unusedPdfRenderers.has(source) && /[/\\]jspdf[/\\]dist[/\\]/.test(importer ?? "");
}
