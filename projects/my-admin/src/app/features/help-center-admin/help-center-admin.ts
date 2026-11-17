import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-help-center-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './help-center-admin.html',
  styleUrl: './help-center-admin.css',
})
export class HelpCenterAdmin {
  activeFaq: number | null = null;

  helpForm = {
    name: '',
    email: '',
    subject: '',
    message: ''
  };

  toggleFaq(index: number): void {
    this.activeFaq = this.activeFaq === index ? null : index;
  }
  resetForm(form: any): void {
    form.resetForm();
  }
  submitForm(form: any): void {
    if (form.invalid) {
      form.control.markAllAsTouched();
      return;
    }
    alert(
      '✅ Câu hỏi của bạn đã được gửi thành công! ' +
      'Đội ngũ hỗ trợ sẽ liên hệ lại sớm nhất.'
    );

    form.resetForm();
  }
}
