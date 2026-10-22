<script lang="ts">
import {
  h,
  withDirectives,
  vModelText,
  type FunctionalComponent,
  type TextareaHTMLAttributes,
} from "vue";
type Props = TextareaHTMLAttributes & {
  modelValue?: unknown;
  modelModifiers?: Record<string, boolean>;
  "onUpdate:modelValue"?: (value: any) => void;
};
const AppTextarea: FunctionalComponent<Props> = (props, { attrs }) => {
  const element = h("textarea", {
    ...attrs,
    class: [
      "[:where(&)]:[font:inherit] [:where(&)]:text-[inherit] [:where(&)]:bg-[#101115] [:where(&)]:border-[1px] [:where(&)]:border-solid [:where(&)]:border-[#343640] [:where(&)]:rounded-[6px] [:where(&)]:py-[9px] [:where(&)]:px-[10px] [:where(&)]:outline-none [:where(&)]:min-w-0 [:where(&:focus)]:[border-color:#8092d2] [:where(&:focus)]:shadow-[0_0_0_2px_#8297ec12] [:where(&)]:resize-y [:where(&)]:leading-[1.6] [:where(&::placeholder)]:text-[#6a6e7b]",
      attrs.class,
    ],
  });
  return attrs["onUpdate:modelValue"]
    ? withDirectives(element, [
        [vModelText, props.modelValue, undefined, props.modelModifiers ?? {}],
      ])
    : element;
};
AppTextarea.props = ["modelValue", "modelModifiers"];
AppTextarea.inheritAttrs = false;
export default AppTextarea;
</script>
