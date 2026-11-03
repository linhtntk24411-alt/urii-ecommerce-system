import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TimeoutError, timeout } from 'rxjs';

interface LoginResponse {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    avatar: string;
  };
}

@Component({
  imports: [CommonModule, ReactiveFormsModule],
  selector: 'app-login-user',
  styleUrl: './login-user.css',
  templateUrl: './login-user.html',
})
export class LoginUser {
  private readonly http = inject(HttpClient);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loginForm = this.formBuilder.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  readonly passwordResetForm = this.formBuilder.group({
    email: ['', [Validators.required, Validators.email]],
  });

  isSubmitting = false;
  isSendingResetNotice = false;
  isPasswordResetOpen = false;
  isPasswordVisible = false;
  errorMessage = '';
  passwordResetMessage = '';

  togglePasswordVisibility(): void {
    this.isPasswordVisible = !this.isPasswordVisible;
  }

  openPasswordReset(): void {
    this.passwordResetForm.reset({
      email: this.loginForm.controls.email.value?.trim() ?? '',
    });
    this.passwordResetMessage = '';
    this.isPasswordResetOpen = true;
  }

  closePasswordReset(): void {
    if (this.isSendingResetNotice) {
      return;
    }
    this.isPasswordResetOpen = false;
  }

  sendPasswordResetNotice(): void {
    if (this.isSendingResetNotice || this.passwordResetMessage) {
      return;
    }
    if (this.passwordResetForm.invalid) {
      this.passwordResetForm.markAllAsTouched();
      return;
    }

    const email = this.passwordResetForm.controls.email.value?.trim();
    this.passwordResetForm.controls.email.setValue(email ?? '');
    this.isSendingResetNotice = true;
    this.passwordResetMessage = 'Chúng tôi đã gửi hướng dẫn đặt lại mật khẩu qua email. Vui lòng kiểm tra hộp thư của bạn.';
    this.isSendingResetNotice = false;
  }

  login(): void {
    if (this.isSubmitting) {
      return;
    }

    const { email, password } = this.loginForm.getRawValue();
    this.loginForm.controls.email.setValue(email?.trim() ?? '');
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';

    this.http.post<LoginResponse>('/api/auth/login', {
      email: this.loginForm.controls.email.value,
      password,
    }).pipe(
      timeout({ first: 15000 }),
    ).subscribe({
      next: (response) => {
        this.isSubmitting = false;
        if (!response?.user || typeof response.user.email !== 'string') {
          this.errorMessage = 'Máy chủ trả về dữ liệu đăng nhập không hợp lệ.';
          return;
        }

        const user = response.user;
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('userName', user.name);
        localStorage.setItem('userEmail', user.email);
        localStorage.setItem('userRole', user.role);
        localStorage.setItem('userAvatar', user.avatar);
        window.dispatchEvent(new Event('auth:changed'));
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        if (returnUrl?.startsWith('/') && !returnUrl.startsWith('//')) {
          void this.router.navigateByUrl(returnUrl);
        } else {
          void this.router.navigate(['/']);
        }
      },
      error: (error: unknown) => {
        this.isSubmitting = false;
        if (error instanceof TimeoutError) {
          this.errorMessage = 'Máy chủ phản hồi quá lâu. Vui lòng kiểm tra kết nối rồi thử lại.';
        } else if (error instanceof HttpErrorResponse && error.status === 401) {
          this.errorMessage = 'Email hoặc mật khẩu không chính xác.';
        } else if (error instanceof HttpErrorResponse && error.status === 0) {
          console.error('Không thể kết nối API đăng nhập:', error);
          this.errorMessage = 'Không kết nối được máy chủ. Vui lòng thử lại sau.';
        } else {
          console.error('Lỗi đăng nhập:', error);
          this.errorMessage = 'Không thể đăng nhập lúc này. Vui lòng thử lại sau.';
        }
      },
    });
  }
}
