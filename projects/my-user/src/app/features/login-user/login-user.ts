import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, inject, NgZone, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { AbstractControl, FormBuilder, FormsModule, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, TimeoutError, timeout } from 'rxjs';
import { CartService } from '../../core/services/cart.service';

declare const google: any;

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
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  selector: 'app-login-user',
  styleUrl: './login-user.css',
  templateUrl: './login-user.html',
})
export class LoginUser implements OnInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly ngZone = inject(NgZone);
  private readonly googleClientId = '914516820403-sqm3ft1o05tc6i4q92lk0fu6058b1n8b.apps.googleusercontent.com';
  private tokenClient: any;
  private readonly http = inject(HttpClient);
  private readonly cart = inject(CartService);
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

  // Form đặt lại mật khẩu mới
  readonly newPasswordForm = this.formBuilder.group({
    password: ['', [
      Validators.required,
      Validators.minLength(8),
      Validators.pattern(/[A-Z]/),
      Validators.pattern(/[a-z]/),
      Validators.pattern(/[0-9]/),
    ]],
    confirmPassword: ['', Validators.required],
  }, { validators: this.passwordsMatch });

  isRegisterMode = false;
  isSubmitting = false;
  isRegistering = false;
  isPasswordVisible = false;
  isRegisterPasswordVisible = false;
  isConfirmPasswordVisible = false;
  isNewPasswordVisible = false;
  isNewConfirmPasswordVisible = false;
  isSocialAuthInProgress = false;

  // --- POPUP OTP ĐĂNG KÝ ---
  isRegisterOtpModalOpen = false;
  registerOtpCode = '';
  registerOtpCountdown = 60;
  private registerOtpTimer?: number;
  isVerifyingRegisterOtp = false;
  isResendingRegisterOtp = false;
  registerOtpErrorMessage = '';
  registerOtpSuccessMessage = '';
  pendingRegisterEmail = '';

  // --- POPUP QUÊN MẬT KHẨU ---
  isForgotPasswordModalOpen = false;
  forgotPasswordStep: 'email' | 'otp' | 'new-password' = 'email';
  forgotPasswordEmail = '';
  forgotPasswordOtp = '';
  forgotOtpCountdown = 60;
  private forgotOtpTimer?: number;
  isSendingForgotEmail = false;
  isVerifyingForgotOtp = false;
  isResendingForgotOtp = false;
  isResettingPassword = false;
  forgotErrorMessage = '';
  forgotSuccessMessage = '';

  errorMessage = '';
  showRegisterPrompt = false;
  registerErrorMessage = '';
  registerSuccessMessage = '';
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

  get newPasswordRequirementStatus(): { length: boolean; uppercase: boolean; lowercase: boolean; number: boolean } {
    const password = this.newPasswordForm.controls.password.value ?? '';
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

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.waitForGoogleScript();
    }
  }

  private waitForGoogleScript(): void {
    let attempts = 0;
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
    if (!isPlatformBrowser(this.platformId)) return;

    if (!this.tokenClient) {
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
      } else {
        this.socialAuthMessage = 'Đang tải dịch vụ Google... Vui lòng thử lại sau vài giây.';
        this.changeDetectorRef.markForCheck();
        return;
      }
    }

    this.tokenClient.requestAccessToken({ prompt: 'select_account' });
  }

  private handleGoogleLogin(accessToken: string): void {
    this.socialAuthMessage = 'Đang xác thực tài khoản Google...';
    this.isSocialAuthInProgress = true;
    this.changeDetectorRef.markForCheck();

    this.http.post<LoginResponse>('/api/auth/google', {
      token: accessToken,
      target: 'user'
    }).pipe(
      finalize(() => {
        this.isSocialAuthInProgress = false;
        this.changeDetectorRef.markForCheck();
      })
    ).subscribe({
      next: (response) => {
        if (
          !response ||
          typeof response.token !== 'string' ||
          !response.token.trim() ||
          !response.user ||
          typeof response.user.email !== 'string' ||
          !response.user.email.trim()
        ) {
          this.socialAuthMessage = 'Máy chủ trả về dữ liệu đăng nhập không hợp lệ.';
          this.changeDetectorRef.markForCheck();
          return;
        }

        this.socialAuthMessage = '';
        this.completeLogin(response);
      },
      error: (error) => {
        console.error('Lỗi đăng nhập Google:', error);
        if (error.status === 0) {
          this.socialAuthMessage = 'Không thể kết nối đến máy chủ backend (http://localhost:3002). Vui lòng đảm bảo server backend đang chạy.';
        } else {
          this.socialAuthMessage = error.error?.message || 'Đăng nhập Google thất bại.';
        }
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  // ===================== OTP ĐĂNG KÝ =====================
  startRegisterOtpCountdown(): void {
    this.stopRegisterOtpCountdown();
    this.registerOtpCountdown = 60;
    this.registerOtpTimer = window.setInterval(() => {
      if (this.registerOtpCountdown > 0) {
        this.registerOtpCountdown--;
        this.changeDetectorRef.markForCheck();
      } else {
        this.stopRegisterOtpCountdown();
        this.changeDetectorRef.markForCheck();
      }
    }, 1000);
  }

  stopRegisterOtpCountdown(): void {
    if (this.registerOtpTimer !== undefined) {
      window.clearInterval(this.registerOtpTimer);
      this.registerOtpTimer = undefined;
    }
  }

  get registerOtpCountdownFormatted(): string {
    const mins = Math.floor(this.registerOtpCountdown / 60);
    const secs = this.registerOtpCountdown % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  verifyRegisterOtp(): void {
    if (this.isVerifyingRegisterOtp) return;

    const trimmedCode = (this.registerOtpCode || '').trim();
    if (!trimmedCode || trimmedCode.length !== 6) {
      this.registerOtpErrorMessage = 'Vui lòng nhập đầy đủ mã OTP 6 chữ số.';
      this.changeDetectorRef.markForCheck();
      return;
    }

    if (this.registerOtpCountdown <= 0) {
      this.registerOtpErrorMessage = 'Mã OTP đã hết thời hạn 60 giây. Vui lòng bấm "Gửi lại mã mới".';
      this.changeDetectorRef.markForCheck();
      return;
    }

    this.isVerifyingRegisterOtp = true;
    this.registerOtpErrorMessage = '';

    this.http.post<{ message?: string; userId?: string }>('/api/auth/verify-otp', {
      email: this.pendingRegisterEmail,
      otp: trimmedCode
    }).pipe(
      finalize(() => {
        this.isVerifyingRegisterOtp = false;
        this.changeDetectorRef.markForCheck();
      })
    ).subscribe({
      next: (response) => {
        this.stopRegisterOtpCountdown();
        if (typeof response?.userId === 'string' && response.userId.trim()) {
          try {
            this.cart.moveGuestCartToUser(response.userId);
          } catch (error) {
            console.error('Không thể đồng bộ giỏ hàng khách vào tài khoản vừa đăng ký:', error);
          }
        }
        this.isRegisterOtpModalOpen = false;
        this.loginForm.controls.email.setValue(this.pendingRegisterEmail);
        this.loginForm.controls.password.reset('');
        this.registerForm.reset();
        this.setAuthMode('login');
        this.registerSuccessMessage = response?.message || 'Đăng ký thành công! Vui lòng đăng nhập.';
        this.changeDetectorRef.markForCheck();
      },
      error: (error: any) => {
        this.registerOtpErrorMessage = error.error?.message || 'Mã xác thực OTP không chính xác hoặc đã hết hạn. Vui lòng kiểm tra lại.';
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  resendRegisterOtp(): void {
    if (this.isResendingRegisterOtp || this.registerOtpCountdown > 0) return;

    this.isResendingRegisterOtp = true;
    this.registerOtpErrorMessage = '';

    this.http.post<{ message?: string }>('/api/auth/resend-otp', {
      email: this.pendingRegisterEmail
    }).pipe(
      finalize(() => {
        this.isResendingRegisterOtp = false;
        this.changeDetectorRef.markForCheck();
      })
    ).subscribe({
      next: (response) => {
        this.registerOtpCode = '';
        this.registerOtpSuccessMessage = response?.message || 'Mã OTP mới đã được gửi đến email.';
        this.startRegisterOtpCountdown();
        this.changeDetectorRef.markForCheck();
      },
      error: (error: any) => {
        this.registerOtpErrorMessage = error.error?.message || 'Không thể gửi lại mã OTP lúc này.';
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  closeRegisterOtpModal(): void {
    this.stopRegisterOtpCountdown();
    this.isRegisterOtpModalOpen = false;
    this.registerOtpCode = '';
    this.registerOtpErrorMessage = '';
    this.registerOtpSuccessMessage = '';
    this.changeDetectorRef.markForCheck();
  }

  // ===================== QUÊN MẬT KHẨU FLOW =====================
  openPasswordReset(): void {
    this.forgotPasswordStep = 'email';
    this.forgotPasswordEmail = this.loginForm.controls.email.value?.trim() ?? '';
    this.forgotPasswordOtp = '';
    this.forgotErrorMessage = '';
    this.forgotSuccessMessage = '';
    this.newPasswordForm.reset();
    this.isForgotPasswordModalOpen = true;
  }

  closePasswordReset(): void {
    if (this.isSendingForgotEmail || this.isVerifyingForgotOtp || this.isResettingPassword) return;
    this.stopForgotOtpCountdown();
    this.isForgotPasswordModalOpen = false;
    this.forgotErrorMessage = '';
    this.forgotSuccessMessage = '';
  }

  startForgotOtpCountdown(): void {
    this.stopForgotOtpCountdown();
    this.forgotOtpCountdown = 60;
    this.forgotOtpTimer = window.setInterval(() => {
      if (this.forgotOtpCountdown > 0) {
        this.forgotOtpCountdown--;
        this.changeDetectorRef.markForCheck();
      } else {
        this.stopForgotOtpCountdown();
        this.changeDetectorRef.markForCheck();
      }
    }, 1000);
  }

  stopForgotOtpCountdown(): void {
    if (this.forgotOtpTimer !== undefined) {
      window.clearInterval(this.forgotOtpTimer);
      this.forgotOtpTimer = undefined;
    }
  }

  get forgotOtpCountdownFormatted(): string {
    const mins = Math.floor(this.forgotOtpCountdown / 60);
    const secs = this.forgotOtpCountdown % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  sendForgotOtp(): void {
    const email = this.forgotPasswordEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.forgotErrorMessage = 'Vui lòng nhập địa chỉ email hợp lệ.';
      return;
    }

    this.isSendingForgotEmail = true;
    this.forgotErrorMessage = '';
    this.forgotSuccessMessage = '';

    this.http.post<{ message?: string }>('/api/auth/forgot-password', { email }).pipe(
      finalize(() => {
        this.isSendingForgotEmail = false;
        this.changeDetectorRef.markForCheck();
      })
    ).subscribe({
      next: (res) => {
        this.forgotSuccessMessage = res.message || 'Mã xác thực OTP đã được gửi đến email.';
        this.forgotPasswordStep = 'otp';
        this.forgotPasswordOtp = '';
        this.startForgotOtpCountdown();
        this.changeDetectorRef.markForCheck();
      },
      error: (err) => {
        this.forgotErrorMessage = err.error?.message || 'Không thể gửi mã xác thực. Vui lòng thử lại sau.';
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  verifyForgotOtp(): void {
    const trimmedOtp = (this.forgotPasswordOtp || '').trim();
    if (!trimmedOtp || trimmedOtp.length !== 6) {
      this.forgotErrorMessage = 'Vui lòng nhập đủ 6 chữ số mã OTP.';
      return;
    }

    if (this.forgotOtpCountdown <= 0) {
      this.forgotErrorMessage = 'Mã OTP đã hết thời hạn 60 giây. Vui lòng bấm "Gửi lại mã mới".';
      return;
    }

    this.isVerifyingForgotOtp = true;
    this.forgotErrorMessage = '';

    this.http.post<{ message?: string }>('/api/auth/verify-reset-otp', {
      email: this.forgotPasswordEmail.trim().toLowerCase(),
      otp: trimmedOtp
    }).pipe(
      finalize(() => {
        this.isVerifyingForgotOtp = false;
        this.changeDetectorRef.markForCheck();
      })
    ).subscribe({
      next: () => {
        this.stopForgotOtpCountdown();
        this.forgotPasswordStep = 'new-password';
        this.forgotErrorMessage = '';
        this.forgotSuccessMessage = '';
        this.changeDetectorRef.markForCheck();
      },
      error: (err) => {
        this.forgotErrorMessage = err.error?.message || 'Mã OTP không chính xác hoặc đã hết hạn.';
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  resendForgotOtp(): void {
    if (this.isResendingForgotOtp || this.forgotOtpCountdown > 0) return;

    this.isResendingForgotOtp = true;
    this.forgotErrorMessage = '';

    this.http.post<{ message?: string }>('/api/auth/forgot-password', {
      email: this.forgotPasswordEmail.trim().toLowerCase()
    }).pipe(
      finalize(() => {
        this.isResendingForgotOtp = false;
        this.changeDetectorRef.markForCheck();
      })
    ).subscribe({
      next: (res) => {
        this.forgotPasswordOtp = '';
        this.forgotSuccessMessage = res.message || 'Mã OTP mới đã được gửi đến email.';
        this.startForgotOtpCountdown();
        this.changeDetectorRef.markForCheck();
      },
      error: (err) => {
        this.forgotErrorMessage = err.error?.message || 'Không thể gửi lại mã OTP lúc này.';
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  submitNewPassword(): void {
    if (this.isResettingPassword) return;

    if (this.newPasswordForm.invalid) {
      this.newPasswordForm.markAllAsTouched();
      return;
    }

    const { password } = this.newPasswordForm.getRawValue();
    this.isResettingPassword = true;
    this.forgotErrorMessage = '';

    this.http.post<{ message?: string }>('/api/auth/reset-password', {
      email: this.forgotPasswordEmail.trim().toLowerCase(),
      otp: this.forgotPasswordOtp.trim(),
      password
    }).pipe(
      finalize(() => {
        this.isResettingPassword = false;
        this.changeDetectorRef.markForCheck();
      })
    ).subscribe({
      next: (res) => {
        this.isForgotPasswordModalOpen = false;
        this.loginForm.controls.email.setValue(this.forgotPasswordEmail);
        this.loginForm.controls.password.reset('');
        this.setAuthMode('login');
        this.registerSuccessMessage = res.message || 'Đặt lại mật khẩu thành công! Vui lòng đăng nhập với mật khẩu mới.';
        this.changeDetectorRef.markForCheck();
      },
      error: (err) => {
        this.forgotErrorMessage = err.error?.message || 'Không thể đặt lại mật khẩu. Vui lòng thử lại từ đầu.';
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  ngOnDestroy(): void {
    this.stopRegisterOtpCountdown();
    this.stopForgotOtpCountdown();
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

  toggleNewPasswordVisibility(): void {
    this.isNewPasswordVisible = !this.isNewPasswordVisible;
  }

  toggleNewConfirmPasswordVisibility(): void {
    this.isNewConfirmPasswordVisible = !this.isNewConfirmPasswordVisible;
  }

  startSocialLogin(provider: 'google' | 'facebook'): void {
    if (provider === 'google') {
      this.loginWithGoogle();
      return;
    }
    if (this.isSocialAuthInProgress) return;

    this.socialAuthMessage = 'Đang kết nối Facebook...';
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

    this.http.post<{ requireOtp?: boolean; email?: string; message?: string }>('/api/auth/register', {
      name: this.registerForm.controls.name.value,
      email: this.registerForm.controls.email.value,
      password,
    }).pipe(
      timeout({ first: 10000 }),
      finalize(() => {
        this.isRegistering = false;
        this.changeDetectorRef.markForCheck();
      }),
    ).subscribe({
      next: (response) => {
        if (response?.requireOtp) {
          this.pendingRegisterEmail = response.email || this.registerForm.controls.email.value || '';
          this.registerOtpCode = '';
          this.registerOtpErrorMessage = '';
          this.registerOtpSuccessMessage = response.message || 'Mã xác thực OTP đã được gửi đến email của bạn.';
          this.isRegisterOtpModalOpen = true;
          this.startRegisterOtpCountdown();
        } else {
          this.loginForm.controls.email.setValue(this.registerForm.controls.email.value);
          this.loginForm.controls.password.reset('');
          this.registerForm.reset();
          this.setAuthMode('login');
          this.registerSuccessMessage = response?.message || 'Đăng ký thành công! Vui lòng đăng nhập.';
        }
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
          !response ||
          typeof response.token !== 'string' ||
          !response.token.trim() ||
          !response.user ||
          typeof response.user.email !== 'string' ||
          !response.user.email.trim()
        ) {
          this.errorMessage = 'Máy chủ trả về dữ liệu đăng nhập không hợp lệ.';
          this.changeDetectorRef.markForCheck();
          return;
        }

        this.completeLogin(response);
      },
      error: (error: unknown) => {
        if (error instanceof TimeoutError) {
          this.errorMessage = 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.';
        } else if (error instanceof HttpErrorResponse && error.status === 401) {
          this.errorMessage = 'Email hoặc mật khẩu không chính xác.';
          this.showRegisterPrompt = true;
        } else if (error instanceof HttpErrorResponse && error.status === 400) {
          this.errorMessage = error.error?.message || 'Vui lòng nhập đầy đủ email và mật khẩu.';
        } else if (error instanceof HttpErrorResponse && error.status === 0) {
          console.error('Không thể kết nối API đăng nhập:', error);
          this.errorMessage = 'Không kết nối được máy chủ. Vui lòng thử lại sau.';
        } else {
          console.error('Lỗi đăng nhập tài khoản:', error);
          this.errorMessage = 'Không thể đăng nhập lúc này. Vui lòng thử lại sau.';
        }
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  private completeLogin(response: LoginResponse): void {
    const role = response.user.role || 'user';
    const avatar = response.user.avatar || '/images/avatar-non.jpg';
    const userId = response.user.id?.trim();

    if (!userId) {
      this.errorMessage = 'Máy chủ trả về tài khoản không có mã người dùng hợp lệ.';
      this.changeDetectorRef.markForCheck();
      return;
    }

    if (isPlatformBrowser(this.platformId)) {
      try {
        this.cart.moveGuestCartToUser(userId);
      } catch (error) {
        console.error('Không thể đồng bộ giỏ hàng khách vào tài khoản:', error);
      }
      localStorage.setItem('isLoggedIn', 'true');
      localStorage.setItem('userName', response.user.name || '');
      localStorage.setItem('userEmail', response.user.email || '');
      localStorage.setItem('userAvatar', avatar);
      localStorage.setItem('userRole', role);
      localStorage.setItem('authToken', response.token);
      localStorage.setItem('userId', userId);
      window.dispatchEvent(new Event('auth:changed'));
    }

    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl')?.trim();
    if (returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//')) {
      void this.router.navigateByUrl(returnUrl);
      return;
    }

    if (role === 'admin') {
      void this.router.navigate(['/admin']);
      return;
    }

    void this.router.navigate(['/']);
  }

  private checkSocialLoginPopup(provider: 'google' | 'facebook'): void {
    if (!this.socialAuthPopup || this.socialAuthPopup.closed) {
      this.finishSocialLogin();
      return;
    }

    try {
      const popupLocation = this.socialAuthPopup.location;
      if (!popupLocation || popupLocation.origin !== window.location.origin) {
        return;
      }

      const payloadElement = this.socialAuthPopup.document.getElementById('oauth-payload');
      const payloadText = payloadElement?.textContent?.trim();
      if (!payloadText) {
        return;
      }

      const payload = JSON.parse(payloadText) as {
        ok?: boolean;
        message?: string;
        token?: string;
        user?: LoginResponse['user'];
      };

      this.clearSocialAuthMonitor();
      try {
        this.socialAuthPopup.close();
      } catch {}
      this.socialAuthPopup = null;
      this.isSocialAuthInProgress = false;

      if (!payload.ok || !payload.token || !payload.user) {
        this.socialAuthMessage = payload.message || `Đăng nhập ${provider} không thành công.`;
        this.changeDetectorRef.markForCheck();
        return;
      }

      this.completeLogin({
        token: payload.token,
        user: payload.user,
      });
    } catch {
      // Bỏ qua lỗi CORS khi popup đang ở domain ngoài
    }
  }

  private finishSocialLogin(message?: string): void {
    this.clearSocialAuthMonitor();
    this.isSocialAuthInProgress = false;
    this.socialAuthPopup = null;
    if (message) {
      this.socialAuthMessage = message;
    }
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
  }
}
