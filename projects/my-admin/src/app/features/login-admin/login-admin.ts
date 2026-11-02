import { Component, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { AdminApiService } from '../../core/services/admin-api.service';

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
export class LoginAdmin {
  private http = inject(HttpClient);
  private router = inject(Router);
  private adminApi = inject(AdminApiService);

  isLoading = false;
  loginError = '';

  private apiUrl = 'http://localhost:3002/api/auth';

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
        this.router.navigate(['/products']);
      },
      error: (error) => {
        this.isLoading = false;

        this.loginError =
          error.error?.message || 'Không thể kết nối đến máy chủ.';
      }
    });
  }
}