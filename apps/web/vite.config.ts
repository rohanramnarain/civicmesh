import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

/**
 * Serve ONNX Runtime Web worker .mjs files from the public directory as raw
 * static files. Vite otherwise tries to transform them as ES modules, which
 * fails because they are copied as-is from node_modules.
 */
function onnxWasmMjsPlugin() {
  return {
    name: "onnx-wasm-mjs",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (url.startsWith("/ort-wasm-") && url.includes(".mjs")) {
          const fileName = path.basename(url.split("?")[0]);
          const filePath = path.resolve(__dirname, "../../public", fileName);
          if (fs.existsSync(filePath)) {
            res.setHeader("Content-Type", "application/javascript");
            res.end(fs.readFileSync(filePath));
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), onnxWasmMjsPlugin()],
  publicDir: "../../public",
  test: {
    exclude: ["node_modules", "e2e"],
  },
});
