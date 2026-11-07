import { Injectable, signal } from '@angular/core';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface AppNotification {
  id: number;
  message: string;
  type: NotificationType;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly notificationState = signal<AppNotification[]>([]);
  private nextId = 0;

  readonly notifications = this.notificationState.asReadonly();

  success(message: string, durationMs = 5000): number {
    return this.notify(message, 'success', durationMs);
  }

  error(message: string, durationMs = 5000): number {
    return this.notify(message, 'error', durationMs);
  }

  warning(message: string, durationMs = 5000): number {
    return this.notify(message, 'warning', durationMs);
  }

  info(message: string, durationMs = 5000): number {
    return this.notify(message, 'info', durationMs);
  }

  dismiss(id: number): void {
    this.notificationState.update((items) => items.filter((item) => item.id !== id));
  }

  clear(): void {
    this.notificationState.set([]);
  }

  private notify(message: string, type: NotificationType, durationMs: number): number {
    if (!message.trim()) {
      throw new Error('A notification message cannot be empty.');
    }

    const id = ++this.nextId;
    this.notificationState.update((items) => [...items, { id, message, type }]);

    if (durationMs > 0) {
      setTimeout(() => this.dismiss(id), durationMs);
    }

    return id;
  }
}
