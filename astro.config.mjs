import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  site: process.env.PUBLIC_SITE_URL || undefined,
  trailingSlash: "always",
  vite: {
    plugins: [tailwindcss()],
  },
});
