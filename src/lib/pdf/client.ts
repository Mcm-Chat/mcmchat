// Keep the lazy PDF boundary narrow so Rollup need not retain unrelated named
// exports (AcroForm fields, patterns, etc.) from a dynamic module namespace.
export { jsPDF } from "jspdf";
