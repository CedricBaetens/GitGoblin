import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2026-10-16",
  ssr: false,
  devtools: { enabled: false },
  css: ["~/assets/tailwind.css"],
  app: {
    head: {
      htmlAttrs: {
        class:
          "font-[Inter,_'Segoe_UI',_sans-serif] text-[#d5d7df] bg-[#101114] text-[13px] leading-[normal] [font-synthesis:none] [--bg:#101114] [--panel:#141519] [--raised:#1c1e24] [--line:#282a32] [--muted:#808491] [--accent:#a7b6ff] [--blue:#879eff] [--green:#83c7a4] [--red:#e9979e] [--sidebar:235px] [--titlebar-height:56px] [--review-heading-height:42px] [color-scheme:dark] [&_*]:box-border [&_svg]:shrink-0 [&_body]:m-0 [&_*::selection]:bg-[#6c81c650] [&_*::-webkit-scrollbar]:w-[8px] [&_*::-webkit-scrollbar]:h-[8px] [&_*::-webkit-scrollbar-thumb]:bg-[#30333d] [&_*::-webkit-scrollbar-thumb]:border-[2px] [&_*::-webkit-scrollbar-thumb]:border-solid [&_*::-webkit-scrollbar-thumb]:border-[transparent] [&_*::-webkit-scrollbar-thumb]:[background-clip:padding-box] [&_*::-webkit-scrollbar-thumb]:rounded-[6px] [&_*::-webkit-scrollbar-track]:bg-[transparent] [@media(min-width:1650px)]:[--sidebar:250px] [@media(max-width:1250px)]:[--sidebar:205px] [@media(max-width:1000px)]:[--sidebar:190px] [@media(prefers-reduced-motion:reduce)]:[&_*]:animate-none! [@media(prefers-reduced-motion:reduce)]:[&_*]:[transition:none]! [&_body:has(.pane-resize.dragging)]:cursor-col-resize! [&_body:has(.pane-resize.dragging)]:select-none! [&_body:has(.pane-resize.dragging)_*]:cursor-col-resize! [&_body:has(.pane-resize.dragging)_*]:select-none! [&_body:has(.pane-resize.horizontal.dragging)]:cursor-row-resize! [&_body:has(.pane-resize.horizontal.dragging)_*]:cursor-row-resize!",
      },
      title: "GitGoblin",
      meta: [
        {
          name: "description",
          content: "Your code. Your history. Your agents.",
        },
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],
    clearScreen: false,
    server: { strictPort: true },
  },
  nitro: { preset: "static" },
});
