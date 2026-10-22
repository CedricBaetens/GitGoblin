<script lang="ts">
import { h, type ButtonHTMLAttributes, type FunctionalComponent } from "vue";
type Props = ButtonHTMLAttributes & {
  variant?: "default" | "primary";
  size?: "default" | "icon";
};
// Functional components keep template refs pointed at the native element.
const AppButton: FunctionalComponent<Props> = (
  { variant, size },
  { attrs, slots },
) =>
  h(
    "button",
    {
      ...attrs,
      class: [
        "[:where(&)]:[font:inherit] [:where(&)]:inline-flex [:where(&)]:items-center [:where(&)]:justify-center [:where(&)]:gap-[7px] [:where(&)]:bg-transparent [:where(&)]:text-[inherit] [:where(&)]:border-[1px] [:where(&)]:border-solid [:where(&)]:border-[transparent] [:where(&)]:rounded-[6px] [:where(&)]:py-[7px] [:where(&)]:px-[10px] [:where(&)]:cursor-pointer [:where(&)]:whitespace-nowrap [:where(&)]:[transition:background_0.12s,_color_0.12s] [:where(&:hover:not(:disabled))]:bg-[#252831] [:where(&:hover:not(:disabled))]:text-[#f0f1f7] [:where(&:disabled)]:opacity-[0.36] [:where(&:disabled)]:cursor-not-allowed [:where(&:focus-visible)]:[outline:2px_solid_var(--blue)] [:where(&:focus-visible)]:outline-offset-[2px]",
        variant === "primary" &&
          "bg-[#9eaffb] text-[#121727] font-semibold [&:hover:not(:disabled)]:bg-[#b3c0ff] [&:hover:not(:disabled)]:text-[#111522]",
        size === "icon" &&
          "w-[28px] h-[28px] p-[4px] text-[#8e94a3] [.conversation-navigation_&]:shrink-0",
        attrs.class,
      ],
    },
    slots.default?.(),
  );
AppButton.props = ["variant", "size"];
AppButton.inheritAttrs = false;
export default AppButton;
</script>
