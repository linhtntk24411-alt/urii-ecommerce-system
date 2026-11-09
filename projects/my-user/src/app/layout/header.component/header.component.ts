import { HttpClient, HttpHeaders } from '@angular/common/http';
import { afterNextRender, ChangeDetectorRef, Component, HostListener, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { CartService } from '../../core/services/cart.service';
import { Subscription, TimeoutError, timeout } from 'rxjs';
import { HeaderSearch } from '../header-search/header-search.component';
import { NotificationService } from '../../core/services/notification.service';

interface CurrentUserProfile {
  id?: string;
  _id?: string;
  name: string;
  email: string;
  avatar?: string;
}

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterLink, HeaderSearch],
  templateUrl: './header.component.html',
  styleUrl: './header.component.css'
})
export class HeaderComponent implements OnInit, OnDestroy {
  isLoggedIn: boolean = false;
  authStatusReady = false;
  userName: string = '';
  userEmail: string = '';
  userAvatar: string = '';
  cartCount: number = 0;
  notificationCount: number = 0; 

  // --- THÔNG BÁO CHO USER ---
  isNotificationOpen = false;
  notifications: any[] = [];
  notificationLoadError = '';
  private isMarkingNotificationsRead = false;
  private notificationPollInterval: any;
  
  isMobileMenuOpen: boolean = false;
  isMobileProductOpen: boolean = true;
  isAccountMenuOpen = false;
  isLogoutModalOpen: boolean = false;
  
  private storageListener: any;
  private authChangeListener: (() => void) | null = null;
  private cartChangeListener: (() => void) | null = null;
  private profileRequest?: Subscription;

  constructor(
    private readonly http: HttpClient,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object,
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly cart: CartService,
    private readonly toastNotification: NotificationService
  ) {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;

      this.checkAuthStatus();
      this.updateCartBadge();
      this.loadCurrentUser();
      this.loadNotifications();

      this.notificationPollInterval = setInterval(() => {
        if (this.isLoggedIn) {
          this.loadNotifications(true);
        }
      }, 3500);
      this.changeDetectorRef.markForCheck();
    });
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.checkAuthStatus();
      this.updateCartBadge();
      this.refreshCartBadgeFromServer();
      this.loadCurrentUser();
      this.loadNotifications();

      this.storageListener = (e: StorageEvent) => {
        if (!e.key || e.key.startsWith('cartItems') || e.key === 'cart_count' || e.key === 'isLoggedIn' || e.key === 'userName' || e.key === 'userEmail' || e.key === 'userAvatar' || e.key === 'userRole' || e.key === 'authToken') {
          this.checkAuthStatus();
          this.updateCartBadge();
          if (e.key === 'isLoggedIn' || e.key === 'userId' || e.key === 'authToken') {
            this.refreshCartBadgeFromServer();
          }
          this.loadCurrentUser();
          this.loadNotifications();
          this.changeDetectorRef.detectChanges();
        }
      };
      this.authChangeListener = () => {
        this.checkAuthStatus();
        this.updateCartBadge();
        this.refreshCartBadgeFromServer();
        this.loadCurrentUser();
        this.loadNotifications();
        this.changeDetectorRef.detectChanges();
      };
      this.cartChangeListener = () => {
        this.updateCartBadge();
        this.changeDetectorRef.detectChanges();
      };
      window.addEventListener('storage', this.storageListener);
      window.addEventListener('auth:changed', this.authChangeListener);
      window.addEventListener('cart:updated', this.cartChangeListener);
    }
  }

  ngOnDestroy(): void {
    this.profileRequest?.unsubscribe();
    if (this.notificationPollInterval) {
      clearInterval(this.notificationPollInterval);
    }
    if (isPlatformBrowser(this.platformId)) {
      if (this.storageListener) {
        window.removeEventListener('storage', this.storageListener);
      }
      if (this.authChangeListener) {
        window.removeEventListener('auth:changed', this.authChangeListener);
      }
      if (this.cartChangeListener) {
        window.removeEventListener('cart:updated', this.cartChangeListener);
      }
    }
  }

  private loadCurrentUser(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.profileRequest?.unsubscribe();
    const token = localStorage.getItem('authToken');
    if (localStorage.getItem('isLoggedIn') !== 'true' || !token) return;

    this.profileRequest = this.http.get<CurrentUserProfile>('/api/auth/me', {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
    }).pipe(
      timeout({ first: 8000 }),
    ).subscribe({
      next: (profile) => {
        if (!profile || typeof profile.email !== 'string' || typeof profile.name !== 'string') {
          console.error('API hồ sơ cá nhân trả về dữ liệu không hợp lệ.');
          return;
        }

        this.userName = profile.name;
        this.userEmail = profile.email;
        this.userAvatar = this.normalizeAvatar(profile.avatar ?? '');
        localStorage.setItem('userName', this.userName);
        localStorage.setItem('userEmail', this.userEmail);
        localStorage.setItem('userAvatar', this.userAvatar);
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        if (error instanceof TimeoutError) {
          console.error('Tải hồ sơ cá nhân quá thời gian chờ.');
        } else {
          console.error('Không thể tải hồ sơ cá nhân từ API:', error);
        }
      },
    });
  }

  private normalizeAvatar(avatar: string): string {
    if (avatar.startsWith('/images/')) return `/api${avatar}`;
    if (avatar.startsWith('images/')) return `/api/${avatar}`;
    return avatar;
  }

  checkAuthStatus(): void {
    const logged = localStorage.getItem('isLoggedIn') === 'true';
    this.isLoggedIn = logged;
    this.authStatusReady = true;
    if (logged) {
      this.userName = localStorage.getItem('userName') || 'Khách hàng';
      this.userEmail = localStorage.getItem('userEmail') || '';
      this.userAvatar = localStorage.getItem('userAvatar') || '';
    } else {
      this.userName = '';
      this.userEmail = '';
      this.userAvatar = '';
      this.notifications = [];
      this.notificationCount = 0;
      this.isNotificationOpen = false;
    }
  }

  // ================= NOTIFICATIONS =================
  loadNotifications(silent = false): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const token = localStorage.getItem('authToken');
    if (localStorage.getItem('isLoggedIn') !== 'true' || !token) {
      this.notifications = [];
      this.notificationCount = 0;
      return;
    }

    if (!silent) {
      this.notificationLoadError = '';
    }
    this.http.get<any>('/api/notifications/mine?page=1&limit=50', {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` })
    }).subscribe({
      next: (response) => {
        const list = Array.isArray(response)
          ? response
          : Array.isArray(response?.notifications)
            ? response.notifications
            : [];

        const mapped = list.map((notif: any) => ({
          ...notif,
          desc: notif.message || notif.desc || '',
          time: this.formatNotificationTime(notif.createdAt || notif.updatedAt)
        }));

        const newCount = response?.unreadCount !== undefined
          ? Number(response.unreadCount)
          : mapped.filter((n: any) => !n.isRead).length;

        // Nếu có thông báo mới khi người dùng đang online -> hiển thị Toast thông báo
        if (silent && newCount > this.notificationCount && mapped.length > 0) {
          const newest = mapped[0];
          if (newest && !newest.isRead) {
            const toastMsg = newest.title
              ? `${newest.title}: ${newest.desc || ''}`
              : (newest.desc || 'Bạn có thông báo mới từ Urii!');
            this.toastNotification.info(toastMsg.slice(0, 120));
          }
        }

        this.notifications = mapped;
        this.notificationCount = newCount;
        this.changeDetectorRef.markForCheck();
      },
      error: (err) => {
        if (!silent) {
          console.error('Lỗi tải thông báo người dùng:', err);
          this.notificationLoadError = 'Không thể tải thông báo.';
          this.changeDetectorRef.markForCheck();
        }
      }
    });
  }

  toggleNotifications(event: Event): void {
    event.stopPropagation();
    this.isAccountMenuOpen = false;
    this.isNotificationOpen = !this.isNotificationOpen;
    if (this.isNotificationOpen) {
      this.loadNotifications();
    }
    this.changeDetectorRef.markForCheck();
  }

  getNotificationUrl(actionUrl?: string): string {
    if (!actionUrl) return '/';
    let url = actionUrl.trim();
    if (url.startsWith('/account/orders/')) {
      return url.replace('/account/orders/', '/orders/');
    }
    if (url === '/account/orders') {
      return '/orders';
    }
    if (url.startsWith('/account/profile')) {
      return '/profile';
    }
    if (url.startsWith('/custom-order/')) {
      return url.replace('/custom-order/', '/custom-order-list/');
    }
    if (url === '/custom-order') {
      return '/custom-order-list';
    }
    if (url.startsWith('/blogs/')) {
      return url.replace('/blogs/', '/blog-detail/');
    }
    if (url.startsWith('/vouchers')) {
      return '/profile';
    }
    if (url.startsWith('/chat')) {
      return '/support';
    }
    return url;
  }

  onNotificationClick(notif: any): void {
    this.markOneAsRead(notif);
    this.isNotificationOpen = false;
    this.changeDetectorRef.markForCheck();
    if (notif.actionUrl) {
      const target = this.getNotificationUrl(notif.actionUrl);
      void this.router.navigateByUrl(target);
    }
  }

  clearAllNotifications(): void {
    if (this.isMarkingNotificationsRead || this.notificationCount === 0) return;
    const token = localStorage.getItem('authToken');
    if (!token) return;

    this.isMarkingNotificationsRead = true;
    this.http.patch<any>('/api/notifications/read-all', {}, {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` })
    }).subscribe({
      next: () => {
        this.notificationCount = 0;
        this.notifications.forEach(n => n.isRead = true);
        this.isMarkingNotificationsRead = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (err) => {
        console.error('Lỗi đánh dấu đã đọc tất cả thông báo:', err);
        this.isMarkingNotificationsRead = false;
      }
    });
  }

  markOneAsRead(notif: any): void {
    if (notif.isRead) return;
    const token = localStorage.getItem('authToken');
    const notifId = notif._id || notif.id;
    if (!token || !notifId) return;

    this.http.patch<any>(`/api/notifications/${notifId}/read`, {}, {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` })
    }).subscribe({
      next: () => {
        notif.isRead = true;
        if (this.notificationCount > 0) {
          this.notificationCount--;
        }
        this.changeDetectorRef.markForCheck();
      },
      error: (err) => console.error('Lỗi đánh dấu đã đọc:', err)
    });
  }

  private formatNotificationTime(value?: string): string {
    if (!value) return 'Vừa xong';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Vừa xong';

    const diffMs = Date.now() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    if (diffMinutes < 1) return 'Vừa xong';
    if (diffMinutes < 60) return `${diffMinutes} phút trước`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} giờ trước`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} ngày trước`;
    return date.toLocaleDateString('vi-VN');
  }

  updateCartBadge(): void {
    try {
      this.cartCount = this.cart.getItemCount();
    } catch (error) {
      console.error('Không thể tải số lượng giỏ hàng:', error);
      this.cartCount = 0;
    }
  }

  private refreshCartBadgeFromServer(): void {
    if (localStorage.getItem('isLoggedIn') !== 'true' || !localStorage.getItem('authToken')) return;
    this.cart.loadItems().subscribe({
      next: (items) => {
        this.cartCount = items.reduce((total, item) => total + item.quantity, 0);
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Không thể đồng bộ số lượng giỏ hàng với máy chủ:', error);
      },
    });
  }

  toggleMobileMenu(): void {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
  }

  closeMobileMenu(): void {
    this.isMobileMenuOpen = false;
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.isAccountMenuOpen = false;
    this.isNotificationOpen = false;
  }

  closeAccountMenu(): void {
    this.isAccountMenuOpen = false;
  }

  toggleAccountMenu(event: Event): void {
    event.stopPropagation();
    this.isNotificationOpen = false;
    this.isAccountMenuOpen = !this.isAccountMenuOpen;
  }

  toggleMobileProduct(): void {
    this.isMobileProductOpen = !this.isMobileProductOpen;
  }

  openLogoutModal(): void {
    this.isAccountMenuOpen = false;
    this.isLogoutModalOpen = true;
  }

  closeLogoutModal(): void {
    this.isLogoutModalOpen = false;
  }

  confirmLogout(): void {
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('userName');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userAvatar');
    localStorage.removeItem('userRole');
    localStorage.removeItem('authToken');
    localStorage.removeItem('userId');
    this.profileRequest?.unsubscribe();
    this.isLoggedIn = false;
    this.userName = '';
    this.userEmail = '';
    this.userAvatar = '';
    this.isAccountMenuOpen = false;
    this.isLogoutModalOpen = false;
    this.isNotificationOpen = false;
    this.notificationCount = 0;
    this.notifications = [];
    window.dispatchEvent(new Event('auth:changed'));
    void this.router.navigate(['/login']);
  }
}
