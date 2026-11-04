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
    if (typeof google !== 'undefined' && google.accounts) {
      google.accounts.id.initialize({
        client_id: this.googleClientId,
        callback: (response: any) => {
          this.handleGoogleLogin(response.credential);
        }
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

  if (typeof google === 'undefined' || !google.accounts) {
    this.loginError = 'Google chưa tải xong. Vui lòng thử lại.';
    return;
  }

  google.accounts.id.prompt();
}

private handleGoogleLogin(credential: string): void {
  if (!credential) {
    this.loginError = 'Không nhận được thông tin từ Google.';
    return;
  }

  this.isLoading = true;

  this.http.post<LoginResponse>(`${this.apiUrl}/google`, {
    credential
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
      this.loginError =
        error.error?.message || 'Đăng nhập Google thất bại.';
    }
  });
}

}