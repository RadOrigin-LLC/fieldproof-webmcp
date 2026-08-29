import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type SheetStackEntry = {
  id: symbol;
  backdrop: HTMLDivElement;
  dialog: HTMLDivElement;
  opener: HTMLElement | null;
  close: () => void;
  getInitialFocusId: () => string | undefined;
  getReturnFocusId: () => string | undefined;
};

const sheetStack: SheetStackEntry[] = [];
let savedBodyOverflow: string | undefined;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function findSheetTabTarget<T>(
  controls: readonly T[],
  active: T | null | undefined,
  backwards: boolean,
): T | undefined {
  if (controls.length === 0) return undefined;
  const activeIndex = controls.indexOf(active as T);
  if (activeIndex < 0) return backwards ? controls[controls.length - 1] : controls[0];
  if (!backwards && activeIndex === controls.length - 1) return controls[0];
  if (backwards && activeIndex === 0) return controls[controls.length - 1];
  return undefined;
}

function focusableControls(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => {
    if (element.tabIndex < 0 || element.getAttribute('aria-disabled') === 'true') return false;
    if (element.closest('[inert], [aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

function focusElement(element: HTMLElement | null | undefined): void {
  if (!element?.isConnected) return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function topSheet(): SheetStackEntry | undefined {
  return sheetStack[sheetStack.length - 1];
}

function initialFocus(entry: SheetStackEntry): HTMLElement {
  const requestedId = entry.getInitialFocusId();
  const requested = requestedId ? document.getElementById(requestedId) : null;
  if (requested instanceof HTMLElement && entry.dialog.contains(requested)) return requested;
  const active = document.activeElement;
  if (active instanceof HTMLElement && entry.dialog.contains(active)) return active;
  return focusableControls(entry.dialog)[0] ?? entry.dialog;
}

function handleSheetKeydown(event: KeyboardEvent): void {
  const entry = topSheet();
  if (!entry) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    entry.close();
    return;
  }

  if (event.key !== 'Tab') return;
  const controls = focusableControls(entry.dialog);
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const target = findSheetTabTarget(controls, active, event.shiftKey);
  if (target) {
    event.preventDefault();
    focusElement(target);
  } else if (controls.length === 0) {
    event.preventDefault();
    focusElement(entry.dialog);
  }
}

function handleSheetFocus(event: FocusEvent): void {
  const entry = topSheet();
  if (!entry || !(event.target instanceof Node) || entry.dialog.contains(event.target)) return;
  focusElement(initialFocus(entry));
}

function syncSheetStack(): void {
  const lastIndex = sheetStack.length - 1;
  sheetStack.forEach((entry, index) => {
    const isTop = index === lastIndex;
    entry.backdrop.style.zIndex = String(60 + index * 2);
    entry.backdrop.toggleAttribute('inert', !isTop);
    if (isTop) entry.backdrop.removeAttribute('aria-hidden');
    else entry.backdrop.setAttribute('aria-hidden', 'true');
  });
}

function addSheet(entry: SheetStackEntry): void {
  if (sheetStack.length === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleSheetKeydown);
    document.addEventListener('focusin', handleSheetFocus);
  }
  sheetStack.push(entry);
  syncSheetStack();
  focusElement(initialFocus(entry));
}

function scheduleFocusReturn(entry: SheetStackEntry): void {
  queueMicrotask(() => {
    const fallbackId = entry.getReturnFocusId();
    const fallback = fallbackId ? document.getElementById(fallbackId) : null;
    const opener =
      entry.opener && entry.opener !== document.body && entry.opener !== document.documentElement
        ? entry.opener
        : null;
    const target = opener?.isConnected ? opener : fallback instanceof HTMLElement ? fallback : null;
    const currentTop = topSheet();
    if (currentTop && target && !currentTop.dialog.contains(target)) return;
    focusElement(target);
  });
}

function removeSheet(entry: SheetStackEntry): void {
  const index = sheetStack.findIndex((item) => item.id === entry.id);
  if (index >= 0) sheetStack.splice(index, 1);
  syncSheetStack();

  if (sheetStack.length === 0) {
    document.removeEventListener('keydown', handleSheetKeydown);
    document.removeEventListener('focusin', handleSheetFocus);
    document.body.style.overflow = savedBodyOverflow ?? '';
    savedBodyOverflow = undefined;
  }
  scheduleFocusReturn(entry);
}

export function Sheet({
  title,
  onClose,
  children,
  variant = 'default',
  fullHeightOnMobile = false,
  initialFocusId,
  returnFocusId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  variant?: 'default' | 'wide';
  fullHeightOnMobile?: boolean;
  initialFocusId?: string;
  returnFocusId?: string;
}) {
  const titleId = useId();
  const stackId = useRef(Symbol('sheet'));
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const initialFocusIdRef = useRef(initialFocusId);
  const returnFocusIdRef = useRef(returnFocusId);
  const openerRef = useRef<HTMLElement | null | undefined>(undefined);

  onCloseRef.current = onClose;
  initialFocusIdRef.current = initialFocusId;
  returnFocusIdRef.current = returnFocusId;
  if (openerRef.current === undefined) {
    openerRef.current =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }

  useEffect(() => {
    const backdrop = backdropRef.current;
    const dialog = dialogRef.current;
    if (!backdrop || !dialog) return;
    const entry: SheetStackEntry = {
      id: stackId.current,
      backdrop,
      dialog,
      opener: openerRef.current ?? null,
      close: () => onCloseRef.current(),
      getInitialFocusId: () => initialFocusIdRef.current,
      getReturnFocusId: () => returnFocusIdRef.current,
    };
    addSheet(entry);
    return () => removeSheet(entry);
  }, []);

  const sheetClass = [
    'sheet',
    variant === 'wide' ? 'sheet-wide' : '',
    fullHeightOnMobile ? 'sheet-full-height-mobile' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <div
      className="sheet-backdrop"
      ref={backdropRef}
      onClick={(event) => {
        if (event.target === event.currentTarget && topSheet()?.id === stackId.current) {
          onCloseRef.current();
        }
      }}
    >
      <div
        className={sheetClass}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className="sheet-head">
          <h2 className="sheet-title" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            className="sheet-close"
            onClick={() => onCloseRef.current()}
            aria-label={`Close ${title}`}
          >
            ✕
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}
