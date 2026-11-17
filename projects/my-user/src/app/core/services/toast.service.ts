import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: number;
  title?: string;
  message: string;
  kind: ToastKind;
  durationMs: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly messages = signal<ToastMessage[]>([]);
  private nextId = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(message: string, kind: ToastKind = 'success', title?: string, durationMs = 5000): void {
    const id = ++this.nextId;
    this.messages.update((messages) => [...messages, { id, title, message, kind, durationMs }]);
    this.timers.set(id, setTimeout(() => this.dismiss(id), durationMs));
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.messages.update((messages) => messages.filter((message) => message.id !== id));
  }
}
