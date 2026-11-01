import { Component } from '@angular/core';
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
  customOrderForm: FormGroup;
  currentStep: number = 1; 
  
  imagePreview: string | ArrayBuffer | null = null;
  base64Image: string = '';
  isSubmitting: boolean = false;

  constructor(private fb: FormBuilder) {
    this.customOrderForm = this.fb.group({
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
      const step1Controls = ['requestName', 'description'];
      let isValid = true;
      step1Controls.forEach(control => {
        if (this.customOrderForm.get(control)?.invalid) {
          this.customOrderForm.get(control)?.markAsTouched();
          isValid = false;
        }
      });
      if (!isValid) {
        alert('Vui lòng điền đầy đủ Tên yêu cầu và Mô tả!');
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

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        alert('Vui lòng chọn file ảnh!');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        this.imagePreview = reader.result;
        this.base64Image = reader.result as string;
      };
      reader.readAsDataURL(file);
    }
  }

  onSubmit() {
    if (this.customOrderForm.invalid) {
      alert('Vui lòng quay lại các bước trước để điền đầy đủ thông tin bắt buộc (*) trước khi gửi!');
      return; 
    }

    this.isSubmitting = true;
    const orderData = {
      ...this.customOrderForm.value,
      imageBase64: this.base64Image
    };

    console.log('Dữ liệu gửi đi:', orderData);
    
    // Giả lập gửi thành công
    setTimeout(() => {
      alert('Đã gửi yêu cầu thiết kế thành công!');
      this.isSubmitting = false;
      this.customOrderForm.reset({ beadType: 'Hạt Perler 5mm (Midi Beads)' });
      this.imagePreview = null;
      this.base64Image = '';
      this.currentStep = 1;
    }, 1000);
  }
}