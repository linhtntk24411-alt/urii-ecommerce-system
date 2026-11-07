import { Component, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common'; // Import để dùng *ngIf, *ngFor
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  // Cập nhật mảng imports tại đây:
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive], 
  templateUrl: './admin-layout.component.html',
  styleUrls: ['./admin-layout.component.css']
})
export class AdminLayoutComponent {
  // Trạng thái đóng/mở menu trên mobile
  isMobileMenuOpen: boolean = false;
  
  // Trạng thái đóng/mở dropdown thông báo
  isNotificationOpen: boolean = false;

  // Dữ liệu giả lập cho thông báo
  unreadCount: number = 3;
  notifications = [
    { id: 1, title: 'Đơn hàng mới', desc: 'Đơn hàng #1234 vừa được đặt.', time: '5 phút trước', isRead: false },
    { id: 2, title: 'Người dùng mới', desc: 'Nguyễn Văn A vừa đăng ký tài khoản.', time: '10 phút trước', isRead: false },
    { id: 3, title: 'Đánh giá mới', desc: 'Sản phẩm X vừa nhận được 5 sao.', time: '1 giờ trước', isRead: false }
  ];

  // Toggle Menu Mobile
  toggleMobileMenu(): void {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
  }

  // Toggle Dropdown Thông báo
  toggleNotifications(event: Event): void {
    event.stopPropagation();
    this.isNotificationOpen = !this.isNotificationOpen;
  }

  // Đọc tất cả thông báo
  clearAllNotifications(): void {
    this.unreadCount = 0;
    this.notifications.forEach(n => n.isRead = true);
    this.isNotificationOpen = false;
  }

  // Xử lý đăng xuất
  onLogout(event: Event): void {
    event.preventDefault();
    console.log('Xử lý đăng xuất tại đây...');
    // Thêm logic xóa token và navigate về trang login
  }

  // Đóng thông báo khi click ra ngoài
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    const targetElement = event.target as HTMLElement;
    if (!targetElement.closest('.notification-wrapper')) {
      this.isNotificationOpen = false;
    }
  }
}