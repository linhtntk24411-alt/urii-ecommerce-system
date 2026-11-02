import { HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export const adminAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const platformId = inject(PLATFORM_ID);
  let token = '';

  // Lấy token từ localStorage nếu đang ở phía trình duyệt
  if (isPlatformBrowser(platformId)) {
    token = localStorage.getItem('adminToken') || '';
  }

  // Nếu có token, clone request cũ và gắn thêm Header chứa token vào
  if (token) {
    const cloned = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
    return next(cloned);
  }

  // Nếu không có token, giữ nguyên request gốc
  return next(req);
};