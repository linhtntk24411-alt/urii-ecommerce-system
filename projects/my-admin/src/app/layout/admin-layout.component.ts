import { Component, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common'; // Import để dùng *ngIf, *ngFor
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AdminApiService } from '../core/services/admin-api.service';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  // Cập nhật mảng imports tại đây:
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive], 
  templateUrl: './admin-layout.component.html',
  styleUrls: ['./admin-layout.component.css']
})
export class AdminLayoutComponent implements OnInit {
  constructor(
    private adminApi: AdminApiService,
    private router: Router
  ) {}
  ngOnInit(): void {
    this.loadNotifications();

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
  }

  // Trạng thái đóng/mở menu trên mobile
  isMobileMenuOpen: boolean = false;
  
  // Trạng thái đóng/mở dropdown thông báo
  isNotificationOpen: boolean = false;
  // Trạng thái tìm kiếm trên Topbar
  searchKeyword = '';
  isSearchOpen = false;

  allOrders: any[] = [];
  allUsers: any[] = [];
  allProducts: any[] = [];
  allPromotions: any[] = [];
  allBlogs: any[] = [];
  allComments: any[] = [];
  allMaps: any[] = [];

  searchResults: {
    type: 'order' | 'user'| 'product'|'promotion' | 'blog' | 'comment' | 'map';
    title: string;
    description: string;
    route: string;
  }[] = [];

  unreadCount = 0;
  notifications: any[] = [];
  notificationLoadError = '';
  private isMarkingNotificationsRead = false;

  private loadNotifications(): void {
    this.notificationLoadError = '';
    this.adminApi.getAdminNotifications().subscribe({
      next: (response: any) => {
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
    this.adminApi.logout();
    this.router.navigateByUrl('/', { replaceUrl: true });
  }

  // Đóng thông báo khi click ra ngoài
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    const targetElement = event.target as HTMLElement;
    if (!targetElement.closest('.search-wrapper')) {
    this.isSearchOpen = false;
  }
  }
  onSearchInput(value: string): void {
  this.searchKeyword = value.trim().toLowerCase();

  if (!this.searchKeyword) {
    this.searchResults = [];
    this.isSearchOpen = false;
    return;
  }

  // 1. Tìm đơn hàng
  const orderResults = this.allOrders
    .filter(order =>
      String(order.id || '').toLowerCase().includes(this.searchKeyword) ||
      String(order.userName || '').toLowerCase().includes(this.searchKeyword)
    )
    .slice(0, 5)
    .map(order => ({
      type: 'order' as const,
      title: `Đơn hàng #${order.id}`,
      description: `${order.userName || 'Khách hàng'} - ${order.total || ''}`,
      route: '/orders'
    }));

  // 2. Tìm người dùng
  const userResults = this.allUsers
    .filter(user =>
      String(user.name || '').toLowerCase().includes(this.searchKeyword) ||
      String(user.email || '').toLowerCase().includes(this.searchKeyword) ||
      String(user.phone || '').toLowerCase().includes(this.searchKeyword)
    )
    .slice(0, 5)
    .map(user => ({
      type: 'user' as const,
      title: user.name || 'Người dùng',
      description: user.email || user.phone || 'Người dùng',
      route: '/users'
    }));

  // 3. Tìm sản phẩm
  const productResults = this.allProducts
    .filter(product =>
      String(product.name || '').toLowerCase().includes(this.searchKeyword) ||
      String(product.id || '').toLowerCase().includes(this.searchKeyword) ||
      String(product.category || '').toLowerCase().includes(this.searchKeyword) ||
      String(product.slug || '').toLowerCase().includes(this.searchKeyword)
    )
    .slice(0, 5)
    .map(product => ({
      type: 'product' as const,
      title: product.name || 'Sản phẩm',
      description: `Mã SP: ${product.id || ''} - ${Number(product.currentPrice || 0).toLocaleString('vi-VN')}đ`,
      route: '/products'
    }));

  // 4. Tìm mã giảm giá
  const promotionResults = this.allPromotions
    .filter(promotion =>
      String(promotion.code || '').toLowerCase().includes(this.searchKeyword) ||
      String(promotion.id || '').toLowerCase().includes(this.searchKeyword) ||
      String(promotion.name || '').toLowerCase().includes(this.searchKeyword) ||
      String(promotion.description || '').toLowerCase().includes(this.searchKeyword)
    )
    .slice(0, 5)
    .map(promotion => ({
      type: 'promotion' as const,
      title: promotion.code || promotion.name || 'Mã giảm giá',
      description: promotion.name || promotion.description || 'Chương trình khuyến mãi',
      route: '/promotions'
    }));

  // 5. Tìm bài blog
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
      title: blog.title || 'Bài blog',
      description: `${blog.author || 'Tác giả'} - ${blog.category || 'Bài viết'}`,
      route: '/blogs'
    }));

  // 6. Tìm comment
  const commentResults = this.allComments
    .filter(comment =>
      String(comment.content || '').toLowerCase().includes(this.searchKeyword) ||
      String(comment.author || '').toLowerCase().includes(this.searchKeyword) ||
      String(comment.id || '').toLowerCase().includes(this.searchKeyword) ||
      String(comment.blogId || '').toLowerCase().includes(this.searchKeyword)
    )
    .slice(0, 5)
    .map(comment => ({
      type: 'comment' as const,
      title: comment.author || 'Bình luận',
      description: String(comment.content || 'Nội dung bình luận'),
      route: '/comments'
    }));

  // 7. Tìm mẫu bản đồ trong thư viện
  const mapResults = this.allMaps
    .filter(map =>
      JSON.stringify(map).toLowerCase().includes(this.searchKeyword)
    )
    .slice(0, 5)
    .map(map => ({
      type: 'map' as const,
      title: map.name || map.title || map.mapName || map.id || map._id || 'Mẫu bản đồ',
      description: map.description || map.category || 'Mẫu trong thư viện',
      route: '/library'
    }));

  // Gộp tất cả kết quả
  this.searchResults = [
    ...productResults,
    ...promotionResults,
    ...userResults,
    ...blogResults,
    ...commentResults,
    ...mapResults,
    ...orderResults
  ];

  this.isSearchOpen = true;
}


  selectSearchResult(result: {
    type: 'order' | 'user' | 'product'| 'promotion' | 'blog' | 'comment' | 'map';
    title: string;
    description: string;
    route: string;
  }): void {
    this.router.navigateByUrl(result.route);
    this.searchKeyword = '';
    this.searchResults = [];
    this.isSearchOpen = false;
  }
}