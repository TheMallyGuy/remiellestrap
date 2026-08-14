export type ToastKind = "ok" | "warn" | "err" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

let toasts = $state<Toast[]>([]);
let seq = 0;

const TOAST_LIFETIME_MS = 4000;

export function getToasts(): Toast[] {
  return toasts;
}

export function push(kind: ToastKind, title: string, message?: string) {
  const id = ++seq;
  toasts = [...toasts, { id, kind, title, message }];
  setTimeout(() => dismiss(id), TOAST_LIFETIME_MS);
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
}

export const toast = {
  ok: (title: string, message?: string) => push("ok", title, message),
  warn: (title: string, message?: string) => push("warn", title, message),
  err: (title: string, message?: string) => push("err", title, message),
  info: (title: string, message?: string) => push("info", title, message),
};
