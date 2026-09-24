import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        youtubeTest: fileURLToPath(new URL("./youtube-test.html", import.meta.url))
      }
    }
  }
});
