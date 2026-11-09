import { Component, inject, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common'; // Import để dùng *ngIf, *ngFor
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AdminApiService } from '../core/services/admin-api.service';
import { AdminSocketService } from '../core/services/admin-socket.service';

type AdminSearchType = 'order' | 'user' | 'product' | 'promotion' | 'blog' | 'comment' | 'map';
type AdminSearchTab = 'all' | AdminSearchType;

interface AdminSearchResult {
  type: AdminSearchType;
  id: string;
  title: string;
  description: string;
  route: string;
}

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  // Cập nhật mảng imports tại đây:
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive], 
  templateUrl: './admin-layout.component.html',
  styleUrls: ['./admin-layout.component.css']
})
export class AdminLayoutComponent implements OnInit {
  private readonly socket = inject(AdminSocketService);
  constructor(
    private adminApi: AdminApiService,
    private router: Router
  ) {}
  ngOnInit(): void {
    this.loadNotifications();
    this.socket.onCrudChange().subscribe(() => {
      this.loadNotifications();
    });

    // Tải đơn hàng
    this.adminApi.getOrders().subscribe({
      next: (res: any) => {
        this.allOrders = Array.isArray(res)
          ? res
          : res?.orders || res?.data || [];
      },
      error: (err) => console.error('Lỗi tải đơn hàng:', err)
    });

    // Tải người dùng
    this.adminApi.getUsers()
      .then(users => {
        this.allUsers = users || [];
      })
      .catch(err => console.error('Lỗi tải người dùng:', err));
    // Tải danh sách sản phẩm
    this.adminApi.getProducts()
      .then(products => {
        this.allProducts = products || [];
      })
      .catch(err => {
        console.error('Lỗi tải sản phẩm:', err);
      });
    // Tải mã giảm giá
    this.adminApi.getPromotions()
      .then(promotions => {
        this.allPromotions = promotions || [];
      })
      .catch(err => console.error('Lỗi tải mã giảm giá:', err));

    // Tải bài blog
    this.adminApi.getBlogs()
      .then(blogs => {
        this.allBlogs = blogs || [];
      })
      .catch(err => console.error('Lỗi tải bài blog:', err));

    // Tải comment
    this.adminApi.getComments().subscribe({
      next: (res: any) => {
        this.allComments = Array.isArray(res)
          ? res
          : res?.comments || res?.data || [];
      },
      error: err => console.error('Lỗi tải comment:', err)
    });

    // Tải mẫu bản đồ
    this.adminApi.getLibraryMaps().subscribe({
      next: (res: any) => {
        this.allMaps = Array.isArray(res)
          ? res
          : res?.maps || res?.data || [];
      },
      error: err => console.error('Lỗi tải mẫu bản đồ:', err)
    });

    // Tải thông báo ngay khi vào trang để hiển thị badge số lượng thông báo
    this.loadNotifications();
  }

  // Trạng thái đóng/mở menu trên mobile
  isMobileMenuOpen: boolean = false;
  isLogoutConfirmOpen = false;
  
  // Trạng thái đóng/mở dropdown thông báo
  isNotificationOpen: boolean = false;
  // Trạng thái tìm kiếm trên Topbar
  searchKeyword = '';
  isSearchOpen = false;
  activeSearchTab: AdminSearchTab = 'all';

  readonly searchTabs: { type: AdminSearchTab; label: string }[] = [
    { type: 'all', label: 'Tất cả' },
    { type: 'order', label: 'Đơn hàng' },
    { type: 'user', label: 'Người dùng' },
    { type: 'product', label: 'Sản phẩm' },
    { type: 'promotion', label: 'Khuyến mãi' },
    { type: 'blog', label: 'Bài viết' },
    { type: 'comment', label: 'Bình luận' },
    { type: 'map', label: 'Mẫu map' }
  ];

  allOrders: any[] = [];
  allUsers: any[] = [];
  allProducts: any[] = [];
  allPromotions: any[] = [];
  allBlogs: any[] = [];
  allComments: any[] = [];
  allMaps: any[] = [];

  searchResults: AdminSearchResult[] = [];

  private readonly searchGroupLabels: Record<AdminSearchType, string> = {
    order: 'Đơn hàng',
    user: 'Người dùng',
    product: 'Sản phẩm',
    promotion: 'Khuyến mãi',
    blog: 'Bài viết',
    comment: 'Bình luận',
    map: 'Mẫu map'
  };

  get visibleSearchGroups(): { type: AdminSearchType; label: string; results: AdminSearchResult[] }[] {
    const types: AdminSearchType[] = this.activeSearchTab === 'all'
      ? ['order', 'user', 'product', 'promotion', 'blog', 'comment', 'map']
      : [this.activeSearchTab];

    return types
      .map(type => ({
        type,
        label: this.searchGroupLabels[type],
        results: this.searchResults.filter(result => result.type === type).slice(0, 4)
      }))
      .filter(group => group.results.length > 0);
  }

  get activeSearchResultCount(): number {
    return this.activeSearchTab === 'all'
      ? this.searchResults.length
      : this.searchResults.filter(result => result.type === this.activeSearchTab).length;
  }

  unreadCount = 0;
  notifications: any[] = [];
  notificationLoadError = '';
  isLoadingNotifications = false;
  private isMarkingNotificationsRead = false;

  loadNotifications(): void {
    this.notificationLoadError = '';
    this.isLoadingNotifications = true;
    this.adminApi.getAdminNotifications().subscribe({
      next: (response: any) => {
        this.isLoadingNotifications = false;
        const notificationList = Array.isArray(response)
          ? response
          : Array.isArray(response?.notifications)
            ? response.notifications
            : null;

        if (!notificationList) {
          this.notificationLoadError = 'Máy chủ trả về danh sách thông báo không hợp lệ.';
          console.error('API thông báo trả về dữ liệu không hợp lệ:', response);
          this.notifications = [];
          this.unreadCount = 0;
          return;
        }

        this.notifications = [...notificationList].sort((a: any, b: any) => {
          const dateA = Date.parse(a.createdAt || a.updatedAt || '');
          const dateB = Date.parse(b.createdAt || b.updatedAt || '');
          return (Number.isNaN(dateB) ? 0 : dateB) - (Number.isNaN(dateA) ? 0 : dateA);
        }).map((notification: any) => ({
          ...notification,
          desc: notification.message || notification.desc || '',
          time: this.formatNotificationTime(notification.createdAt || notification.updatedAt)
        }));
        this.unreadCount = response?.unreadCount !== undefined
          ? Number(response.unreadCount)
          : this.notifications.filter(notification => !notification.isRead).length;
      },
      error: (error) => {
        this.isLoadingNotifications = false;
        console.error('Lỗi tải thông báo quản trị:', error);
        this.notificationLoadError = 'Không thể tải thông báo. Vui lòng thử lại sau.';
        this.notifications = [];
        this.unreadCount = 0;
      }
    });
  }

  private formatNotificationTime(value?: string): string {
    if (!value) return 'Không rõ thời gian';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'Không rõ thời gian'
      : date.toLocaleString('vi-VN');
  }

  // Toggle Menu Mobile
  toggleMobileMenu(): void {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
  }

  // Toggle Dropdown Thông báo
  toggleNotifications(event: Event): void {
    event.stopPropagation();
    this.isNotificationOpen = !this.isNotificationOpen;
    if (this.isNotificationOpen) {
      this.loadNotifications();
    }
  }

  getNotificationTarget(notif: any): { route: string; queryParams?: Record<string, string> } {
    const ref = notif?.reference || {};
    const typeId = String(notif?.typeId || '');
    const actionUrl = String(notif?.actionUrl || '');

    // 1. Dựa theo typeId hoặc reference data
    if (typeId.startsWith('ADMIN_ORDER') || ref.orderId) {
      const orderId = ref.orderId || ref.customOrderId;
      return {
        route: '/orders',
        queryParams: orderId ? { searchType: 'order', searchId: String(orderId) } : undefined
      };
    }

    if (typeId === 'ADMIN_CUSTOM_ORDER_NEW' || ref.customOrderId) {
      const orderId = ref.customOrderId || ref.orderId;
      return {
        route: '/orders',
        queryParams: orderId ? { searchType: 'order', searchId: String(orderId) } : undefined
      };
    }

    if (typeId === 'ADMIN_PRODUCT_LOW_STOCK' || (ref.productId && !typeId.includes('REVIEW'))) {
      return {
        route: '/products',
        queryParams: ref.productId ? { searchType: 'product', searchId: String(ref.productId) } : undefined
      };
    }

    if (typeId === 'ADMIN_REVIEW_NEW' || typeId === 'ADMIN_COMMENT_NEW' || ref.commentId) {
      return {
        route: '/comments',
        queryParams: ref.commentId ? { searchType: 'comment', searchId: String(ref.commentId) } : undefined
      };
    }

    if (typeId === 'ADMIN_BLOG_NEW_POST' || ref.blogId) {
      return {
        route: '/blogs',
        queryParams: ref.blogId ? { searchType: 'blog', searchId: String(ref.blogId) } : undefined
      };
    }

    if (typeId === 'ADMIN_CHAT_WAITING_SUPPORT' || ref.sessionId) {
      return {
        route: '/chatbot',
        queryParams: ref.sessionId ? { sessionId: String(ref.sessionId) } : undefined
      };
    }

    if (typeId === 'ADMIN_USER_NEW_REGISTERED' || ref.actorUserId || notif?.actorUserId) {
      const userId = ref.actorUserId || notif?.actorUserId;
      return {
        route: '/users',
        queryParams: userId ? { searchType: 'user', searchId: String(userId) } : undefined
      };
    }

    if (typeId === 'ADMIN_VOUCHER_EXPIRED_OR_LOW' || ref.voucherId || ref.couponId) {
      const voucherId = ref.voucherId || ref.couponId;
      return {
        route: '/coupons',
        queryParams: voucherId ? { searchType: 'promotion', searchId: String(voucherId) } : undefined
      };
    }

    // 2. Dựa theo actionUrl nếu backend trả về URL cụ thể
    if (actionUrl) {
      const cleanUrl = actionUrl.replace(/^\/admin/, '').replace(/^\//, '');
      const parts = cleanUrl.split('/');
      const section = parts[0];
      const id = parts[1];

      if (section === 'orders' || section === 'custom-orders') {
        return { route: '/orders', queryParams: id ? { searchType: 'order', searchId: id } : undefined };
      }
      if (section === 'products') {
        if (parts[2] === 'reviews') {
          return { route: '/comments', queryParams: id ? { searchType: 'comment', searchId: id } : undefined };
        }
        return { route: '/products', queryParams: id ? { searchType: 'product', searchId: id } : undefined };
      }
      if (section === 'blogs') {
        return { route: '/blogs', queryParams: id ? { searchType: 'blog', searchId: id } : undefined };
      }
      if (section === 'comments') {
        return { route: '/comments', queryParams: id ? { searchType: 'comment', searchId: id } : undefined };
      }
      if (section === 'chat') {
        return { route: '/chatbot', queryParams: id ? { sessionId: id } : undefined };
      }
      if (section === 'users') {
        return { route: '/users', queryParams: id ? { searchType: 'user', searchId: id } : undefined };
      }
      if (section === 'vouchers' || section === 'coupons' || section === 'promotions') {
        return { route: '/coupons', queryParams: id ? { searchType: 'promotion', searchId: id } : undefined };
      }
    }

    return { route: '/dashboard' };
  }

  onNotificationClick(notif: any, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }

    // Đánh dấu đã đọc nếu chưa đọc
    if (!notif.isRead) {
      notif.isRead = true;
      if (this.unreadCount > 0) {
        this.unreadCount--;
      }
      const notifId = notif.id || notif._id;
      if (notifId) {
        this.adminApi.markNotificationAsRead(String(notifId)).subscribe({
          error: (err) => console.error('Lỗi khi đánh dấu thông báo đã đọc:', err)
        });
      }
    }

    // Đóng dropdown thông báo
    this.isNotificationOpen = false;

    // Điều hướng tới dữ liệu liên quan
    const target = this.getNotificationTarget(notif);
    this.router.navigate([target.route], {
      queryParams: target.queryParams
    });
  }

  clearAllNotifications(): void {
    if (this.isMarkingNotificationsRead || this.unreadCount === 0) return;

    this.isMarkingNotificationsRead = true;
    this.adminApi.markAllNotificationsAsRead().subscribe({
      next: () => {
        this.unreadCount = 0;
        this.notifications.forEach(notification => notification.isRead = true);
        this.isNotificationOpen = false;
        this.isMarkingNotificationsRead = false;
      },
      error: (error) => {
        console.error('Lỗi đánh dấu đã đọc tất cả thông báo:', error);
        this.notificationLoadError = 'Không thể đánh dấu đã đọc thông báo. Vui lòng thử lại.';
        this.isMarkingNotificationsRead = false;
      }
    });
  }

  // Xử lý đăng xuất
  onLogout(event: Event): void {
    event.preventDefault();
    this.isLogoutConfirmOpen = true;
  }

  cancelLogout(): void {
    this.isLogoutConfirmOpen = false;
  }

  confirmLogout(): void {
    this.isLogoutConfirmOpen = false;
    this.adminApi.logout();
    this.router.navigateByUrl('/', { replaceUrl: true });
  }

  // Đóng dropdown thông báo và tìm kiếm khi click ra ngoài
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    const targetElement = event.target as HTMLElement;
    if (!targetElement.closest('.search-wrapper')) {
      this.isSearchOpen = false;
    }
    if (!targetElement.closest('.notification-wrapper')) {
      this.isNotificationOpen = false;
    }
  }
  onSearchInput(value: string): void {
    this.searchKeyword = value.trim().toLowerCase();

    if (!this.searchKeyword) {
      this.searchResults = [];
      this.isSearchOpen = false;
      this.activeSearchTab = 'all';
      return;
    }

    this.activeSearchTab = 'all';

    const orderResults = this.allOrders
      .filter(order =>
        String(order.id || order._id || '').toLowerCase().includes(this.searchKeyword) ||
        String(order.userName || order.customerName || '').toLowerCase().includes(this.searchKeyword)
      )
      .slice(0, 5)
      .map(order => ({
        type: 'order' as const,
        id: String(order.id || order._id || ''),
        title: `Đơn hàng #${order.id || order._id}`,
        description: `${order.userName || order.customerName || 'Khách hàng'} - ${order.total || ''}`,
        route: '/orders'
      }));

    const userResults = this.allUsers
      .filter(user =>
        String(user.name || '').toLowerCase().includes(this.searchKeyword) ||
        String(user.email || '').toLowerCase().includes(this.searchKeyword) ||
        String(user.phone || '').toLowerCase().includes(this.searchKeyword)
      )
      .slice(0, 5)
      .map(user => ({
        type: 'user' as const,
        id: String(user._id || user.id || ''),
        title: user.name || 'Người dùng',
        description: user.email || user.phone || 'Người dùng',
        route: '/users'
      }));

    const productResults = this.allProducts
      .filter(product =>
        String(product.name || '').toLowerCase().includes(this.searchKeyword) ||
        String(product.id || product._id || '').toLowerCase().includes(this.searchKeyword) ||
        String(product.category || '').toLowerCase().includes(this.searchKeyword) ||
        String(product.slug || '').toLowerCase().includes(this.searchKeyword)
      )
      .slice(0, 5)
      .map(product => ({
        type: 'product' as const,
        id: String(product.id || product._id || ''),
        title: product.name || 'Sản phẩm',
        description: `Mã SP: ${product.id || product._id || ''} - ${Number(product.currentPrice || 0).toLocaleString('vi-VN')}đ`,
        route: '/products'
      }));

    const promotionResults = this.allPromotions
      .filter(promotion =>
        String(promotion.code || '').toLowerCase().includes(this.searchKeyword) ||
        String(promotion.id || promotion._id || '').toLowerCase().includes(this.searchKeyword) ||
        String(promotion.name || '').toLowerCase().includes(this.searchKeyword) ||
        String(promotion.description || '').toLowerCase().includes(this.searchKeyword)
      )
      .slice(0, 5)
      .map(promotion => ({
        type: 'promotion' as const,
        id: String(promotion.id || promotion._id || ''),
        title: promotion.code || promotion.name || 'Mã giảm giá',
        description: promotion.name || promotion.description || 'Chương trình khuyến mãi',
        route: '/coupons'
      }));

    const blogResults = this.allBlogs
      .filter(blog =>
        String(blog.title || '').toLowerCase().includes(this.searchKeyword) ||
        String(blog.slug || '').toLowerCase().includes(this.searchKeyword) ||
        String(blog.author || '').toLowerCase().includes(this.searchKeyword) ||
        String(blog.category || '').toLowerCase().includes(this.searchKeyword) ||
        String(blog.excerpt || '').toLowerCase().includes(this.searchKeyword)
      )
      .slice(0, 5)
      .map(blog => ({
        type: 'blog' as const,
        id: String(blog.id || blog._id || ''),
        title: blog.title || 'Bài blog',
        description: `${blog.author || 'Tác giả'} - ${blog.category || 'Bài viết'}`,
        route: '/blogs'
      }));

    const commentResults = this.allComments
      .filter(comment =>
        String(comment.content || '').toLowerCase().includes(this.searchKeyword) ||
        String(comment.author || '').toLowerCase().includes(this.searchKeyword) ||
        String(comment.id || comment._id || '').toLowerCase().includes(this.searchKeyword) ||
        String(comment.blogId || '').toLowerCase().includes(this.searchKeyword)
      )
      .slice(0, 5)
      .map(comment => ({
        type: 'comment' as const,
        id: String(comment.id || comment._id || ''),
        title: comment.author || 'Bình luận',
        description: String(comment.content || 'Nội dung bình luận'),
        route: '/comments'
      }));

    const mapResults = this.allMaps
      .filter(map => JSON.stringify(map).toLowerCase().includes(this.searchKeyword))
      .slice(0, 5)
      .map(map => ({
        type: 'map' as const,
        id: String(map.map_id || map.id || map._id || ''),
        title: map.map_name || map.name || map.title || map.map_id || map.id || map._id || 'Mẫu bản đồ',
        description: map.description || map.category || 'Mẫu trong thư viện',
        route: '/library'
      }));

    this.searchResults = [
      ...orderResults,
      ...userResults,
      ...productResults,
      ...promotionResults,
      ...blogResults,
      ...commentResults,
      ...mapResults
    ];
    this.isSearchOpen = true;
  }

  selectSearchResult(result: AdminSearchResult): void {
    this.router.navigate([result.route], {
      queryParams: { searchType: result.type, searchId: result.id }
    });
    this.searchKeyword = '';
    this.searchResults = [];
    this.isSearchOpen = false;
    this.activeSearchTab = 'all';
  }
}