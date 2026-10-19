export const defaultSidebarWidth = 280;
export const minSidebarWidth = 220;
export const maxSidebarWidth = (viewport: number) => Math.max(minSidebarWidth, Math.min(480, viewport - 560));
export function clampSidebarWidth(width: number, viewport: number) {
  return Math.round(Math.max(minSidebarWidth, Math.min(maxSidebarWidth(viewport), Number.isFinite(width) ? width : defaultSidebarWidth)));
}
export function sidebarKeyboardWidth(key: string, width: number, viewport: number, shift = false) {
  const step = shift ? 32 : 16;
  if (key === 'Home') return minSidebarWidth;
  if (key === 'End') return maxSidebarWidth(viewport);
  if (key === 'ArrowLeft' || key === 'ArrowRight')
    return clampSidebarWidth(width + (key === 'ArrowRight' ? step : -step), viewport);
}
