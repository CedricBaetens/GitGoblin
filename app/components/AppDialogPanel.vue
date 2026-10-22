<script lang="ts">
import { h, type FunctionalComponent, type HTMLAttributes } from "vue";

const AppDialogPanel: FunctionalComponent<
  HTMLAttributes & {
    as?: "section" | "form";
  }
> = (props, { attrs, slots }) =>
  h(
    props.as || "section",
    {
      ...attrs,
      class: [
        "bg-[#1b1e27] border-[1px] border-solid border-[#3b455c] rounded-[12px] shadow-[0_25px_100px_#0008] [&>p]:text-[12px] [&>p]:text-[#8998b4] [&>p]:leading-[1.8] [&>p]:mt-0 [&>p]:mx-0 [&>p]:mb-[20px] [&_label]:flex [&_label]:flex-col [&_label]:gap-[8px] [&_label]:text-[11px] [&_label]:text-[#9eadc8] [&_label]:my-[14px] [&_label]:mx-0 [&_input]:w-full [&_input]:text-[12px] [&_input]:bg-[#131822] [&_input]:[border-color:#35405a] [&_[role=combobox]]:w-full [&_[role=combobox]]:text-[12px] [&_[role=combobox]]:bg-[#131822] [&_[role=combobox]]:[border-color:#35405a] [&_.force-option]:flex-row [&_.force-option]:items-center [&_.force-option_input]:w-auto [&_.inline-error]:mt-[15px] [&_.inline-error]:rounded-[5px]",
        attrs.class,
      ],
    },
    slots.default?.(),
  );
AppDialogPanel.props = ["as"];
AppDialogPanel.inheritAttrs = false;
export default AppDialogPanel;
</script>
