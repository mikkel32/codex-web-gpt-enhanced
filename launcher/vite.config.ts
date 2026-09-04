import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), {
    name: "maria-development-readiness",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== "/__maria_dev_ready") return next();
        response.setHeader("content-type", "text/plain");
        response.setHeader("cache-control", "no-store");
        response.end(process.env.MARIA_DEV_SERVER_NONCE ?? "");
      });
    },
  }],
  root: ".",
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome138",
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: 4178,
    strictPort: true,
    watch: {
      ignored: ["**/build/**", "**/release/**"],
    },
  },
});
