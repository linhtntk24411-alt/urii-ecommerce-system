import { Injectable, signal } from '@angular/core';

export type DialogType = 'info' | 'success' | 'warning' | 'error';

export interface DialogOptions {
  type: DialogType;
  title: string;
  message: string;
  isConfirm: boolean;
  confirmText: string;
  cancelText?: string;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  readonly currentDialog = signal<DialogOptions | null>(null);
  private currentResolver: ((value: boolean) => void) | null = null;

  alert(
    message: string,
    title = 'Thông báo',
    type: DialogType = 'info',
    confirmText = 'Đồng ý'
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      this.currentResolver = () => resolve();
      this.currentDialog.set({
        type,
        title,
        message,
        isConfirm: false,
        confirmText,
      });
    });
  }

  confirm(
    message: string,
    title = 'Xác nhận',
    confirmText = 'Đồng ý',
    cancelText = 'Hủy bỏ',
    type: DialogType = 'warning'
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.currentResolver = (val: boolean) => resolve(val);
      this.currentDialog.set({
        type,
        title,
        message,
        isConfirm: true,
        confirmText,
        cancelText,
      });
    });
  }

  onConfirm(): void {
    const resolver = this.currentResolver;
    this.currentResolver = null;
    this.currentDialog.set(null);
    if (resolver) {
      resolver(true);
    }
  }

  onCancel(): void {
    const resolver = this.currentResolver;
    this.currentResolver = null;
    this.currentDialog.set(null);
    if (resolver) {
      resolver(false);
    }
  }
}
