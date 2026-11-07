import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, inject, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
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
export class LoginUser implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loginForm = this.formBuilder.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  private readonly passwordsMatch = (control: AbstractControl): ValidationErrors | null => {
    const password = control.get('password')?.value;
    const confirmation = control.get('confirmPassword')?.value;
    return password === confirmation ? null : { passwordsMismatch: true };
  };

  readonly registerForm = this.formBuilder.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [
      Validators.required,
      Validators.minLength(8),
      Validators.pattern(/[A-Z]/),
      Validators.pattern(/[a-z]/),
      Validators.pattern(/[0-9]/),
    ]],
    confirmPassword: ['', Validators.required],
  }, { validators: this.passwordsMatch });

  readonly passwordResetForm = this.formBuilder.group({
    email: ['', [Validators.required, Validators.email]],
  });

  isRegisterMode = false;
  isSubmitting = false;
  isRegistering = false;
  isSendingResetNotice = false;
  isPasswordResetOpen = false;
  isPasswordVisible = false;
  isRegisterPasswordVisible = false;
  isConfirmPasswordVisible = false;
  isSocialAuthInProgress = false;
  errorMessage = '';
  showRegisterPrompt = false;
  registerErrorMessage = '';
  registerSuccessMessage = '';
  passwordResetMessage = '';
  socialAuthMessage = '';
  private socialAuthTimer?: number;
  private socialAuthTimeout?: number;
  private socialAuthPopup: Window | null = null;

  get passwordRequirementStatus(): { length: boolean; uppercase: boolean; lowercase: boolean; number: boolean } {
    const password = this.registerForm.controls.password.value ?? '';
    return {
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
    };
  }

  constructor() {
    this.isRegisterMode = this.router.url.split('?')[0] === '/register';
  }

  ngOnDestroy(): void {
    this.clearSocialAuthMonitor();
  }

  setAuthMode(mode: 'login' | 'register'): void {
    this.isRegisterMode = mode === 'register';
    this.errorMessage = '';
    this.showRegisterPrompt = false;
    this.registerErrorMessage = '';
    this.registerSuccessMessage = '';
  }

  togglePasswordVisibility(): void {
    this.isPasswordVisible = !this.isPasswordVisible;
  }

  toggleRegisterPasswordVisibility(): void {
    this.isRegisterPasswordVisible = !this.isRegisterPasswordVisible;
  }

  toggleConfirmPasswordVisibility(): void {
    this.isConfirmPasswordVisible = !this.isConfirmPasswordVisible;
  }

  startSocialLogin(provider: 'google' | 'facebook'): void {
    if (this.isSocialAuthInProgress) return;

    this.socialAuthMessage = `Đang kết nối ${provider === 'google' ? 'Google' : 'Facebook'}...`;
    const popup = window.open(
      `/api/auth/oauth/${provider}`,
      `urii-${provider}-oauth`,
      'popup,width=520,height=680',
    );
    if (!popup) {
      this.socialAuthMessage = 'Trình duyệt đã chặn cửa sổ đăng nhập. Hãy cho phép popup rồi thử lại.';
      return;
    }

    this.isSocialAuthInProgress = true;
    this.socialAuthPopup = popup;
    this.socialAuthTimer = window.setInterval(() => this.checkSocialLoginPopup(provider), 400);
    this.socialAuthTimeout = window.setTimeout(() => {
      if (this.isSocialAuthInProgress) {
        this.finishSocialLogin('Đăng nhập mạng xã hội đã hết thời gian chờ. Vui lòng thử lại.');
      }
    }, 9 * 60 * 1000);
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

  register(): void {
    if (this.isRegistering) return;

    const { name, email, password } = this.registerForm.getRawValue();
    this.registerForm.controls.name.setValue(name?.trim() ?? '');
    this.registerForm.controls.email.setValue(email?.trim() ?? '');
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    this.isRegistering = true;
    this.registerErrorMessage = '';
    this.registerSuccessMessage = '';

    this.http.post<{ message?: string }>('/api/auth/register', {
      name: this.registerForm.controls.name.value,
      email: this.registerForm.controls.email.value,
      password,
    }).pipe(
      timeout({ first: 8000 }),
      finalize(() => {
        this.isRegistering = false;
        this.changeDetectorRef.markForCheck();
      }),
    ).subscribe({
      next: (response) => {
        this.loginForm.controls.email.setValue(this.registerForm.controls.email.value);
        this.loginForm.controls.password.reset('');
        this.registerForm.reset();
        this.setAuthMode('login');
        this.registerSuccessMessage = response?.message || 'Đăng ký thành công! Vui lòng đăng nhập.';
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        if (error instanceof TimeoutError) {
          this.registerErrorMessage = 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.';
        } else if (error instanceof HttpErrorResponse && error.status === 409) {
          this.registerErrorMessage = 'Email này đã được đăng ký.';
        } else if (error instanceof HttpErrorResponse && error.status === 400) {
          this.registerErrorMessage = error.error?.message || 'Vui lòng kiểm tra tên, email và mật khẩu (tối thiểu 8 ký tự).';
        } else if (error instanceof HttpErrorResponse && error.status === 0) {
          console.error('Không thể kết nối API đăng ký:', error);
          this.registerErrorMessage = 'Không kết nối được máy chủ. Vui lòng thử lại sau.';
        } else {
          console.error('Lỗi đăng ký tài khoản:', error);
          this.registerErrorMessage = 'Không thể đăng ký lúc này. Vui lòng thử lại sau.';
        }
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  login(): void {
    if (this.isSubmitting) {
      return;
    }

    const { email, password } = this.loginForm.getRawValue();
    this.loginForm.controls.email.setValue(email?.trim() ?? '');
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      const emailControl = this.loginForm.controls.email;
      const passwordControl = this.loginForm.controls.password;
      if (emailControl.hasError('required') && passwordControl.hasError('required')) {
        this.errorMessage = 'Vui lòng nhập email và mật khẩu.';
      } else if (emailControl.hasError('required')) {
        this.errorMessage = 'Vui lòng nhập email.';
      } else if (emailControl.hasError('email')) {
        this.errorMessage = 'Vui lòng nhập địa chỉ email hợp lệ.';
      } else {
        this.errorMessage = 'Vui lòng nhập mật khẩu.';
      }
      this.showRegisterPrompt = false;
      this.changeDetectorRef.markForCheck();
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';
    this.showRegisterPrompt = false;

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

        this.completeLogin(response);
      },
      error: (error: unknown) => {
        if (error instanceof TimeoutError) {
          this.errorMessage = 'Máy chủ phản hồi quá lâu (8 giây). Vui lòng kiểm tra backend và kết nối MongoDB rồi thử lại.';
        } else if (error instanceof HttpErrorResponse && error.status === 404) {
          this.errorMessage = 'Không tìm thấy tài khoản với email này. Bạn chưa có tài khoản?';
          this.showRegisterPrompt = true;
        } else if (error instanceof HttpErrorResponse && error.status === 401) {
          this.errorMessage = 'Mật khẩu không chính xác. Vui lòng thử lại.';
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

  private checkSocialLoginPopup(provider: 'google' | 'facebook'): void {
    const popup = this.socialAuthPopup;
    if (!popup) return;

    if (popup.closed) {
      this.finishSocialLogin('Cửa sổ đăng nhập đã đóng trước khi hoàn tất.');
      return;
    }

    try {
      if (popup.location.origin !== window.location.origin
        || !popup.location.pathname.endsWith(`/api/auth/oauth/${provider}/callback`)
        || popup.document.readyState !== 'complete') {
        return;
      }

      const responseText = popup.document.body?.textContent?.trim();
      if (!responseText) return;

      let response: unknown;
      try {
        response = JSON.parse(responseText);
      } catch (error: unknown) {
        if (error instanceof SyntaxError) return;
        throw error;
      }

      if (!this.isLoginResponse(response)) {
        const message = this.isRecord(response) && typeof response['message'] === 'string'
          ? response['message']
          : 'Máy chủ trả về dữ liệu đăng nhập mạng xã hội không hợp lệ.';
        this.finishSocialLogin(message);
        popup.close();
        return;
      }

      this.finishSocialLogin('');
      popup.close();
      this.completeLogin(response);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'SecurityError') return;
      console.error('Không thể đọc kết quả đăng nhập OAuth:', error);
      this.finishSocialLogin('Không thể đọc kết quả đăng nhập. Hãy kiểm tra cấu hình callback OAuth cùng origin với website.');
    }
  }

  private isLoginResponse(value: unknown): value is LoginResponse {
    if (!this.isRecord(value) || typeof value['token'] !== 'string' || !value['token']) return false;
    const user = value['user'];
    return this.isRecord(user)
      && typeof user['email'] === 'string'
      && typeof user['id'] === 'string'
      && typeof user['name'] === 'string'
      && typeof user['role'] === 'string';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private completeLogin(response: LoginResponse): void {
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
  }

  private finishSocialLogin(message: string): void {
    this.clearSocialAuthMonitor();
    this.isSocialAuthInProgress = false;
    this.socialAuthMessage = message;
    this.changeDetectorRef.markForCheck();
  }

  private clearSocialAuthMonitor(): void {
    if (this.socialAuthTimer !== undefined) {
      window.clearInterval(this.socialAuthTimer);
      this.socialAuthTimer = undefined;
    }
    if (this.socialAuthTimeout !== undefined) {
      window.clearTimeout(this.socialAuthTimeout);
      this.socialAuthTimeout = undefined;
    }
    this.socialAuthPopup = null;
  }
}
