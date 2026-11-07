import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom, TimeoutError } from 'rxjs';

interface ImageUploadResponse {
  imageUrl?: string;
  url?: string;
}

@Component({
  selector: 'app-custom-order',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './custom-order.html',
  styleUrls: ['./custom-order.css']
})
export class CustomOrderComponent {
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  customOrderForm: FormGroup;
  currentStep: number = 1; 
  
  imagePreview: string | ArrayBuffer | null = null;
  selectedImage: File | null = null;
  isSubmitting: boolean = false;
  hasSubmitted = false;
  errorMessage = '';
  successMessage = '';

  constructor(private fb: FormBuilder) {
    this.customOrderForm = this.fb.group({
      fullName: ['', Validators.required],
      phone: ['', [Validators.required, Validators.pattern(/^(?:0\d{9}|\+84\d{9})$/)]],
      email: ['', [Validators.required, Validators.email]],
      requestName: ['', Validators.required],
      size: ['', Validators.required],
      beadType: ['Hạt Perler 5mm (Midi Beads)', Validators.required],
      description: ['', Validators.required],
      imageNote: [''],
      imageUrl: [''],
    });
  }

  goToStep(step: number) {
    this.currentStep = step;
  }

  startNewOrder(): void {
    this.customOrderForm.reset({ beadType: 'Hạt Perler 5mm (Midi Beads)' });
    this.currentStep = 1;
    this.imagePreview = null;
    this.selectedImage = null;
    this.hasSubmitted = false;
    this.errorMessage = '';
    this.successMessage = '';
  }

  nextStep() {
    if (this.currentStep === 1) {
      const step1Controls = ['fullName', 'phone', 'email', 'requestName', 'size', 'beadType', 'description'];
      let isValid = true;
      this.errorMessage = '';
      step1Controls.forEach(control => {
        if (this.customOrderForm.get(control)?.invalid) {
          this.customOrderForm.get(control)?.markAsTouched();
          isValid = false;
        }
      });
      if (!isValid) {
        this.errorMessage = 'Vui lòng kiểm tra các thông tin bắt buộc. Số điện thoại cần có dạng 0xxxxxxxxx hoặc +84xxxxxxxxx.';
        return;
      }
    }
    
    if (this.currentStep < 3) {
      this.currentStep++;
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
    }
  }

  viewMyRequests(): void {
    void this.router.navigate(['/custom-order-list']);
  }

  onFileSelected(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (file) {
      if (!file.type.startsWith('image/') || file.size > 8 * 1024 * 1024) {
        this.selectedImage = null;
        this.imagePreview = null;
        this.errorMessage = file.size > 8 * 1024 * 1024
          ? 'Ảnh tải lên không được vượt quá 8MB.'
          : 'Vui lòng chọn file ảnh hợp lệ.';
        return;
      }

      this.errorMessage = '';
      this.selectedImage = file;
      const reader = new FileReader();
      reader.onload = () => {
        this.imagePreview = reader.result;
        this.changeDetectorRef.markForCheck();
      };
      reader.readAsDataURL(file);
    }
  }

  async onSubmit(): Promise<void> {
    if (this.isSubmitting || this.hasSubmitted) return;

    const token = localStorage.getItem('authToken');
    if (localStorage.getItem('isLoggedIn') !== 'true' || !token) {
      this.requireLogin();
      return;
    }

    if (this.customOrderForm.invalid) {
      this.customOrderForm.markAllAsTouched();
      this.currentStep = 1;
      this.errorMessage = 'Vui lòng kiểm tra các thông tin bắt buộc trước khi gửi.';
      return;
    }

    const formValue = this.customOrderForm.getRawValue();
    const publicImageUrl = String(formValue.imageUrl ?? '').trim();
    if (publicImageUrl && !this.isValidImageUrl(publicImageUrl)) {
      this.errorMessage = 'Đường dẫn ảnh cần là URL http/https hoặc đường dẫn /images/ hợp lệ.';
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.isSubmitting = true;
    this.changeDetectorRef.markForCheck();

    try {
      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
      let imageUrl: string | undefined = publicImageUrl || undefined;
      if (!imageUrl && this.selectedImage) {
        const uploadHeaders = headers.set('Content-Type', this.selectedImage.type);
        const upload = await firstValueFrom(this.http.post<ImageUploadResponse>(
          '/api/upload',
          this.selectedImage,
          { headers: uploadHeaders },
        ));
        imageUrl = upload.imageUrl ?? upload.url;
        if (typeof imageUrl !== 'string' || !imageUrl.trim()) {
          throw new Error('API tải ảnh không trả về đường dẫn ảnh hợp lệ.');
        }
      }

      const payload = {
        fullName: String(formValue.fullName).trim(),
        phone: String(formValue.phone).trim(),
        email: String(formValue.email).trim(),
        requestName: String(formValue.requestName).trim(),
        size: String(formValue.size).trim(),
        beadType: String(formValue.beadType).trim(),
        description: String(formValue.description).trim(),
        imageNote: String(formValue.imageNote ?? '').trim(),
        ...(imageUrl ? { imageUrl } : {}),
      };
      await firstValueFrom(this.http.post<unknown>('/api/custom-orders', payload, { headers }));
      this.hasSubmitted = true;
      this.successMessage = 'Đã gửi yêu cầu đơn đặt hàng thành công. Admin sẽ liên hệ với bạn sau khi tiếp nhận yêu cầu.';
      this.customOrderForm.reset({ beadType: 'Hạt Perler 5mm (Midi Beads)' });
      this.currentStep = 1;
      this.selectedImage = null;
      this.imagePreview = null;
    } catch (error: unknown) {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.requireLogin();
      } else if (error instanceof HttpErrorResponse && error.error?.message) {
        this.errorMessage = error.error.message;
      } else if (error instanceof TimeoutError) {
        this.errorMessage = 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.';
      } else if (error instanceof Error && error.message === 'API tải ảnh không trả về đường dẫn ảnh hợp lệ.') {
        console.error('API tải ảnh trả về dữ liệu không hợp lệ:', error);
        this.errorMessage = error.message;
      } else {
        console.error('Lỗi gửi yêu cầu Custom:', error);
        this.errorMessage = 'Không thể gửi yêu cầu lúc này. Vui lòng thử lại sau.';
      }
    } finally {
      this.isSubmitting = false;
      this.changeDetectorRef.markForCheck();
    }
  }

  private requireLogin(): void {
    window.alert('Hãy đăng nhập để gửi yêu cầu Custom');
    void this.router.navigate(['/login'], {
      queryParams: { returnUrl: this.router.url },
    });
  }

  private isValidImageUrl(value: string): boolean {
    if (value.startsWith('/images/')) {
      return !value.includes('\\')
        && !value.includes('?')
        && !value.includes('#')
        && value.split('/').slice(1).every((segment) => segment && segment !== '.' && segment !== '..');
    }

    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }
}