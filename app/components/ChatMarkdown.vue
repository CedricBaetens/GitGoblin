<script setup lang="ts">
import { computed, ref } from "vue";
import { renderMarkdown } from "~/lib/markdown";
import { desktop, invoke } from "~/lib/native";
const props = defineProps<{ text: string; streaming?: boolean }>();
const html = computed(() => renderMarkdown(props.text));
const linkError = ref("");
async function openLink(event: MouseEvent) {
  const anchor = (event.target as Element).closest("a[href]");
  if (!anchor || !desktop()) return;
  event.preventDefault();
  linkError.value = "";
  try {
    await invoke("open_external_url", { url: anchor.getAttribute("href") });
  } catch (error) {
    linkError.value = `Could not open link: ${String(error)}`;
  }
}
</script>

<template>
  <AppCodeSurface
    class="chat-markdown [&_.badge]:text-[9px] [&_.badge]:bg-[#242831] [&_.badge]:text-[#a1a8ba] [&_.badge]:py-[3px] [&_.badge]:px-[5px] [&_.badge]:rounded-[4px] [&_.graph-line.last]:bottom-[50%] text-[13px] leading-[1.7] text-[#d4d7df] [overflow-wrap:anywhere] [&_p]:mt-0 [&_p]:mx-0 [&_p]:mb-[12px] [&_ul]:mt-0 [&_ul]:mx-0 [&_ul]:mb-[12px] [&_ol]:mt-0 [&_ol]:mx-0 [&_ol]:mb-[12px] [&_blockquote]:mt-0 [&_blockquote]:mx-0 [&_blockquote]:mb-[12px] [&_pre]:mt-0 [&_pre]:mx-0 [&_pre]:mb-[12px] [&_p]:text-[inherit] [&_p]:leading-[inherit] [&_div>:last-child]:mb-0 [&_h1]:mt-[18px] [&_h1]:mx-0 [&_h1]:mb-[8px] [&_h1]:text-[#e0e6f4] [&_h1]:leading-[1.4] [&_h2]:mt-[18px] [&_h2]:mx-0 [&_h2]:mb-[8px] [&_h2]:text-[#e0e6f4] [&_h2]:leading-[1.4] [&_h3]:mt-[18px] [&_h3]:mx-0 [&_h3]:mb-[8px] [&_h3]:text-[#e0e6f4] [&_h3]:leading-[1.4] [&_h4]:mt-[18px] [&_h4]:mx-0 [&_h4]:mb-[8px] [&_h4]:text-[#e0e6f4] [&_h4]:leading-[1.4] [&_h5]:mt-[18px] [&_h5]:mx-0 [&_h5]:mb-[8px] [&_h5]:text-[#e0e6f4] [&_h5]:leading-[1.4] [&_h6]:mt-[18px] [&_h6]:mx-0 [&_h6]:mb-[8px] [&_h6]:text-[#e0e6f4] [&_h6]:leading-[1.4] [&_h1]:text-[20px] [&_h2]:text-[17px] [&_h3]:text-[14px] [&_h4]:text-[12px] [&_h5]:text-[12px] [&_h6]:text-[12px] [&_div>:first-child]:mt-0 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-[22px] [&_ol]:pl-[22px] [&_li_+_li]:mt-[4px] [&_li>ul]:mt-[4px] [&_li>ol]:mt-[4px] [&_strong]:font-semibold [&_strong]:text-[#e7e9ef] [&_a]:text-[#a7b6ff] [&_a]:underline [&_a]:[text-underline-offset:2px] [&_a:hover]:text-[#d2dbff] [&_a:focus-visible]:[outline:2px_solid_#a7b6ff] [&_a:focus-visible]:outline-offset-[2px] [&_code]:font-[ui-monospace,_'Cascadia_Code',_'SFMono-Regular',_Consolas,_monospace] [&_code]:text-[.9em] [&_code]:bg-[#ffffff08] [&_code]:text-[#dde1e9] [&_code]:rounded-[4px] [&_code]:py-[2px] [&_code]:px-[4px] [&_pre]:overflow-x-auto [&_pre]:p-[12px] [&_pre]:border-[1px] [&_pre]:border-solid [&_pre]:border-[var(--line)] [&_pre]:rounded-[6px] [&_pre]:bg-[#101218] [&_pre]:whitespace-pre [&_pre]:[overflow-wrap:normal] [&_pre_code]:p-0 [&_pre_code]:bg-transparent [&_pre_code]:rounded-none [&_blockquote]:ml-0 [&_blockquote]:pl-[12px] [&_blockquote]:border-l-[3px] [&_blockquote]:border-solid [&_blockquote]:border-l-[#57688f] [&_blockquote]:text-[#98a6c2] [&_table]:block [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:my-[12px] [&_table]:mx-0 [&_th]:border-[1px] [&_th]:border-solid [&_th]:border-[#353d4d] [&_th]:py-[6px] [&_th]:px-[10px] [&_th]:text-left [&_td]:border-[1px] [&_td]:border-solid [&_td]:border-[#353d4d] [&_td]:py-[6px] [&_td]:px-[10px] [&_td]:text-left [&_th]:bg-[#202633] [&_hr]:border-0 [&_hr]:border-t-[1px] [&_hr]:border-solid [&_hr]:border-t-[var(--line)] [&_hr]:my-[16px] [&_hr]:mx-0 [&_img]:max-w-full [&_img]:h-auto"
  >
    <div v-html="html" @click="openLink" />
    <p v-if="linkError" role="alert">{{ linkError }}</p>
    <span
      v-if="streaming"
      class="streaming-cursor inline-block w-[2px] h-[1em] ml-[3px] [vertical-align:-2px] bg-[#a8b6ec] animate-pulse [@media(prefers-reduced-motion:reduce)]:animate-none"
      aria-hidden="true"
    />
  </AppCodeSurface>
</template>
