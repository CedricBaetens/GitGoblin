import { readFileSync } from 'node:fs';
import { compileScript, parse } from '@vue/compiler-sfc';
import { ModuleKind, transpile } from 'typescript';
import * as Vue from 'vue';
import { afterEach, expect, it, vi } from 'vitest';

// Compile the real component so the test exercises its template event bindings.
const { descriptor } = parse(readFileSync(new URL('../app/components/DiffOverview.vue', import.meta.url), 'utf8'));
const compiled = compileScript(descriptor, { id: 'overview-test', inlineTemplate: true });
const module = { exports: {} as any };
new Function('require', 'exports', transpile(compiled.content, { module: ModuleKind.CommonJS }))(
  (name: string) => { if (name === 'vue') return Vue; throw new Error(name); }, module.exports,
);
type Node = { props: Record<string, any>; children: Node[]; [key: string]: any };
const node = (): Node => ({ props: {}, children: [] });
const renderer = Vue.createRenderer<Node, Node>({
  createElement: node, createText: node, createComment: node,
  insert: (child, parent) => { parent.children.push(child); },
  remove: () => {}, setText: () => {}, setElementText: () => {},
  parentNode: () => null, nextSibling: () => null,
  patchProp: (el, key, _old, value) => { el.props[key] = value; },
});
afterEach(() => vi.unstubAllGlobals());

it('drags the overview viewport live, keeps its grab offset, and stops after release', async () => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const scroller = {
    scrollTop: 1000, scrollHeight: 5000, clientHeight: 500,
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ top: 0 }),
    querySelectorAll: () => [],
    scrollTo({ top }: { top: number }) { this.scrollTop = Math.max(0, Math.min(4500, top)); },
  };
  const root = node();
  const app = renderer.createApp(module.exports.default, { scroller, revision: 1 });
  app.mount(root);
  const track = root.children[0]!;
  track.getBoundingClientRect = () => ({ top: 100, height: 500 });
  track.setPointerCapture = vi.fn();
  track.hasPointerCapture = () => true;
  track.releasePointerCapture = vi.fn();
  const pointer = (y: number, pointerId = 1) => ({
    button: 0, pointerId, clientY: y, currentTarget: track, target: track,
    preventDefault() {},
  });
  try {
    // Grab 20px below the viewport's top: it must not jump on press.
    track.props.onPointerdown?.(pointer(220));
    expect(scroller.scrollTop).toBe(1000);
    track.props.onPointermove?.(pointer(320));
    expect(scroller.scrollTop).toBe(2000);
    await Vue.nextTick();
    expect(track.children[0]!.props.style.top).toBe('40%');
    track.props.onPointermove?.(pointer(270));
    expect(scroller.scrollTop).toBe(1500);
    track.props.onPointermove?.(pointer(370, 2));
    expect(scroller.scrollTop).toBe(1500);
    track.props.onPointermove?.(pointer(900));
    expect(scroller.scrollTop).toBe(4500);
    track.props.onPointerup?.(pointer(900));
    track.props.onPointermove?.(pointer(270));
    expect(scroller.scrollTop).toBe(4500);
    expect(track.releasePointerCapture).toHaveBeenCalledWith(1);
    // Pressing empty track centers the viewport and starts another live drag.
    track.props.onPointerdown(pointer(200));
    expect(scroller.scrollTop).toBe(750);
    track.props.onPointercancel(pointer(200));
    track.props.onPointermove(pointer(300));
    expect(scroller.scrollTop).toBe(750);
    track.props.onPointerdown(pointer(200));
    track.props.onLostpointercapture(pointer(200));
    track.props.onPointermove(pointer(300));
    expect(scroller.scrollTop).toBe(750);
    // Marker buttons keep their click/keyboard behavior instead of starting a drag.
    track.props.onPointerdown({ ...pointer(300), target: node() });
    track.props.onPointermove(pointer(400));
    expect(scroller.scrollTop).toBe(750);
  } finally { app.unmount(); }
});
