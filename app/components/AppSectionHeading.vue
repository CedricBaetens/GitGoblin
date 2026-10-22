<script lang="ts">
import { h, type FunctionalComponent, type HTMLAttributes } from "vue";
import AppButton from "./AppButton.vue";
const AppSectionHeading: FunctionalComponent<
  HTMLAttributes & {
    as?: "button" | "p";
  }
> = (props, { attrs, slots }) =>
  h(
    (props.as || "button") === "button" ? AppButton : props.as || "button",
    {
      ...attrs,
      class: [
        "[.conversation-navigation_&]:flex-1 [.conversation-navigation_&]:w-auto [.conversation-navigation_&]:[text-transform:none] [.conversation-navigation_&]:tracking-normal [.conversation-navigation_&]:text-[12px] [.conversation-navigation_&]:font-medium [.conversation-navigation_&]:text-[#9eaac0] [.conversation-navigation_&]:p-[8px] w-full flex items-center justify-start text-[10px] tracking-[0.8px] font-[650] text-[#a5b2ca] pt-[5px] px-[8px] pb-[8px] gap-[6px] [&>span]:ml-auto [&>span]:font-medium [&>span]:text-[10px] [&>span]:tracking-normal [&>span]:text-[#9caac2] [&>span]:bg-[#262e3d] [&>span]:rounded-[4px] [&>span]:py-[1px] [&>span]:px-[5px]",
        attrs.class,
      ],
    },
    slots,
  );
AppSectionHeading.props = ["as"];
AppSectionHeading.inheritAttrs = false;
export default AppSectionHeading;
</script>
