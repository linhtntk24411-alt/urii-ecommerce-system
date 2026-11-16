import { Component } from '@angular/core';
import { NgForm } from '@angular/forms';

@Component({
  imports: [],
  selector: 'app-help-center-admin',
  styleUrl: './help-center-admin.css',
  templateUrl: './help-center-admin.html',
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

  resetForm(form: NgForm): void {
    form.resetForm();
  }

  submitForm(form: NgForm): void {
    if (form.invalid) {
      form.control.markAllAsTouched();
      return;
    }

    // Giữ nguyên hành vi HTML gốc:
    // Chưa có API gửi yêu cầu hỗ trợ.
    alert(
      '✅ Câu hỏi của bạn đã được gửi thành công! ' +
      'Đội ngũ hỗ trợ sẽ liên hệ lại sớm nhất.'
    );

    form.resetForm();
  }
}
