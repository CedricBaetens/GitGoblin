export interface ContextMenuItem {
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  separatorBefore?: boolean;
  danger?: boolean;
  run: () => unknown;
}
export interface ContextMenuHandle {
  open: (event: MouseEvent | KeyboardEvent, items: ContextMenuItem[]) => void;
  close: () => void;
}
