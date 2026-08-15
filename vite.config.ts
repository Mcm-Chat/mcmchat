// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load non-VITE_ env vars into process.env for server routes (email, webhooks).
Object.assign(process.env, loadEnv(process.env["NODE_ENV"] ?? "development", process.cwd(), ""));

// `@react-email/render` mengimpor `entities/lib/*` (API v4), sementara paket
// `entities` teratas sudah v7 dan tidak punya folder itu. Kita pasang salinan
// v4 sebagai dependensi eksplisit (`entities-v4`) supaya alias ini deterministik
// di mesin mana pun, termasuk CI dengan node_modules yang bersih.
const entitiesV4 = path.resolve(__dirname, "node_modules/entities-v4/lib/esm");

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      alias: {
        "entities/lib/decode.js": path.join(entitiesV4, "decode.js"),
        "entities/lib/encode.js": path.join(entitiesV4, "encode.js"),
        "entities/lib/escape.js": path.join(entitiesV4, "escape.js"),
      },
    },
  },
});
