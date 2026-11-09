import { Component, inject, OnInit,  OnDestroy, PLATFORM_ID, NgZone, ChangeDetectorRef } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { AdminApiService } from '../../core/services/admin-api.service';
declare const google: any;

interface LoginResponse {
  message: string;
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
}

@Component({
  imports: [CommonModule, RouterLink],
  selector: 'app-login-admin',
  standalone: true,
  styleUrl: './login-admin.css',
  templateUrl: './login-admin.html',
})
export class LoginAdmin implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private router = inject(Router);
  private adminApi = inject(AdminApiService);
  private platformId = inject(PLATFORM_ID);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  private tokenClient: any;

  isLoading = false;
  loginError = '';

  private proxyApiUrl = '/api/auth';
  private directApiUrl = 'http://localhost:3002/api/auth';
  private googleClientId = '914516820403-sqm3ft1o05tc6i4q92lk0fu6058b1n8b.apps.googleusercontent.com';

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  private saveSessionAndNavigate(response: LoginResponse): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('adminToken', response.token);
      localStorage.setItem('urii-admin-token', response.token);
      localStorage.setItem('token', response.token);
      localStorage.setItem('adminUser', JSON.stringify(response.user));
    }

    this.adminApi.setToken(response.token);

    this.ngZone.run(() => {
      this.router.navigate(['/dashboard']).then(navigated => {
        if (!navigated && isPlatformBrowser(this.platformId)) {
          window.location.href = '/dashboard';
        }
      }).catch(() => {
        if (isPlatformBrowser(this.platformId)) {
          window.location.href = '/dashboard';
        }
      });
    });
  }

  login(email: string, password: string): void {
    this.loginError = '';

    email = (email || '').trim();
    password = (password || '').trim();

    if (!email || !password) {
      this.loginError = 'Vui lòng nhập đầy đủ email và mật khẩu.';
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.cdr.detectChanges();

    const payload = { email, password };

    // Thử gửi qua proxy trước (/api/auth/login)
    this.http.post<LoginResponse>(`${this.proxyApiUrl}/login`, payload).subscribe({
      next: (response) => {
        this.handleLoginSuccess(response);
      },
      error: (proxyError) => {
        // Nếu proxy bị lỗi mạng hoặc 404, thử kết nối thẳng backend port 3002
        if (proxyError.status === 0 || proxyError.status === 404) {
          console.warn('[LoginAdmin] Thử kết nối trực tiếp đến backend port 3002...');
          this.http.post<LoginResponse>(`${this.directApiUrl}/login`, payload).subscribe({
            next: (directResponse) => {
              this.handleLoginSuccess(directResponse);
            },
            error: (directError) => {
              this.handleLoginError(directError);
            }
          });
        } else {
          this.handleLoginError(proxyError);
        }
      }
    });
  }

  private handleLoginSuccess(response: LoginResponse): void {
    this.ngZone.run(() => {
      this.isLoading = false;

      if (response?.user?.role !== 'admin') {
        this.loginError = 'Tài khoản không có quyền truy cập Admin (yêu cầu quyền quản trị viên).';
        this.cdr.detectChanges();
        return;
      }

      this.saveSessionAndNavigate(response);
      this.cdr.detectChanges();
    });
  }

  private handleLoginError(error: any): void {
    this.ngZone.run(() => {
      console.error('[LoginAdmin] Lỗi đăng nhập:', error);
      this.isLoading = false;
      if (error.status === 0) {
        this.loginError = 'Không thể kết nối đến máy chủ backend (http://localhost:3002). Vui lòng đảm bảo server backend đang chạy.';
      } else {
        this.loginError = error.error?.message || `Lỗi đăng nhập (${error.status}): Vui lòng kiểm tra lại email và mật khẩu.`;
      }
      this.cdr.detectChanges();
    });
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.addEventListener('message', this.facebookMessageHandler);
      this.waitForGoogleScript();
    }
  }

  private waitForGoogleScript(): void {
    let attempts = 0;

    // Chạy ngoài Angular zone để không giữ pending task làm kẹt Hydration
    this.ngZone.runOutsideAngular(() => {
      const checkGoogle = () => {
        if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
          this.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: this.googleClientId,
            scope: 'email profile openid',
            callback: (response: any) => {
              if (response && response.access_token) {
                this.ngZone.run(() => {
                  this.handleGoogleLogin(response.access_token);
                });
              }
            },
          });
        } else if (attempts < 30) {
          attempts++;
          setTimeout(checkGoogle, 300);
        }
      };

      checkGoogle();
    });
  }

  loginWithGoogle(): void {
    this.loginError = '';

    if (!this.tokenClient) {
      this.loginError = 'Google chưa tải xong. Vui lòng thử lại sau giây lát.';
      this.cdr.detectChanges();
      return;
    }

    this.tokenClient.requestAccessToken({ prompt: 'select_account' });
  }

  private handleGoogleLogin(accessToken: string): void {
    if (!accessToken) {
      this.loginError = 'Không nhận được thông tin xác thực từ Google.';
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.cdr.detectChanges();

    const payload = { token: accessToken, target: 'admin' };

    this.http.post<LoginResponse>(`${this.proxyApiUrl}/google`, payload).subscribe({
      next: (response) => {
        this.handleLoginSuccess(response);
      },
      error: (proxyError) => {
        if (proxyError.status === 0 || proxyError.status === 404) {
          this.http.post<LoginResponse>(`${this.directApiUrl}/google`, payload).subscribe({
            next: (directResponse) => {
              this.handleLoginSuccess(directResponse);
            },
            error: (directError) => {
              this.handleLoginError(directError);
            }
          });
        } else {
          this.handleLoginError(proxyError);
        }
      }
    });
  }
}
