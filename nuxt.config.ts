export default defineNuxtConfig({
  compatibilityDate: "2026-10-16",
  ssr: false,
  devtools: { enabled: false },
  css: ["~/assets/main.css"],
  app: {
    head: {
      title: "GitGoblin",
      meta: [
        {
          name: "description",
          content: "Your code. Your history. Your agents.",
        },
      ],
    },
  },
  vite: { clearScreen: false, server: { strictPort: true } },
  nitro: { preset: "static" },
});
