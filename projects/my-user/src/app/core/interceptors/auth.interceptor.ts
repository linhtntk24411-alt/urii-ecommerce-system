import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { StorageService } from '../services/storage.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (request.url !== '/api' && !request.url.startsWith('/api/')) {
    return next(request);
  }

  const token = inject(StorageService).getToken();
  if (!token) {
    return next(request);
  }

  return next(
    request.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    }),
  );
};
