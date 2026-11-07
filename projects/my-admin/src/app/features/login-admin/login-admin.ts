import { Component, inject, OnInit, PLATFORM_ID, NgZone, ChangeDetectorRef } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
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
  imports: [CommonModule],
  selector: 'app-login-admin',
  styleUrl: './login-admin.css',
  templateUrl: './login-admin.html',
})
export class LoginAdmin implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);
  private adminApi = inject(AdminApiService);
  private platformId = inject(PLATFORM_ID);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  private tokenClient: any;

  isLoading = false;
  loginError = '';

  private apiUrl = 'http://localhost:3002/api/auth';
  private googleClientId = '914516820403-sqm3ft1o05tc6i4q92lk0fu6058b1n8b.apps.googleusercontent.com';

  private saveSessionAndNavigate(response: LoginResponse): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('adminToken', response.token);
      localStorage.setItem('urii-admin-token', response.token);
      localStorage.setItem('token', response.token);
      localStorage.setItem('adminUser', JSON.stringify(response.user));
    }

    this.adminApi.setToken(response.token);
    this.router.navigate(['/dashboard']);
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

    console.log('[LoginAdmin] Đang gửi yêu cầu đăng nhập tới:', `${this.apiUrl}/login`, { email });

    this.http.post<LoginResponse>(`${this.apiUrl}/login`, {
      email,
      password
    }).subscribe({
      next: (response) => {
        console.log('[LoginAdmin] Đăng nhập thành công:', response);
        this.isLoading = false;

        if (response?.user?.role !== 'admin') {
          this.loginError = 'Tài khoản không có quyền truy cập Admin.';
          this.cdr.detectChanges();
          return;
        }

        this.saveSessionAndNavigate(response);
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('[LoginAdmin] Lỗi đăng nhập:', error);
        this.isLoading = false;
        if (error.status === 0) {
          this.loginError = 'Không thể kết nối đến máy chủ backend (http://localhost:3002). Vui lòng đảm bảo server backend đang chạy.';
        } else {
          this.loginError = error.error?.message || `Lỗi máy chủ (${error.status}): Không thể đăng nhập.`;
        }
        this.cdr.detectChanges();
      }
    });
  }
  
  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
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

    console.log('[LoginAdmin] Gửi xác thực Google token tới backend...');

    this.http.post<LoginResponse>(`${this.apiUrl}/google`, {
      token: accessToken
    }).subscribe({
      next: (response) => {
        console.log('[LoginAdmin] Đăng nhập Google thành công:', response);
        this.isLoading = false;

        if (response?.user?.role !== 'admin') {
          this.loginError = 'Tài khoản không có quyền truy cập Admin.';
          this.cdr.detectChanges();
          return;
        }

        this.saveSessionAndNavigate(response);
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('[LoginAdmin] Lỗi đăng nhập Google:', error);
        this.isLoading = false;
        if (error.status === 0) {
          this.loginError = 'Không thể kết nối đến máy chủ backend (http://localhost:3002). Vui lòng đảm bảo server backend đang chạy.';
        } else {
          this.loginError = error.error?.message || 'Đăng nhập Google thất bại.';
        }
        this.cdr.detectChanges();
      }
    });
  }
}
