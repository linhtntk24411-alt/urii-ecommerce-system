import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { StorageService } from '../services/storage.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (request.url !== '/api' && !request.url.startsWith('/api/')) {
    return next(request);
  }

  const storage = inject(StorageService);
  const router = inject(Router);
  const authorization = request.headers.get('Authorization');
  const token = authorization ? /^Bearer (.+)$/.exec(authorization)?.[1] : storage.getToken();
  if (!token || (token !== storage.getToken() && token !== storage.getLegacyToken())) return next(request);

  const authenticated = authorization ? request : request.clone({
    setHeaders: { Authorization: 'Bearer ' + token },
  });

  return next(authenticated).pipe(tap({
    error: (error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) return;
      const code = error.error?.code;
      if (code !== 'ACCOUNT_LOCKED' && code !== 'SESSION_REVOKED') return;
      if (storage.clearRejectedSession(token) && router.url.split('?')[0] !== '/login') {
        void router.navigate(['/login'], { queryParams: { sessionError: code } });
      }
    },
  }));
};
