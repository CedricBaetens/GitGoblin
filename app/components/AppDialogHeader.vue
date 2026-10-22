<script lang="ts">
import { h, type FunctionalComponent, type HTMLAttributes } from "vue";

const AppDialogHeader: FunctionalComponent<HTMLAttributes> = (
  props,
  { attrs, slots },
) =>
  h(
    "div",
    {
      ...attrs,
      class: [
        "flex items-center justify-between gap-[20px] mb-[15px] [&_h2]:[overflow-wrap:anywhere]",
        attrs.class,
      ],
    },
    slots.default?.(),
  );

AppDialogHeader.inheritAttrs = false;
export default AppDialogHeader;
</script>
