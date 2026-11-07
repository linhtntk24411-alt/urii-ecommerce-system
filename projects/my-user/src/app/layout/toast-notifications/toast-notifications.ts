import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-toast-notifications',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast-notifications.html',
  styleUrl: './toast-notifications.css',
})
export class ToastNotifications {
  readonly toast = inject(ToastService);
}
