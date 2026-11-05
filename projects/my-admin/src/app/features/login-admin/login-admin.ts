import { Component, inject, OnInit } from '@angular/core';
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
  imports: [],
  selector: 'app-login-admin',
  styleUrl: './login-admin.css',
  templateUrl: './login-admin.html',
})
export class LoginAdmin implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);
  private adminApi = inject(AdminApiService);
  // Thêm khai báo này ở đầu class LoginAdmin
  private tokenClient: any;

  isLoading = false;
  loginError = '';

  private apiUrl = 'http://localhost:3002/api/auth';
  private googleClientId = '914516820403-sqm3ft1o05tc6i4q92lk0fu6058b1n8b.apps.googleusercontent.com';

  login(email: string, password: string): void {
    this.loginError = '';

    email = email.trim();

    if (!email || !password) {
      this.loginError = 'Vui lòng nhập đầy đủ email và mật khẩu.';
      return;
    }

    this.isLoading = true;

    this.http.post<LoginResponse>(`${this.apiUrl}/login`, {
      email,
      password
    }).subscribe({
      // Thêm inject AdminApiService vào file login-admin.ts nếu chưa có:
// private adminApi = inject(AdminApiService);

      next: (response) => {
        this.isLoading = false;

        if (response.user.role !== 'admin') {
          this.loginError = 'Tài khoản không có quyền truy cập Admin.';
          return;
        }

        // 1. Lưu vào localStorage như bình thường
        localStorage.setItem('adminToken', response.token);
        localStorage.setItem('adminUser', JSON.stringify(response.user));

        // 2. TRUYỀN THẲNG TOKEN VÀO SERVICE LUÔN ĐỂ KHÔNG BỊ ĐỘ TRỄ
        this.adminApi.setToken(response.token);

        // 3. Chuyển trang ngay lập tức
        this.router.navigate(['/dashboard']);
      },
      error: (error) => {
        this.isLoading = false;

        this.loginError =
          error.error?.message || 'Không thể kết nối đến máy chủ.';
      }
    });
  }
  
ngOnInit(): void {
  this.waitForGoogleScript();
}

private waitForGoogleScript(): void {
  let attempts = 0;

  const checkGoogle = () => {
    // Đổi sang kiểm tra oauth2 để khởi tạo Token Client (bật popup chọn tài khoản)
    if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: this.googleClientId,
        scope: 'email profile openid',
        callback: (response: any) => {
          if (response && response.access_token) {
            this.handleGoogleLogin(response.access_token);
          }
        },
      });
    } else if (attempts < 30) {
      attempts++;
      setTimeout(checkGoogle, 300);
    }
  };

  checkGoogle();
}

loginWithGoogle(): void {
  this.loginError = '';

  if (!this.tokenClient) {
    this.loginError = 'Google chưa tải xong. Vui lòng thử lại.';
    return;
  }

  // Ép buộc hiện hộp thoại chọn tài khoản Google chuẩn dạng popup
  this.tokenClient.requestAccessToken({ prompt: 'select_account' });
}

private handleGoogleLogin(accessToken: string): void {
  if (!accessToken) {
    this.loginError = 'Không nhận được thông tin xác thực từ Google.';
    return;
  }

  this.isLoading = true;

  this.http.post<LoginResponse>(`${this.apiUrl}/google`, {
    token: accessToken // Sửa từ credential thành token
  }).subscribe({
    next: (response) => {
      this.isLoading = false;

      if (response.user.role !== 'admin') {
        this.loginError = 'Tài khoản không có quyền truy cập Admin.';
        return;
      }

      localStorage.setItem('adminToken', response.token);
      localStorage.setItem('adminUser', JSON.stringify(response.user));
      this.adminApi.setToken(response.token);
      this.router.navigate(['/dashboard']);
    },
    error: (error) => {
      this.isLoading = false;
      this.loginError = error.error?.message || 'Đăng nhập Google thất bại.';
    }
  });
}

}