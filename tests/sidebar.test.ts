import { expect, it } from 'vitest';
import { clampSidebarWidth, sidebarKeyboardWidth } from '../app/lib/sidebar';

it('bounds stored and dragged widths while keeping room for the workspace', () => {
  expect(clampSidebarWidth(120, 1440)).toBe(220);
  expect(clampSidebarWidth(700, 1440)).toBe(480);
  expect(clampSidebarWidth(480, 1000)).toBe(440);
  expect(clampSidebarWidth(NaN, 1440)).toBe(280);
  expect(clampSidebarWidth(320, 1440)).toBe(320);
});

it('supports bounded keyboard resizing and leaves other keys alone', () => {
  expect(sidebarKeyboardWidth('ArrowRight', 280, 1440)).toBe(296);
  expect(sidebarKeyboardWidth('ArrowLeft', 280, 1440, true)).toBe(248);
  expect(sidebarKeyboardWidth('ArrowLeft', 220, 1440)).toBe(220);
  expect(sidebarKeyboardWidth('Home', 400, 1440)).toBe(220);
  expect(sidebarKeyboardWidth('End', 280, 1000)).toBe(440);
  expect(sidebarKeyboardWidth('Tab', 280, 1440)).toBeUndefined();
});
