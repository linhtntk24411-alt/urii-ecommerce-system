import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, TimeoutError, timeout } from 'rxjs';

interface LoginResponse {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    avatar?: string;
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
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
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
      timeout({ first: 8000 }),
      finalize(() => {
        this.isSubmitting = false;
        this.changeDetectorRef.markForCheck();
      }),
    ).subscribe({
      next: (response) => {
        if (
          !response?.user
          || typeof response.token !== 'string'
          || !response.token
          || typeof response.user.email !== 'string'
        ) {
          this.errorMessage = 'Máy chủ trả về dữ liệu đăng nhập không hợp lệ.';
          this.changeDetectorRef.markForCheck();
          return;
        }

        const user = response.user;
        localStorage.setItem('authToken', response.token);
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('userName', user.name);
        localStorage.setItem('userEmail', user.email);
        localStorage.setItem('userRole', user.role);
        localStorage.setItem('userAvatar', user.avatar ?? '');
        window.dispatchEvent(new Event('auth:changed'));
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        if (returnUrl?.startsWith('/') && !returnUrl.startsWith('//')) {
          void this.router.navigateByUrl(returnUrl);
        } else {
          void this.router.navigate(['/']);
        }
      },
      error: (error: unknown) => {
        if (error instanceof TimeoutError) {
          this.errorMessage = 'Máy chủ phản hồi quá lâu (8 giây). Vui lòng kiểm tra backend và kết nối MongoDB rồi thử lại.';
        } else if (error instanceof HttpErrorResponse && error.status === 401) {
          this.errorMessage = 'Email hoặc mật khẩu không chính xác.';
        } else if (error instanceof HttpErrorResponse && error.status === 0) {
          console.error('Không thể kết nối API đăng nhập:', error);
          this.errorMessage = 'Không kết nối được máy chủ. Vui lòng thử lại sau.';
        } else {
          console.error('Lỗi đăng nhập:', error);
          this.errorMessage = 'Không thể đăng nhập lúc này. Vui lòng thử lại sau.';
        }
        this.changeDetectorRef.markForCheck();
      },
    });
  }
}
