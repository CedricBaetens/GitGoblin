<script lang="ts">
import { h, type FunctionalComponent, type HTMLAttributes } from "vue";

const AppCodeSurface: FunctionalComponent<HTMLAttributes> = (
  props,
  { attrs, slots },
) =>
  h(
    "div",
    {
      ...attrs,
      class: [
        "[&_.syntax-token]:text-[var(--syntax-color)] [&_.hljs-comment]:text-[#8c98aa] [&_.hljs-quote]:text-[#8c98aa] [&_.hljs-keyword]:text-[#c5a5ef] [&_.hljs-selector-tag]:text-[#c5a5ef] [&_.hljs-literal]:text-[#c5a5ef] [&_.hljs-string]:text-[#add5a2] [&_.hljs-regexp]:text-[#add5a2] [&_.hljs-addition]:text-[#add5a2] [&_.hljs-number]:text-[#e4b58b] [&_.hljs-symbol]:text-[#e4b58b] [&_.hljs-bullet]:text-[#e4b58b] [&_.hljs-title]:text-[#f2d487] [&_.hljs-section]:text-[#e7ce8d] [&_.hljs-type]:text-[#64d8c5] [&_.hljs-built\\_in]:text-[#81cbd1] [&_.hljs-name]:text-[#81cbd1] [&_.hljs-attr]:text-[#9bc8ef] [&_.hljs-attribute]:text-[#9bc8ef] [&_.hljs-variable]:text-[#9bc8ef] [&_.hljs-selector-class]:text-[#9bc8ef] [&_.hljs-meta]:text-[#a8b6ec] [&_.hljs-doctag]:text-[#a8b6ec]",
        attrs.class,
      ],
    },
    slots.default?.(),
  );

AppCodeSurface.inheritAttrs = false;
export default AppCodeSurface;
</script>
