// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { compileScript, parse } from "@vue/compiler-sfc";
import { ModuleKind, transpile } from "typescript";
import * as Vue from "vue";
import * as Reka from "reka-ui";
import * as Icons from "lucide-vue-next";
import { afterEach, expect, it, vi } from "vitest";

// Exercise the production templates and Reka controls, including their portals.
function component(name: string): Vue.Component {
  const { descriptor } = parse(
    readFileSync(`app/components/${name}.vue`, "utf8"),
  );
  const compiled = compileScript(descriptor, {
    id: name,
    inlineTemplate: true,
  });
  const exports: { default?: Vue.Component } = {};
  const modules = {
    vue: Vue,
    "reka-ui": Reka,
    "lucide-vue-next": Icons,
  };
  new Function(
    "require",
    "exports",
    transpile(compiled.content, { module: ModuleKind.CommonJS }),
  )(
    (name: keyof typeof modules) =>
      name.endsWith(".vue")
        ? { default: component(name.split("/").at(-1)!.replace(".vue", "")) }
        : modules[name],
    exports,
  );
  return exports.default!;
}
const AppSelect = component("AppSelect"),
  AppDialog = component("AppDialog"),
  ContextMenu = component("ContextMenu");
const AppButton = component("AppButton"),
  AppInput = component("AppInput"),
  AppTextarea = component("AppTextarea");
const cleanup: (() => void)[] = [];
function mount(render: () => Vue.VNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const app = Vue.createApp({ setup: () => render });
  app.mount(host);
  cleanup.push(() => {
    app.unmount();
    host.remove();
  });
  return host;
}
function key(element: Element, key: string) {
  element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}
afterEach(async () => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
  await Vue.nextTick();
  document.body.innerHTML = "";
});

it("keeps native button refs and forwards disabled, click, and submit behavior", async () => {
  const button = Vue.ref<HTMLButtonElement>(),
    submit = vi.fn(),
    click = vi.fn();
  const disabled = Vue.ref(false);
  mount(() =>
    Vue.h(
      "form",
      {
        onSubmit: (event: Event) => {
          event.preventDefault();
          submit();
        },
      },
      [
        Vue.h(
          AppButton,
          {
            ref: button,
            type: "submit",
            disabled: disabled.value,
            variant: "primary",
            onClick: click,
          },
          { default: () => "Save" },
        ),
      ],
    ),
  );
  expect(button.value).toBeInstanceOf(HTMLButtonElement);
  button.value!.focus();
  expect(document.activeElement).toBe(button.value);
  button.value!.click();
  expect(click).toHaveBeenCalledOnce();
  expect(submit).toHaveBeenCalledOnce();
  disabled.value = true;
  await Vue.nextTick();
  button.value!.click();
  expect(click).toHaveBeenCalledOnce();

  const row = Vue.ref<HTMLButtonElement>(), rowClick = vi.fn();
  const AppTreeRow = component('AppTreeRow');
  mount(() => Vue.h(AppTreeRow, { ref: row, onClick: rowClick }, { default: () => 'main' }));
  expect(row.value).toBeInstanceOf(HTMLButtonElement);
  expect(row.value!.textContent).toBe('main');
  row.value!.click(); expect(rowClick).toHaveBeenCalledOnce();
});

it("preserves native input models, composition, checkbox values, textarea events, and selection refs", async () => {
  const input = Vue.ref<HTMLInputElement>(),
    textarea = Vue.ref<HTMLTextAreaElement>();
  const text = Vue.ref("hello"),
    checked = Vue.ref(""),
    notes = Vue.ref("draft"),
    onInput = vi.fn();
  const host = mount(() =>
    Vue.h("div", [
      Vue.h(AppInput, {
        ref: input,
        modelValue: text.value,
        "onUpdate:modelValue": (value: string) => (text.value = value),
      }),
      Vue.h(AppInput, {
        type: "checkbox",
        "true-value": "force",
        "false-value": "",
        modelValue: checked.value,
        "onUpdate:modelValue": (value: string) => (checked.value = value),
      }),
      Vue.h(AppTextarea, {
        ref: textarea,
        modelValue: notes.value,
        "onUpdate:modelValue": (value: string) => (notes.value = value),
        onInput,
      }),
    ]),
  );
  expect(input.value).toBeInstanceOf(HTMLInputElement);
  expect(input.value!.value).toBe("hello");
  input.value!.dispatchEvent(new CompositionEvent("compositionstart"));
  input.value!.value = "composing";
  input.value!.dispatchEvent(new Event("input"));
  expect(text.value).toBe("hello");
  input.value!.dispatchEvent(new CompositionEvent("compositionend"));
  expect(text.value).toBe("composing");
  const checkbox = host.querySelector<HTMLInputElement>("[type=checkbox]")!;
  checkbox.click();
  expect(checked.value).toBe("force");
  await Vue.nextTick();
  checkbox.click();
  expect(checked.value).toBe("");
  expect(textarea.value).toBeInstanceOf(HTMLTextAreaElement);
  textarea.value!.value = "updated";
  textarea.value!.dispatchEvent(new Event("input"));
  expect(notes.value).toBe("updated");
  expect(onInput).toHaveBeenCalledOnce();
  textarea.value!.setSelectionRange(1, 3);
  expect(textarea.value!.selectionStart).toBe(1);
});

it("selects an empty provider default and skips disabled choices with the keyboard", async () => {
  const value = Vue.ref("feature");
  const host = mount(() =>
    Vue.h(AppSelect, {
      modelValue: value.value,
      "onUpdate:modelValue": (next: string) => (value.value = next),
      options: [
        { value: "", label: "Provider default" },
        { value: "blocked", label: "Unavailable", disabled: true },
        { value: "feature", label: "Feature" },
      ],
    }),
  );
  const trigger = host.querySelector("button")!;
  key(trigger, "ArrowDown");
  await vi.waitFor(() =>
    expect(document.querySelector('[role="listbox"]')).not.toBeNull(),
  );
  const choices = [...document.querySelectorAll('[role="option"]')];
  choices[2]!.focus();
  key(choices[2]!, "Home");
  await vi.waitFor(() => expect(document.activeElement).toBe(choices[0]));
  key(choices[0]!, "ArrowDown");
  await vi.waitFor(() => expect(document.activeElement).toBe(choices[2]));
  key(choices[2]!, "Home");
  await vi.waitFor(() => expect(document.activeElement).toBe(choices[0]));
  key(choices[0]!, "Enter");
  await vi.waitFor(() => expect(value.value).toBe(""));
  expect(trigger.textContent).toContain("Provider default");
});

it("keeps a busy dialog open and restores focus to its opener when dismissed", async () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const open = Vue.ref(true),
    dismissible = Vue.ref(false);
  mount(() =>
    open.value
      ? Vue.h(
          AppDialog,
          {
            title: "Save changes",
            dismissible: dismissible.value,
            onClose: () => (open.value = false),
          },
          {
            default: () =>
              Vue.h("button", { id: "save-dialog-action" }, "Save"),
          },
        )
      : Vue.h("span"),
  );
  await vi.waitFor(() =>
    expect(document.querySelector('[role="dialog"]')).not.toBeNull(),
  );
  const action = document.querySelector("#save-dialog-action")!;
  key(action, "Escape");
  await Vue.nextTick();
  expect(open.value).toBe(true);
  dismissible.value = true;
  await Vue.nextTick();
  key(action, "Escape");
  await vi.waitFor(() =>
    expect(document.querySelector('[role="dialog"]')).toBeNull(),
  );
  await vi.waitFor(() => expect(document.activeElement).toBe(opener));
});

it("opens a context menu at a requested location and invokes the chosen action", async () => {
  const menu = Vue.ref<any>(),
    run = vi.fn();
  const host = mount(() =>
    Vue.h("div", [
      Vue.h(
        "button",
        {
          onContextmenu: (event: MouseEvent) =>
            menu.value.open(event, [{ label: "Open file", run }]),
        },
        "File",
      ),
      Vue.h(ContextMenu, { ref: menu }),
    ]),
  );
  host.querySelector("button")!.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      clientX: 100,
      clientY: 120,
    }),
  );
  await vi.waitFor(() =>
    expect(document.querySelector('[role="menuitem"]')).not.toBeNull(),
  );
  const item = document.querySelector('[role="menuitem"]')!;
  item.focus();
  key(item, "Enter");
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  await vi.waitFor(() =>
    expect(document.querySelector('[role="menu"]')).toBeNull(),
  );
});
