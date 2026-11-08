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

export interface LoginPromptOptions {
  eyebrow?: string;
  title: string;
  description: string;
  returnUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  readonly currentDialog = signal<DialogOptions | null>(null);
  readonly currentLoginPrompt = signal<LoginPromptOptions | null>(null);

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

  promptLogin(options?: Partial<LoginPromptOptions>): void {
    this.currentLoginPrompt.set({
      eyebrow: options?.eyebrow ?? 'Chỉ còn một bước nữa',
      title: options?.title ?? 'Đăng nhập để tiếp tục',
      description: options?.description ?? 'Vui lòng đăng nhập để lưu trữ dữ liệu và trải nghiệm đầy đủ các tính năng của Urii.',
      returnUrl: options?.returnUrl
    });
  }

  closeLoginPrompt(): void {
    this.currentLoginPrompt.set(null);
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
