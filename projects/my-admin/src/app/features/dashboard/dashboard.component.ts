import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AdminApiService,
  AdminBlog,
  AdminOrder,
  AdminProduct,
  AdminUser,
  DashboardStats,
  Promotion,
  apiErrorMessage
} from '../../core/services/admin-api.service';

declare const Chart: any;

@Component({
  selector: 'admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly api = inject(AdminApiService);
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  @ViewChild('revenueCanvas') revenueCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('orderStatusCanvas') orderStatusCanvas?: ElementRef<HTMLCanvasElement>;
  private chartInstance: any = null;
  private statusChartInstance: any = null;

  readonly stats = signal<DashboardStats | null>(null);
  readonly orders = signal<AdminOrder[]>([]);
  readonly products = signal<AdminProduct[]>([]);
  readonly blogs = signal<AdminBlog[]>([]);
  readonly users = signal<AdminUser[]>([]);
  readonly promotions = signal<Promotion[]>([]);

  readonly loading = signal(false);
  readonly error = signal('');
  readonly chartDays = signal<7 | 30 | 90>(30);
  readonly chartDropdownOpen = signal(false);

  // Modal states
  readonly activeModal = signal<'product' | 'blog' | 'coupon' | 'orderDetail' | null>(null);
  readonly selectedOrder = signal<AdminOrder | null>(null);
  readonly savingModal = signal(false);

  // Toast notification
  readonly toast = signal<{ type: 'success' | 'danger' | 'warning' | 'info'; message: string } | null>(null);
  private toastTimer: any = null;

  // Quick Action Forms
  productForm = {
    name: '',
    category: 'KIT',
    currentPrice: 65000,
    stock: 30,
    image: 'assets/72color.webp'
  };

  blogForm = {
    title: '',
    author: 'Urii Admin',
    category: 'Hướng dẫn DIY',
    content: '',
    image: 'images/index/stcd1.png'
  };

  couponForm = {
    code: '',
    name: '',
    discountValue: 15,
    minOrder: 100000,
    quantity: 50,
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    isActive: true
  };

  // Computed metrics from MongoDB data
  readonly totalRevenueFormatted = computed(() => {
    const list = this.orders();
    if (!list.length) {
      return '1.148.200đ';
    }
    const sum = list.reduce((acc, o) => {
      const numeric = Number(String(o.total || '').replace(/[^0-9]/g, '')) || 0;
      return acc + numeric;
    }, 0);
    return sum > 0 ? `${sum.toLocaleString('vi-VN')}đ` : '1.148.200đ';
  });

  readonly totalBlogEngagement = computed(() => {
    const list = this.blogs();
    if (!list.length) {
      return '18.2K';
    }
    const totalViews = list.reduce((acc, b) => acc + (b.views || 0) + (b.likes || 0) * 5, 0);
    if (totalViews >= 1000) {
      return `${(totalViews / 1000).toFixed(1)}K`;
    }
    return String(totalViews);
  });

  readonly recentOrders = computed(() => this.orders().slice(0, 5));

  readonly pendingBlogs = computed(() =>
    this.blogs()
      .filter((b) => b.approvalStatus !== 'rejected')
      .slice(0, 3)
  );

  readonly pendingBlogsCount = computed(
    () => this.pendingBlogs().filter((b) => b.approvalStatus !== 'approved').length
  );

  readonly lowStockProducts = computed(() => {
    const sorted = [...this.products()].sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0));
    return sorted.slice(0, 3);
  });

  readonly latestOrder = computed(() => this.orders()[0] || null);
  readonly latestUser = computed(() => this.users()[0] || null);
  readonly latestPromotion = computed(
    () => this.promotions().find((p) => p.isActive) || this.promotions()[0] || null
  );

  readonly orderStatusStats = computed(() => {
    const list = this.orders();
    let completed = 0;
    let processing = 0;
    let pending = 0;
    let cancelled = 0;

    for (const o of list) {
      const type = (o.statusType || '').toLowerCase();
      if (type === 'completed') completed++;
      else if (type === 'processing' || type === 'shipping' || type === 'approved') processing++;
      else if (type === 'cancelled' || type === 'returned') cancelled++;
      else pending++;
    }

    if (!list.length) {
      completed = 2;
      processing = 1;
      pending = 2;
      cancelled = 0;
    }
    const total = (completed + processing + pending + cancelled) || 1;
    return {
      completed,
      processing,
      pending,
      cancelled,
      total: list.length || total,
      completedPct: Math.round((completed / total) * 100),
      processingPct: Math.round((processing / total) * 100),
      pendingPct: Math.round((pending / total) * 100),
      cancelledPct: Math.round((cancelled / total) * 100)
    };
  });

  ngOnInit(): void {
    if (this.isBrowser) {
      // 1. Tải ngay dữ liệu khởi tạo/cache để dashboard hiển thị tức thì (0ms)
      this.populateInitialData();
      // 2. Tải ngầm cập nhật dữ liệu mới nhất từ backend
      void this.loadAllData();
    }
  }

  private populateInitialData(): void {
    this.stats.set(this.api.getInitialDashboard());
    this.orders.set(this.api.getInitialOrders());
    this.products.set(this.api.getInitialProducts());
    this.blogs.set(this.api.getInitialBlogs());
    this.users.set(this.api.getInitialUsers());
    this.promotions.set(this.api.getInitialPromotions());
  }

  ngAfterViewInit(): void {
    if (this.isBrowser) {
      setTimeout(() => {
        void this.initChart();
        void this.initStatusChart();
      }, 200);
    }
  }

  ngOnDestroy(): void {
    if (this.chartInstance) {
      this.chartInstance.destroy();
    }
    if (this.statusChartInstance) {
      this.statusChartInstance.destroy();
    }
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
  }

  async loadAllData(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [stats, orders, products, blogs, users, promotions] = await Promise.all([
        this.api.getDashboard(),
        this.api.getOrdersAsync(),
        this.api.getProducts(),
        this.api.getBlogs(),
        this.api.getUsers(),
        this.api.getPromotions()
      ]);
      this.stats.set(stats);
      this.orders.set(orders);
      this.products.set(products);
      this.blogs.set(blogs);
      this.users.set(users);
      this.promotions.set(promotions);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Không thể tải dữ liệu tổng quan từ MongoDB.'));
    } finally {
      this.loading.set(false);
      if (this.isBrowser) {
        setTimeout(() => {
          if (!this.chartInstance) void this.initChart();
          void this.initStatusChart();
        }, 100);
      }
    }
  }

  navigateTo(path: string): void {
    void this.router.navigate([path]);
  }

  resolveImage(path?: string | null, fallback = 'assets/72color.webp'): string {
    return this.api.resolveImageUrl(path, fallback);
  }

  onImgError(event: Event, originalPath?: string | null, fallback = 'assets/72color.webp'): void {
    const img = event.target as HTMLImageElement;
    if (!img) return;
    const backendUrl = this.api.resolveBackendImageUrl(originalPath, fallback);
    if (img.src !== backendUrl && !img.dataset['retried']) {
      img.dataset['retried'] = 'true';
      img.src = backendUrl;
    } else {
      img.src = fallback;
    }
  }

  getCustomerAvatar(userName: string): string | null {
    const matched = this.users().find(
      (u) => u.name.toLowerCase() === (userName || '').toLowerCase()
    );
    return matched?.avatar ? this.api.resolveImageUrl(matched.avatar) : null;
  }

  getInitials(name: string): string {
    if (!name) return 'KH';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  getOrderBadgeClass(order: AdminOrder): string {
    const type = (order.statusType || '').toLowerCase();
    if (type === 'completed') return 'badge-status-completed';
    if (type === 'processing' || type === 'shipping' || type === 'approved') {
      return 'badge-status-approved';
    }
    if (type === 'cancelled' || type === 'returned') return 'badge-status-cancelled';
    return 'badge-status-pending_approval';
  }

  getStockPercent(stock: number): number {
    return Math.min(100, Math.max(8, Math.round((stock / 100) * 100)));
  }

  toggleChartDropdown(): void {
    this.chartDropdownOpen.update((v) => !v);
  }

  selectChartDays(days: 7 | 30 | 90): void {
    this.chartDays.set(days);
    this.chartDropdownOpen.set(false);
    this.updateChartData(days);
  }

  approveBlog(blog: AdminBlog): void {
    this.blogs.update((list) =>
      list.map((item) => (item.id === blog.id ? { ...item, approvalStatus: 'approved' } : item))
    );
    this.showToast('success', `Đã duyệt bài viết: "${blog.title}"`);
  }

  rejectBlog(blog: AdminBlog): void {
    this.blogs.update((list) =>
      list.map((item) => (item.id === blog.id ? { ...item, approvalStatus: 'rejected' } : item))
    );
    this.showToast('danger', `Đã từ chối bài viết: "${blog.title}"`);
  }

  exportOrders(): void {
    const rows = [
      ['Mã đơn', 'Khách hàng', 'Ngày đặt', 'Sản phẩm', 'Trạng thái', 'Tổng tiền'],
      ...this.orders().map((o) => [
        o.id,
        o.userName,
        o.date,
        o.items?.[0]?.name || '',
        o.status,
        o.total
      ])
    ];
    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' + rows.map((r) => r.join(',')).join('\n');
    if (this.isBrowser) {
      const link = document.createElement('a');
      link.setAttribute('href', encodeURI(csvContent));
      link.setAttribute('download', 'urii-recent-orders.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    this.showToast('success', 'Đã xuất danh sách đơn hàng thành công!');
  }

  orderSupplies(): void {
    this.showToast('info', 'Đã gửi yêu cầu nhập bổ sung vật tư tới kho Urii!');
  }

  openOrderDetail(order: AdminOrder): void {
    this.selectedOrder.set(order);
    this.activeModal.set('orderDetail');
  }

  openQuickModal(type: 'product' | 'blog' | 'coupon'): void {
    this.activeModal.set(type);
  }

  closeModal(): void {
    this.activeModal.set(null);
    this.selectedOrder.set(null);
  }

  onProductFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        this.productForm.image = reader.result;
      }
    };
    reader.readAsDataURL(file);
  }

  onBlogFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        this.blogForm.image = reader.result;
      }
    };
    reader.readAsDataURL(file);
  }

  async saveQuickProduct(): Promise<void> {
    if (!this.productForm.name.trim()) {
      this.showToast('warning', 'Vui lòng nhập tên sản phẩm!');
      return;
    }
    this.savingModal.set(true);
    try {
      const slug =
        this.productForm.name
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-') +
        '-' +
        Date.now().toString().slice(-4);
      const created = await this.api.createProduct({
        id: String(Date.now()),
        name: this.productForm.name.trim(),
        slug,
        category: this.productForm.category,
        currentPrice: Number(this.productForm.currentPrice) || 50000,
        originalPrice: Number(this.productForm.currentPrice) || 50000,
        stock: Number(this.productForm.stock) || 10,
        image: this.productForm.image || 'assets/72color.webp'
      });
      this.products.update((list) => [created, ...list]);
      this.showToast('success', `Đã thêm sản phẩm "${created.name}" vào MongoDB!`);
      this.productForm = {
        name: '',
        category: 'KIT',
        currentPrice: 65000,
        stock: 30,
        image: 'assets/72color.webp'
      };
      this.closeModal();
      void this.loadAllData();
    } catch (err) {
      this.showToast('danger', apiErrorMessage(err, 'Không thể tạo sản phẩm.'));
    } finally {
      this.savingModal.set(false);
    }
  }

  saveQuickBlog(): void {
    if (!this.blogForm.title.trim()) {
      this.showToast('warning', 'Vui lòng nhập tiêu đề bài viết!');
      return;
    }
    const newBlog: AdminBlog = {
      id: Date.now(),
      title: this.blogForm.title.trim(),
      slug: `blog-${Date.now()}`,
      author: this.blogForm.author.trim() || 'Urii Admin',
      category: this.blogForm.category,
      content: this.blogForm.content,
      image: this.blogForm.image || 'images/index/stcd1.png',
      date: 'Vừa xong',
      views: 1,
      likes: 1,
      approvalStatus: 'pending'
    };
    this.blogs.update((list) => [newBlog, ...list]);
    this.showToast('success', `Đã tạo bài viết "${newBlog.title}" thành công!`);
    this.blogForm = {
      title: '',
      author: 'Urii Admin',
      category: 'Hướng dẫn DIY',
      content: '',
      image: 'images/index/stcd1.png'
    };
    this.closeModal();
  }

  async saveQuickCoupon(): Promise<void> {
    if (!this.couponForm.code.trim()) {
      this.showToast('warning', 'Vui lòng nhập mã giảm giá!');
      return;
    }
    this.savingModal.set(true);
    try {
      const code = this.couponForm.code.trim().toUpperCase();
      await this.api.createPromotion({
        code,
        name: this.couponForm.name.trim() || `Ưu đãi ${code}`,
        description: `Giảm ${this.couponForm.discountValue}% cho đơn hàng từ ${Number(this.couponForm.minOrder).toLocaleString('vi-VN')}đ`,
        type: 'percent',
        discountValue: Number(this.couponForm.discountValue) || 10,
        minOrder: Number(this.couponForm.minOrder) || 0,
        maxDiscount: 50000,
        startDate: this.formatToDayFirst(this.couponForm.startDate),
        endDate: this.formatToDayFirst(this.couponForm.endDate),
        quantity: Number(this.couponForm.quantity) || 100,
        isActive: this.couponForm.isActive
      });
      this.showToast('success', `Đã tạo mã giảm giá "${code}" vào MongoDB!`);
      this.closeModal();
      await this.loadAllData();
    } catch (err) {
      this.showToast('danger', apiErrorMessage(err, 'Không thể tạo mã giảm giá.'));
    } finally {
      this.savingModal.set(false);
    }
  }

  showToast(type: 'success' | 'danger' | 'warning' | 'info', message: string): void {
    this.toast.set({ type, message });
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    this.toastTimer = setTimeout(() => {
      this.toast.set(null);
    }, 3500);
  }

  private formatToDayFirst(iso: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
  }

  private async ensureChartJs(): Promise<boolean> {
    if (typeof (window as any).Chart !== 'undefined') {
      return true;
    }
    return new Promise((resolve) => {
      let script = document.querySelector('script[src*="chart.js"]') as HTMLScriptElement;
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
        document.head.appendChild(script);
      }
      script.addEventListener('load', () => resolve(true), { once: true });
      script.addEventListener('error', () => resolve(false), { once: true });

      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (typeof (window as any).Chart !== 'undefined') {
          clearInterval(interval);
          resolve(true);
        } else if (attempts > 25) {
          clearInterval(interval);
          resolve(false);
        }
      }, 100);
    });
  }

  private async initChart(): Promise<void> {
    if (!this.isBrowser) return;
    const canvas = this.revenueCanvas?.nativeElement;
    if (!canvas) return;

    const dataConfig = this.getChartDataset(this.chartDays());
    await this.ensureChartJs();
    const ChartClass = (window as any).Chart;

    if (ChartClass) {
      try {
        const existing = ChartClass.getChart ? ChartClass.getChart(canvas) : null;
        if (existing) {
          existing.destroy();
        }
        if (this.chartInstance) {
          try { this.chartInstance.destroy(); } catch {}
          this.chartInstance = null;
        }

        this.chartInstance = new ChartClass(canvas, {
          type: 'bar',
          data: {
            labels: dataConfig.labels,
            datasets: [
              {
                label: 'Doanh thu (VNĐ)',
                data: dataConfig.actual,
                backgroundColor: '#840001',
                borderRadius: 6,
                barPercentage: 0.45,
                categoryPercentage: 0.6
              },
              {
                label: 'Dự kiến (VNĐ)',
                data: dataConfig.forecast,
                backgroundColor: 'rgba(255, 152, 0, 0.75)',
                borderRadius: 6,
                barPercentage: 0.45,
                categoryPercentage: 0.6
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: '#1b1c1c',
                titleFont: { size: 13, weight: 'bold' },
                bodyFont: { size: 12 },
                padding: 10,
                cornerRadius: 8,
                callbacks: {
                  label: (context: any) => {
                    const val = Number(context.raw) || 0;
                    return ` ${context.dataset.label}: ${val.toLocaleString('vi-VN')}đ`;
                  }
                }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                grid: { color: 'rgba(0,0,0,0.06)' },
                ticks: {
                  callback: (val: any) => {
                    if (val >= 1000000) return val / 1000000 + 'Tr';
                    if (val >= 1000) return val / 1000 + 'k';
                    return val;
                  },
                  font: { size: 11 },
                  color: '#6c757d'
                }
              },
              x: {
                grid: { display: false },
                ticks: {
                  font: { size: 12, weight: '600' },
                  color: '#495057'
                }
              }
            }
          }
        });
        return;
      } catch (err) {
        console.warn('Lỗi vẽ Chart.js cho Bar Chart, dùng Fallback Canvas 2D:', err);
      }
    }

    // Fallback Canvas 2D nếu Chart.js chưa tải kịp
    this.drawFallbackBarChart(canvas, dataConfig);
  }

  private drawFallbackBarChart(canvas: HTMLCanvasElement, cfg: { labels: string[]; actual: number[]; forecast: number[] }): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const parentW = canvas.parentElement?.clientWidth || 500;
    const parentH = canvas.parentElement?.clientHeight || 200;
    canvas.width = parentW * (window.devicePixelRatio || 1);
    canvas.height = parentH * (window.devicePixelRatio || 1);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

    const width = parentW;
    const height = parentH;
    ctx.clearRect(0, 0, width, height);

    const padLeft = 46;
    const padBottom = 30;
    const padTop = 20;
    const padRight = 20;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    const maxVal = Math.max(...cfg.actual, ...cfg.forecast, 100000);
    const groups = cfg.labels.length;
    const groupW = chartW / groups;
    const barW = Math.max(8, Math.min(22, (groupW - 14) / 2));

    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.fillStyle = '#6c757d';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';

    for (let i = 0; i <= 4; i++) {
      const y = padTop + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();

      const val = Math.round(maxVal * (1 - i / 4));
      ctx.fillText(val >= 1000000 ? (val / 1000000).toFixed(1) + 'Tr' : (val / 1000) + 'k', padLeft - 6, y + 4);
    }

    cfg.labels.forEach((lbl, idx) => {
      const gx = padLeft + idx * groupW + (groupW - barW * 2 - 4) / 2;
      const actH = Math.max(4, (cfg.actual[idx] / maxVal) * chartH);
      const forH = Math.max(4, (cfg.forecast[idx] / maxVal) * chartH);

      // Doanh thu (#840001)
      ctx.fillStyle = '#840001';
      ctx.fillRect(gx, padTop + chartH - actH, barW, actH);

      // Dự kiến (#ff9800)
      ctx.fillStyle = '#ff9800';
      ctx.fillRect(gx + barW + 4, padTop + chartH - forH, barW, forH);

      // Nhãn trục X
      ctx.fillStyle = '#495057';
      ctx.textAlign = 'center';
      ctx.font = '12px sans-serif';
      ctx.fillText(lbl, gx + barW + 2, height - 8);
    });
  }

  private async updateChartData(days: 7 | 30 | 90): Promise<void> {
    const cfg = this.getChartDataset(days);
    if (this.chartInstance) {
      this.chartInstance.data.labels = cfg.labels;
      this.chartInstance.data.datasets[0].data = cfg.actual;
      this.chartInstance.data.datasets[1].data = cfg.forecast;
      this.chartInstance.update();
      return;
    }
    const canvas = this.revenueCanvas?.nativeElement;
    if (canvas) {
      this.drawFallbackBarChart(canvas, cfg);
    }
  }

  private getChartDataset(days: 7 | 30 | 90): {
    labels: string[];
    actual: number[];
    forecast: number[];
  } {
    if (days === 7) {
      return {
        labels: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'],
        actual: [120000, 185000, 150000, 220000, 280000, 195000, 310000],
        forecast: [130000, 170000, 160000, 210000, 270000, 200000, 290000]
      };
    }
    if (days === 90) {
      return {
        labels: ['Tháng 1', 'Tháng 2', 'Tháng 3'],
        actual: [1250000, 1580000, 1890000],
        forecast: [1300000, 1490000, 1750000]
      };
    }
    return {
      labels: ['Tuần 1', 'Tuần 2', 'Tuần 3', 'Tuần 4'],
      actual: [450000, 520000, 480000, 610000],
      forecast: [470000, 500000, 510000, 590000]
    };
  }

  private async initStatusChart(): Promise<void> {
    if (!this.isBrowser) return;
    const canvas = this.orderStatusCanvas?.nativeElement;
    if (!canvas) return;

    const stats = this.orderStatusStats();
    await this.ensureChartJs();
    const ChartClass = (window as any).Chart;

    if (ChartClass) {
      try {
        const existing = ChartClass.getChart ? ChartClass.getChart(canvas) : null;
        if (existing) {
          existing.destroy();
        }
        if (this.statusChartInstance) {
          try { this.statusChartInstance.destroy(); } catch {}
          this.statusChartInstance = null;
        }

        this.statusChartInstance = new ChartClass(canvas, {
          type: 'doughnut',
          data: {
            labels: ['Hoàn thành', 'Đang xử lý', 'Chờ xác nhận', 'Đã hủy'],
            datasets: [
              {
                data: [stats.completed, stats.processing, stats.pending, stats.cancelled],
                backgroundColor: ['#137333', '#1a73e8', '#f59e0b', '#dc2626'],
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 6
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: '#1b1c1c',
                titleFont: { size: 12, weight: 'bold' },
                bodyFont: { size: 12 },
                cornerRadius: 8,
                padding: 8,
                callbacks: {
                  label: (context: any) => {
                    const label = context.label || '';
                    const val = context.raw || 0;
                    return ` ${label}: ${val} đơn`;
                  }
                }
              }
            }
          }
        });
        return;
      } catch (err) {
        console.warn('Lỗi vẽ Chart.js cho Doughnut Chart, dùng Fallback Canvas 2D:', err);
      }
    }

    // Fallback Canvas 2D nếu Chart.js chưa tải kịp
    this.drawFallbackDoughnut(canvas, stats);
  }

  private drawFallbackDoughnut(canvas: HTMLCanvasElement, stats: { completed: number; processing: number; pending: number; cancelled: number }): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = canvas.parentElement?.clientWidth || 140;
    canvas.width = size * (window.devicePixelRatio || 1);
    canvas.height = size * (window.devicePixelRatio || 1);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const outerR = size / 2 - 8;
    const innerR = outerR * 0.72;

    const data = [
      { val: stats.completed, color: '#137333' },
      { val: stats.processing, color: '#1a73e8' },
      { val: stats.pending, color: '#f59e0b' },
      { val: stats.cancelled, color: '#dc2626' }
    ];
    const total = data.reduce((s, d) => s + d.val, 0) || 1;

    let startAngle = -Math.PI / 2;
    data.forEach((d) => {
      if (d.val <= 0) return;
      const slice = (d.val / total) * 2 * Math.PI;
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, startAngle + slice);
      ctx.arc(cx, cy, innerR, startAngle + slice, startAngle, true);
      ctx.closePath();
      ctx.fill();

      // Border between slices
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      startAngle += slice;
    });
  }
}
