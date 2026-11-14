import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  publicDir: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [tailwindcss()],
  build: {
    outDir: "public/creative",
    emptyOutDir: true,
    minify: true,
    lib: { entry: "src/frontend/home.tsx", formats: ["es"], fileName: () => "home.js", cssFileName: "home" },
  },
});
