import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Tout /api (auth Better Auth + API métier) est relayé vers le backend Fastify.
      "/api": {
        target: "http://localhost:3300",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
  },
});
