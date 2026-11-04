import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-custom-order',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './custom-order.html',
  styleUrls: ['./custom-order.css']
})
export class CustomOrderComponent {
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  customOrderForm: FormGroup;
  currentStep: number = 1; 
  
  imagePreview: string | ArrayBuffer | null = null;
  selectedImage: File | null = null;
  isSubmitting: boolean = false;
  errorMessage = '';
  successMessage = '';

  constructor(private fb: FormBuilder) {
    this.customOrderForm = this.fb.group({
      fullName: ['', Validators.required],
      phone: ['', [Validators.required, Validators.pattern(/^(?:0\d{9}|\+84\d{9})$/)]],
      email: ['', [Validators.required, Validators.email]],
      requestName: ['', Validators.required],
      size: [''],
      beadType: ['Hạt Perler 5mm (Midi Beads)'],
      description: ['', Validators.required],
      imageNote: [''],
    });
  }

  goToStep(step: number) {
    this.currentStep = step;
  }

  nextStep() {
    if (this.currentStep === 1) {
      const step1Controls = ['fullName', 'phone', 'email', 'requestName', 'description'];
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

  onFileSelected(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (file) {
      if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) {
        this.selectedImage = null;
        this.imagePreview = null;
        this.errorMessage = file.size > 10 * 1024 * 1024
          ? 'Ảnh tải lên không được vượt quá 10MB.'
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

  onSubmit(): void {
    if (this.customOrderForm.invalid) {
      this.customOrderForm.markAllAsTouched();
      this.currentStep = 1;
      this.errorMessage = 'Vui lòng kiểm tra các thông tin bắt buộc trước khi gửi.';
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.errorMessage = 'Chức năng gửi yêu cầu hiện đang tắt để frontend chỉ đọc dữ liệu từ backend nhóm.';
    this.changeDetectorRef.markForCheck();
  }
}