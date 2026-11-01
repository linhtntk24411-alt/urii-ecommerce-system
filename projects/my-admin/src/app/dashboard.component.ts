import { isPlatformBrowser } from '@angular/common';
import { Component, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { AdminApiService, DashboardStats, apiErrorMessage } from './admin-api.service';

@Component({
  selector: 'admin-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly stats = signal<DashboardStats | null>(null);
  readonly error = signal('');
  readonly loading = signal(false);

  ngOnInit(): void {
    if (this.isBrowser && this.api.token()) {
      void this.load();
    }
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.stats.set(await this.api.getDashboard());
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Không thể tải dữ liệu tổng quan.'));
    } finally {
      this.loading.set(false);
    }
  }
}
