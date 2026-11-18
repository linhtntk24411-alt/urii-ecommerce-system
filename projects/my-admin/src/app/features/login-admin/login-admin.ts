import { Component, inject, OnInit, OnDestroy, PLATFORM_ID, NgZone, ChangeDetectorRef } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { AdminApiService } from '../../core/services/admin-api.service';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
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
  imports: [CommonModule, FormsModule],
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
  showPassword = false;
  resetOpen = false;
  resetStep: 'email' | 'otp' | 'password' | 'success' = 'email';
  resetEmail = '';
  resetOtp = '';
  resetPassword = '';
  resetConfirm = '';
  resetBusy = false;
  resetError = '';
  resetNotice = '';
  resetCountdown = 0;
  private resetTimer?: ReturnType<typeof setInterval>;
  private resetRequest?: Subscription;

  openPasswordReset(email = ''): void {
    if (this.isLoading || this.resetBusy) return;
    this.stopResetTimer();
    this.resetOpen = true; this.resetStep = 'email'; this.resetEmail = email.trim();
    this.resetOtp = ''; this.resetPassword = ''; this.resetConfirm = ''; this.resetError = ''; this.resetNotice = '';
  }

  closePasswordReset(): void {
    if (this.resetBusy) return;
    this.stopResetTimer(); this.resetOpen = false;
    this.resetOtp = ''; this.resetPassword = ''; this.resetConfirm = ''; this.resetError = ''; this.resetNotice = '';
  }

  private stopResetTimer(): void {
    if (this.resetTimer) clearInterval(this.resetTimer);
    this.resetTimer = undefined; this.resetCountdown = 0;
  }

  private startResetTimer(): void {
    this.stopResetTimer(); this.resetCountdown = 60;
    this.resetTimer = setInterval(() => {
      this.resetCountdown--;
      if (this.resetCountdown <= 0) this.stopResetTimer();
      this.cdr.markForCheck();
    }, 1000);
  }

  sendResetOtp(): void {
    if (this.resetBusy || (this.resetStep === 'otp' && this.resetCountdown > 0)) return;
    this.resetError = ''; this.resetNotice = '';
    const email = this.resetEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.resetError = 'Vui lòng nhập email hợp lệ.'; return; }
    this.resetEmail = email; this.resetBusy = true;
    this.resetRequest = this.http.post<{ message: string }>('/api/auth/admin/forgot-password', { email }).subscribe({
      next: data => { this.resetBusy = false; this.resetStep = 'otp'; this.resetOtp = ''; this.resetNotice = data.message; this.startResetTimer(); this.cdr.markForCheck(); },
      error: error => this.resetFailed(error)
    });
  }

  verifyResetOtp(): void {
    if (this.resetBusy || this.resetStep !== 'otp') return;
    this.resetError = ''; this.resetNotice = '';
    if (!/^\d{6}$/.test(this.resetOtp.trim()) || this.resetCountdown <= 0) { this.resetError = 'Nhập mã OTP 6 chữ số còn hạn hoặc gửi lại mã mới.'; return; }
    this.resetOtp = this.resetOtp.trim(); this.resetBusy = true;
    this.resetRequest = this.http.post<{ message: string }>('/api/auth/admin/verify-reset-otp', { email: this.resetEmail, otp: this.resetOtp }).subscribe({
      next: data => { this.resetBusy = false; this.resetStep = 'password'; this.resetNotice = data.message; this.stopResetTimer(); this.cdr.markForCheck(); },
      error: error => this.resetFailed(error)
    });
  }

  submitResetPassword(): void {
    if (this.resetBusy || this.resetStep !== 'password') return;
    this.resetError = ''; this.resetNotice = '';
    if (this.resetPassword !== this.resetConfirm) { this.resetError = 'Mật khẩu xác nhận không khớp.'; return; }
    if (this.resetPassword.length < 8 || new TextEncoder().encode(this.resetPassword).length > 72 || !/[A-Z]/.test(this.resetPassword) || !/[a-z]/.test(this.resetPassword) || !/[0-9]/.test(this.resetPassword)) {
      this.resetError = 'Mật khẩu cần ít nhất 8 ký tự, có chữ hoa, chữ thường, chữ số và không quá 72 byte.'; return;
    }
    this.resetBusy = true;
    this.resetRequest = this.http.post<{ message: string }>('/api/auth/admin/reset-password', { email: this.resetEmail, otp: this.resetOtp, password: this.resetPassword, confirmPassword: this.resetConfirm }).subscribe({
      next: data => { this.resetBusy = false; this.resetStep = 'success'; this.resetNotice = data.message; this.resetOtp = ''; this.resetPassword = ''; this.resetConfirm = ''; this.cdr.markForCheck(); },
      error: error => this.resetFailed(error)
    });
  }

  private resetFailed(error: any): void {
    this.resetBusy = false; this.resetError = error.error?.message || 'Không thể xử lý yêu cầu. Vui lòng thử lại.';
    this.cdr.markForCheck();
  }

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
  private facebookOAuthUrl =
    'https://foe-outweigh-justness.ngrok-free.dev/api/auth/oauth/facebook';

  // Nhận kết quả đăng nhập Facebook từ backend
  private facebookMessageHandler = (event: MessageEvent): void => {
    // Chỉ nhận thông điệp từ backend
    if (event.origin !== 'https://foe-outweigh-justness.ngrok-free.dev') {
      return;
    }

    const data = event.data;

    if (
      !data ||
      data.type !== 'urii-oauth' ||
      data.provider !== 'facebook'
    ) {
      return;
    }

    this.ngZone.run(() => {
      if (!data.ok) {
        this.isLoading = false;
        this.loginError =
          data.message || 'Đăng nhập bằng Facebook thất bại.';
        this.cdr.detectChanges();
        return;
      }

      if (!data.token || !data.user) {
        this.isLoading = false;
        this.loginError = 'Không nhận được thông tin đăng nhập Facebook.';
        this.cdr.detectChanges();
        return;
      }

      const response: LoginResponse = {
        message: 'Đăng nhập Facebook thành công',
        token: data.token,
        user: data.user
      };

      this.handleLoginSuccess(response);
    });
  };

  // Bắt đầu đăng nhập Facebook
  loginWithFacebook(): void {
    this.loginError = '';

    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const popup = window.open(
      this.facebookOAuthUrl,
      'facebook-login',
      'width=600,height=700,left=200,top=100'
    );

    if (!popup) {
      this.loginError = 'Trình duyệt đang chặn cửa sổ đăng nhập Facebook.';
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.cdr.detectChanges();
  }

  ngOnDestroy(): void {
    this.stopResetTimer(); this.resetRequest?.unsubscribe();
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('message', this.facebookMessageHandler);
    }
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
