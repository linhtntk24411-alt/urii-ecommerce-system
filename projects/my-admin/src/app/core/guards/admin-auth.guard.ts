import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export const adminAuthGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);

  // Kiểm tra đang chạy trên trình duyệt (tránh lỗi SSR không có localStorage)
  if (isPlatformBrowser(platformId)) {
    const token = localStorage.getItem('adminToken');
    if (token) {
      return true; // Đã đăng nhập -> Cho phép vào trang
    }
  }

  // Chưa đăng nhập hoặc đang ở SSR -> Điều hướng về trang login
  router.navigate(['/login']);
  return false;
};