import { CommonModule } from '@angular/common';
import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-toast-notifications',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast-notifications.html',
  styleUrl: './toast-notifications.css',
})
export class ToastNotifications implements OnInit, OnDestroy {
  readonly toast = inject(ToastService);
  private readonly onCartError = (event: Event): void => {
    const message = (event as CustomEvent<unknown>).detail;
    this.toast.show(
      typeof message === 'string' ? message : 'Không thể đồng bộ giỏ hàng với máy chủ.',
      'error',
    );
  };

  ngOnInit(): void {
    if (typeof window !== 'undefined') window.addEventListener('cart:error', this.onCartError);
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') window.removeEventListener('cart:error', this.onCartError);
  }
}
