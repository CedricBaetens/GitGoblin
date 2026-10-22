<script lang="ts">
import { h, type FunctionalComponent, type HTMLAttributes } from "vue";
import AppButton from "./AppButton.vue";
const AppTreeRow: FunctionalComponent<
  HTMLAttributes & {
    as?: "button" | "summary";
  }
> = (props, { attrs, slots }) =>
  h(
    (props.as || "button") === "button" ? AppButton : props.as || "button",
    {
      ...attrs,
      class: [
        "text-[#b0bbcd] flex justify-start gap-[9px] w-full text-[11px] py-[8px] px-[11px] [&>span:not(.status-dot):not(.tiny-label)]:overflow-hidden [&>span:not(.status-dot):not(.tiny-label)]:text-ellipsis [&>span:not(.status-dot):not(.tiny-label)]:whitespace-nowrap [&_svg]:text-[#899bb8] [&>.status-dot:last-child]:ml-auto [&>.status-dot:first-child]:ml-[4px] [&>.status-dot:first-child]:mr-[4px] [&.subdued]:text-[10px] [&.subdued]:text-[#8897af]",
        attrs.class,
      ],
    },
    slots,
  );
AppTreeRow.props = ["as"];
AppTreeRow.inheritAttrs = false;
export default AppTreeRow;
</script>
