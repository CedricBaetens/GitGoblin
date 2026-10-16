export default defineNuxtPlugin(() => {
  let active: HTMLElement | null = null;
  let restore: HTMLElement | null = null;
  const controls = () => active ? [...active.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(element => element.getClientRects().length > 0) : [];
  const observer = new MutationObserver(() => {
    const modals = document.querySelectorAll<HTMLElement>('.modal-backdrop');
    const next = modals.length ? modals[modals.length - 1]! : null;
    if (next === active) return;
    const shell = document.querySelector<HTMLElement>('.app-shell');
    if (next) {
      if (!active) restore = document.activeElement as HTMLElement | null;
      active = next;
      if (shell) shell.inert = true;
      const first = active.querySelector<HTMLElement>('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)') || controls()[0];
      first?.focus();
    } else {
      active = null;
      if (shell) shell.inert = false;
      if (restore?.isConnected) restore.focus();
      restore = null;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('keydown', event => {
    if (!active) return;
    if (event.key === 'Escape') {
      active.querySelector<HTMLButtonElement>('button[aria-label^="Close"]:not(:disabled)')?.click();
      event.preventDefault();
    }
    if (event.key !== 'Tab') return;
    const items = controls();
    if (!items.length) { event.preventDefault(); return; }
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus(); }
    else if (!event.shiftKey && (index === -1 || index === items.length - 1)) { event.preventDefault(); items[0]?.focus(); }
  });
});
