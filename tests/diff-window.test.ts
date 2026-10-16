import { expect, it } from 'vitest';
import { diffWindow } from '../app/lib/diff-window';

it('bounds rendered rows while retaining the complete scrollable file', () => {
  for (const scroll of [0, 150_000, 398_000]) {
    const w = diffWindow(17_000, 50, scroll, 600);
    expect(w.end - w.start).toBeLessThanOrEqual(58);
    expect(w.before + (w.end - w.start) * 23 + w.after).toBe(17_000 * 23);
  }
});

it('handles hunks outside the viewport without rendering their lines', () => {
  expect(diffWindow(100, 10_000, 0, 600)).toEqual({ start: 0, end: 0, before: 0, after: 2300 });
  expect(diffWindow(100, 50, 10_000, 600)).toEqual({ start: 100, end: 100, before: 2300, after: 0 });
});
