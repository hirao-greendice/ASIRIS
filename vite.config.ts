import { defineConfig } from "vite";

export default defineConfig(({ command, isPreview }) => ({
  // GitHub Pages publishes this repository under /ASIRIS/.
  // Keep the local development URL at http://localhost:5173/.
  base: command === "build" || isPreview ? "/ASIRIS/" : "/",
}));
