import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ChangeDetectorRef, Component, inject, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { AbstractControl, FormBuilder, FormsModule, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { ToastService } from '../../../core/services/toast.service';

interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar: string;
  phone: string;
  birth: string;
  address: string;
  interests: string;
  gender: string;
  joinDate: string;
  orders: number;
  maps: number;
  authProviders: string[];
}

interface ImageUploadResponse {
  imageUrl?: string;
  url?: string;
}

const PRESET_AVATARS = [
  { url: '/images/avatar_user.jpeg', label: 'Avatar Nữ 1' },
  { url: '/images/avatar_user1.jpeg', label: 'Avatar Nữ 2' },
  { url: '/images/avatar_user2.jpeg', label: 'Avatar Nữ 3' },
  { url: '/images/avatar_user3.jpeg', label: 'Avatar Nam' },
  { url: '/images/avatar-non.jpg', label: 'Avatar Mặc định' },
];

function parseBirthDate(value: string): { day: number; month: number; year: number } | null {
  const vietnameseDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const day = vietnameseDate ? Number(vietnameseDate[1]) : isoDate ? Number(isoDate[3]) : 0;
  const month = vietnameseDate ? Number(vietnameseDate[2]) : isoDate ? Number(isoDate[2]) : 0;
  const year = vietnameseDate ? Number(vietnameseDate[3]) : isoDate ? Number(isoDate[1]) : 0;
  const date = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (
    !day || !month || !year
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
    || date > today
  ) {
    return null;
  }
  return { day, month, year };
}

function birthDateValidator(control: AbstractControl): ValidationErrors | null {
  const value = typeof control.value === 'string' ? control.value.trim() : '';
  return value && !parseBirthDate(value) ? { invalidBirthDate: true } : null;
}

@Component({
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  selector: 'app-information',
  styleUrl: './information.css',
  templateUrl: './information.html',
})
export class Information implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly profileForm = this.formBuilder.nonNullable.group({
    name: ['', Validators.required],
    birth: ['', [Validators.required, birthDateValidator]],
    phone: ['', [Validators.required, Validators.pattern(/^\+?[\d\s().-]{7,20}$/)]],
    address: [''],
    interests: [''],
    gender: [{ value: '', disabled: true }],
  });

  profile: UserProfile | null = null;
  isLoading = true;
  isEditing = false;
  isSaving = false;
  requiresLogin = false;
  errorMessage = '';
  successMessage = '';

  readonly presetAvatars = PRESET_AVATARS;
  isAvatarModalOpen = false;
  avatarPreview = '';
  avatarFile: File | null = null;
  isSavingAvatar = false;
  avatarModalError = '';

  // Đổi mật khẩu (xác thực bằng mật khẩu cũ hoặc OTP gửi về Gmail)
  isChangingPassword = false;
  passwordAuthMode: 'old-password' | 'otp' = 'old-password';
  currentPassword = '';
  newPassword = '';
  confirmNewPassword = '';
  passwordOtp = '';
  isSendingOtp = false;
  isSavingPassword = false;
  otpSent = false;
  otpCountdown = 0;
  private otpTimer: ReturnType<typeof setInterval> | null = null;
  passwordError = '';
  passwordSuccess = '';
  showCurrentPassword = false;
  showNewPassword = false;
  showConfirmPassword = false;

  ngOnInit(): void {
    if (this.isBrowser) this.loadProfile();
  }

  ngOnDestroy(): void {
    this.clearOtpTimer();
  }

  loadProfile(): void {
    const token = localStorage.getItem('authToken');
    if (localStorage.getItem('isLoggedIn') !== 'true' || !token) {
      this.requiresLogin = true;
      this.isLoading = false;
      return;
    }

    this.requiresLogin = false;
    this.isLoading = true;
    this.errorMessage = '';
    this.http.get<unknown>('/api/auth/me', {
      headers: this.authorizationHeaders(token),
    }).subscribe({
      next: (response) => {
        const profile = this.parseProfile(response);
        if (!profile) {
          console.error('API hồ sơ cá nhân trả về dữ liệu không hợp lệ.');
          this.errorMessage = 'Thông tin hồ sơ nhận được không hợp lệ. Vui lòng thử lại.';
          this.isLoading = false;
          this.changeDetectorRef.markForCheck();
          return;
        }

        this.setProfile(profile);
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Không thể tải hồ sơ từ API:', error);
        this.isLoading = false;
        this.errorMessage = error instanceof HttpErrorResponse && error.status === 401
          ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
          : 'Không thể tải hồ sơ lúc này. Vui lòng thử lại.';
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  startEditing(): void {
    if (!this.profile) return;
    this.profileForm.reset({
      name: this.profile.name,
      birth: this.displayBirthDate(this.profile.birth),
      phone: this.profile.phone,
      address: this.profile.address,
      interests: this.profile.interests,
      gender: this.profile.gender,
    });
    this.profileForm.controls.gender.enable();
    this.errorMessage = '';
    this.successMessage = '';
    this.isEditing = true;
  }

  cancelEditing(): void {
    this.isEditing = false;
    this.errorMessage = '';
    this.successMessage = '';
    if (this.profile) {
      this.profileForm.reset({
        name: this.profile.name,
        birth: this.displayBirthDate(this.profile.birth),
        phone: this.profile.phone,
        address: this.profile.address,
        interests: this.profile.interests,
        gender: this.profile.gender,
      });
      this.profileForm.controls.gender.disable();
    }
  }

  clearOptionalInformation(): void {
    this.profileForm.patchValue({ address: '', interests: '', gender: '' });
    this.profileForm.controls.address.markAsDirty();
    this.profileForm.controls.interests.markAsDirty();
    this.profileForm.controls.gender.markAsDirty();
  }

  saveProfile(): void {
    if (this.isSaving || this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }

    const token = localStorage.getItem('authToken');
    if (!token || !this.profile) {
      this.requiresLogin = true;
      return;
    }

    const values = this.profileForm.getRawValue();
    const parsedBirth = values.birth.trim() ? parseBirthDate(values.birth) : null;
    const birth = parsedBirth
      ? `${String(parsedBirth.day).padStart(2, '0')}/${String(parsedBirth.month).padStart(2, '0')}/${parsedBirth.year}`
      : '';
    this.isSaving = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.http.patch<unknown>('/api/auth/me', {
      name: values.name.trim(),
      birth,
      phone: values.phone.trim(),
      address: values.address.trim(),
      interests: values.interests.trim(),
      gender: values.gender,
    }, {
      headers: this.authorizationHeaders(token),
    }).pipe(
      finalize(() => {
        this.isSaving = false;
        this.changeDetectorRef.markForCheck();
      }),
    ).subscribe({
      next: (response) => {
        const profile = this.parseProfile(response);
        if (!profile) {
          console.error('API cập nhật hồ sơ trả về dữ liệu không hợp lệ.');
          this.errorMessage = 'Đã gửi cập nhật nhưng dữ liệu trả về không hợp lệ. Hãy tải lại hồ sơ.';
          return;
        }

        this.setProfile(profile);
        this.isEditing = false;
        this.successMessage = 'Đã cập nhật hồ sơ thành công.';
        this.toast.show('Đã cập nhật hồ sơ thành công!', 'success', 'Hồ sơ cá nhân');
        if (this.isBrowser) {
          localStorage.setItem('userName', profile.name);
          localStorage.setItem('userEmail', profile.email);
          localStorage.setItem('userAvatar', profile.avatar);
          window.dispatchEvent(new Event('auth:changed'));
        }
      },
      error: (error: unknown) => {
        console.error('Không thể cập nhật hồ sơ:', error);
        this.errorMessage = error instanceof HttpErrorResponse && error.error?.message
          ? error.error.message
          : 'Không thể cập nhật hồ sơ. Vui lòng thử lại.';
        this.toast.show(this.errorMessage, 'error', 'Lỗi cập nhật hồ sơ');
      },
    });
  }

  signIn(): void {
    void this.router.navigate(['/login'], { queryParams: { returnUrl: '/profile' } });
  }

  openAvatarModal(): void {
    if (!this.profile) return;
    this.avatarPreview = this.profile.avatar;
    this.avatarFile = null;
    this.avatarModalError = '';
    this.isAvatarModalOpen = true;
  }

  closeAvatarModal(force = false): void {
    if (this.isSavingAvatar && !force) return;
    this.isSavingAvatar = false;
    this.isAvatarModalOpen = false;
    this.avatarFile = null;
    this.avatarPreview = '';
    this.avatarModalError = '';
  }

  selectPresetAvatar(url: string): void {
    this.avatarFile = null;
    this.avatarPreview = url;
    this.avatarModalError = '';
  }

  onAvatarFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    if (!file.type.startsWith('image/')) {
      this.avatarModalError = 'Vui lòng chọn file hình ảnh hợp lệ (PNG, JPG, WEBP, GIF).';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.avatarModalError = 'Dung lượng ảnh vượt quá 5MB. Vui lòng chọn ảnh nhỏ hơn.';
      return;
    }

    this.avatarModalError = '';
    this.avatarFile = file;

    const reader = new FileReader();
    reader.onload = () => {
      this.avatarPreview = String(reader.result || '');
      this.changeDetectorRef.markForCheck();
    };
    reader.readAsDataURL(file);
  }

  saveAvatar(): void {
    const token = localStorage.getItem('authToken');
    if (!token || !this.profile) {
      this.requiresLogin = true;
      this.closeAvatarModal();
      return;
    }

    if (!this.avatarFile && !this.avatarPreview) {
      this.avatarModalError = 'Vui lòng chọn hoặc tải lên một ảnh đại diện.';
      return;
    }

    this.isSavingAvatar = true;
    this.avatarModalError = '';

    const executePatch = (finalAvatarUrl: string) => {
      this.http.patch<unknown>(
        '/api/auth/me',
        { avatar: finalAvatarUrl },
        { headers: this.authorizationHeaders(token) }
      ).pipe(
        finalize(() => {
          this.isSavingAvatar = false;
          this.changeDetectorRef.markForCheck();
        })
      ).subscribe({
        next: (response) => {
          const updated = this.parseProfile(response);
          if (updated) {
            this.profile = {
              ...this.profile!,
              ...updated,
              avatar: updated.avatar,
            };
          } else {
            this.profile = {
              ...this.profile!,
              avatar: this.normalizeAvatar(finalAvatarUrl),
            };
          }

          if (this.isBrowser) {
            localStorage.setItem('userAvatar', this.profile.avatar);
            window.dispatchEvent(new Event('auth:changed'));
          }

          this.successMessage = 'Đã cập nhật ảnh đại diện thành công.';
          this.toast.show('Đã cập nhật ảnh đại diện thành công!', 'success', 'Ảnh đại diện');
          this.closeAvatarModal(true);
        },
        error: (error: unknown) => {
          console.error('Lỗi khi cập nhật ảnh đại diện:', error);
          this.avatarModalError = error instanceof HttpErrorResponse && error.error?.message
            ? error.error.message
            : 'Không thể cập nhật ảnh đại diện. Vui lòng thử lại.';
          this.toast.show(this.avatarModalError, 'error', 'Lỗi ảnh đại diện');
        }
      });
    };

    if (this.avatarFile) {
      const uploadHeaders = new HttpHeaders({
        'Content-Type': this.avatarFile.type,
        Authorization: `Bearer ${token}`,
      });
      this.http.post<ImageUploadResponse>('/api/upload', this.avatarFile, { headers: uploadHeaders }).subscribe({
        next: (res) => {
          const uploadedUrl = res?.imageUrl ?? res?.url;
          executePatch(uploadedUrl && typeof uploadedUrl === 'string' ? uploadedUrl : this.avatarPreview);
        },
        error: (err) => {
          console.warn('Lỗi khi upload qua /api/upload, tiếp tục với Data URL:', err);
          executePatch(this.avatarPreview);
        }
      });
    } else {
      executePatch(this.avatarPreview);
    }
  }

  openChangePassword(mode: 'old-password' | 'otp' = 'old-password'): void {
    this.isChangingPassword = true;
    this.passwordAuthMode = mode;
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmNewPassword = '';
    this.passwordOtp = '';
    this.passwordError = '';
    this.passwordSuccess = '';
  }

  cancelChangePassword(): void {
    if (this.isSavingPassword) return;
    this.isChangingPassword = false;
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmNewPassword = '';
    this.passwordOtp = '';
    this.passwordError = '';
    this.clearOtpTimer();
    this.otpSent = false;
    this.otpCountdown = 0;
  }

  switchPasswordAuthMode(mode: 'old-password' | 'otp'): void {
    this.passwordAuthMode = mode;
    this.passwordError = '';
    this.passwordSuccess = '';
    if (mode === 'otp' && !this.otpSent && !this.isSendingOtp) {
      this.sendPasswordOtp();
    }
  }

  formatOtpCountdown(): string {
    const minutes = Math.floor(this.otpCountdown / 60);
    const seconds = this.otpCountdown % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  private clearOtpTimer(): void {
    if (this.otpTimer) {
      clearInterval(this.otpTimer);
      this.otpTimer = null;
    }
  }

  private startOtpCountdown(seconds = 60): void {
    this.clearOtpTimer();
    this.otpCountdown = seconds;
    this.otpTimer = setInterval(() => {
      if (this.otpCountdown > 0) {
        this.otpCountdown -= 1;
      } else {
        this.clearOtpTimer();
      }
      this.changeDetectorRef.markForCheck();
    }, 1000);
  }

  sendPasswordOtp(): void {
    if (!this.profile?.email || this.isSendingOtp || this.otpCountdown > 0) return;
    this.isSendingOtp = true;
    this.passwordError = '';
    this.passwordSuccess = '';
    this.toast.show(`Đang gửi mã OTP đến ${this.profile.email}...`, 'warning', 'Đang chờ gửi mã');

    this.http.post<{ message?: string }>('/api/auth/forgot-password', {
      email: this.profile.email,
    }).pipe(
      finalize(() => {
        this.isSendingOtp = false;
        this.changeDetectorRef.markForCheck();
      }),
    ).subscribe({
      next: (res) => {
        this.otpSent = true;
        this.startOtpCountdown(60);
        this.passwordSuccess = res?.message || `Đã gửi mã OTP 6 chữ số đến Gmail ${this.profile?.email}.`;
        this.toast.show(this.passwordSuccess, 'success', 'Đã gửi mã OTP');
      },
      error: (error: unknown) => {
        this.passwordError = error instanceof HttpErrorResponse && error.error?.message
          ? error.error.message
          : 'Không thể gửi mã OTP lúc này. Vui lòng thử lại.';
        this.toast.show(this.passwordError, 'error', 'Lỗi gửi OTP');
      },
    });
  }

  submitChangePassword(): void {
    if (this.isSavingPassword || !this.profile) return;
    this.passwordError = '';
    this.passwordSuccess = '';

    const nextPass = this.newPassword;
    if (
      nextPass.length < 8
      || !/[A-Z]/.test(nextPass)
      || !/[a-z]/.test(nextPass)
      || !/[0-9]/.test(nextPass)
    ) {
      this.passwordError = 'Mật khẩu mới phải có ít nhất 8 ký tự, bao gồm chữ hoa, chữ thường và chữ số.';
      this.toast.show(this.passwordError, 'error', 'Mật khẩu chưa hợp lệ');
      return;
    }

    if (nextPass !== this.confirmNewPassword) {
      this.passwordError = 'Mật khẩu xác nhận không khớp với mật khẩu mới.';
      this.toast.show(this.passwordError, 'error', 'Mật khẩu không khớp');
      return;
    }

    if (this.passwordAuthMode === 'old-password') {
      if (!this.currentPassword) {
        this.passwordError = 'Vui lòng nhập mật khẩu hiện tại để xác thực.';
        this.toast.show(this.passwordError, 'warning', 'Thiếu mật khẩu hiện tại');
        return;
      }
      const token = localStorage.getItem('authToken');
      if (!token) {
        this.requiresLogin = true;
        return;
      }

      this.isSavingPassword = true;
      this.toast.show('Đang xác thực và cập nhật mật khẩu...', 'warning', 'Đang xử lý');
      this.http.patch<unknown>('/api/auth/me', {
        currentPassword: this.currentPassword,
        password: nextPass,
      }, {
        headers: this.authorizationHeaders(token),
      }).pipe(
        finalize(() => {
          this.isSavingPassword = false;
          this.changeDetectorRef.markForCheck();
        }),
      ).subscribe({
        next: () => {
          this.isChangingPassword = false;
          this.currentPassword = '';
          this.newPassword = '';
          this.confirmNewPassword = '';
          this.passwordSuccess = 'Đã đổi mật khẩu thành công!';
          this.toast.show('Đã đổi mật khẩu thành công!', 'success', 'Bảo mật tài khoản');
        },
        error: (error: unknown) => {
          this.passwordError = error instanceof HttpErrorResponse && error.error?.message
            ? error.error.message
            : 'Không thể đổi mật khẩu. Vui lòng kiểm tra lại mật khẩu cũ.';
          this.toast.show(this.passwordError, 'error', 'Đổi mật khẩu thất bại');
        },
      });
      return;
    }

    // Chế độ xác thực bằng OTP gửi về Gmail
    const otpCode = this.passwordOtp.trim();
    if (!/^\d{6}$/.test(otpCode)) {
      this.passwordError = 'Vui lòng nhập đúng mã OTP 6 chữ số đã gửi về Gmail của bạn.';
      this.toast.show(this.passwordError, 'warning', 'Chưa nhập đủ mã OTP');
      return;
    }

    this.isSavingPassword = true;
    this.toast.show('Đang xác thực mã OTP và đổi mật khẩu...', 'warning', 'Đang xử lý');
    this.http.post<{ message?: string }>('/api/auth/reset-password', {
      email: this.profile.email,
      otp: otpCode,
      password: nextPass,
    }).pipe(
      finalize(() => {
        this.isSavingPassword = false;
        this.changeDetectorRef.markForCheck();
      }),
    ).subscribe({
      next: (res) => {
        this.isChangingPassword = false;
        this.passwordOtp = '';
        this.newPassword = '';
        this.confirmNewPassword = '';
        this.clearOtpTimer();
        this.otpSent = false;
        this.otpCountdown = 0;
        this.passwordSuccess = res?.message || 'Đã xác thực OTP và đổi mật khẩu mới thành công!';
        this.toast.show(this.passwordSuccess, 'success', 'Đổi mật khẩu thành công');
      },
      error: (error: unknown) => {
        this.passwordError = error instanceof HttpErrorResponse && error.error?.message
          ? error.error.message
          : 'Mã xác thực OTP không hợp lệ hoặc đã hết hạn.';
        this.toast.show(this.passwordError, 'error', 'Xác thực OTP thất bại');
      },
    });
  }

  private setProfile(profile: UserProfile): void {
    this.profile = profile;
    this.profileForm.reset({
      name: profile.name,
      birth: this.displayBirthDate(profile.birth),
      phone: profile.phone,
      address: profile.address,
      interests: profile.interests,
      gender: profile.gender,
    });
    this.profileForm.controls.gender.disable();
  }

  private displayBirthDate(value: string): string {
    const parsed = parseBirthDate(value);
    if (!parsed) return value;
    return `${String(parsed.day).padStart(2, '0')}/${String(parsed.month).padStart(2, '0')}/${parsed.year}`;
  }

  private authorizationHeaders(token: string): HttpHeaders {
    return new HttpHeaders({ Authorization: 'Bearer ' + token });
  }

  private parseProfile(value: unknown): UserProfile | null {
    if (!this.isRecord(value) || typeof value['email'] !== 'string' || typeof value['name'] !== 'string') {
      return null;
    }
    return {
      id: this.text(value['id'] ?? value['_id']),
      name: value['name'],
      email: value['email'],
      role: this.text(value['role']),
      avatar: this.normalizeAvatar(this.text(value['avatar'])),
      phone: this.text(value['phone']),
      birth: this.text(value['birth']),
      address: this.text(value['address']),
      interests: this.text(value['interests']),
      gender: this.text(value['gender']),
      joinDate: this.text(value['joinDate']),
      orders: this.number(value['orders']),
      maps: this.number(value['maps']),
      authProviders: Array.isArray(value['authProviders'])
        ? value['authProviders'].filter((provider): provider is string => typeof provider === 'string')
        : [],
    };
  }

  private normalizeAvatar(value: string): string {
    if (value.startsWith('/images/')) return `/api${value}`;
    if (value.startsWith('images/')) return `/api/${value}`;
    return value;
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private number(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
