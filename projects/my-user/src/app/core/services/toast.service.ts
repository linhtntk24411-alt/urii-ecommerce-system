import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  message: string;
  kind: ToastKind;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly messages = signal<ToastMessage[]>([]);
  private nextId = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(message: string, kind: ToastKind = 'success'): void {
    const id = ++this.nextId;
    this.messages.update((messages) => [...messages, { id, message, kind }]);
    this.timers.set(id, setTimeout(() => this.dismiss(id), 3500));
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
