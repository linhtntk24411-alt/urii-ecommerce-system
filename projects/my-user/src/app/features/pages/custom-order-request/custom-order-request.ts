import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

@Component({
  selector: 'app-custom-order-request',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './custom-order-request.html',
  styleUrls: ['./custom-order-request.css']
})
export class CustomOrderRequestComponent {
  currentStep = 1;
  isSubmitting = false;
  showSuccessModal = false;
  generatedOrderCode = '';

  formData = {
    requestName: '',
    size: '',
    beadType: 'Hạt Perler 5mm (Midi Beads)',
    notes: '',
    imageNotes: ''
  };

  selectedFile: File | null = null;
  imagePreviewUrl: string | null = null;

  pricing = {
    mapPrice: 50000,
    materialPrice: 150000,
    totalPrice: 200000
  };

  constructor(private router: Router) {}

  nextStep(step: number) {
    this.currentStep = step;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  goToStep(step: number) {
    if (step === 3) {
      this.renderSummaryPage();
    } else {
      this.nextStep(step);
    }
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      this.imagePreviewUrl = URL.createObjectURL(file);
    }
  }

  removeFile() {
    this.selectedFile = null;
    this.imagePreviewUrl = null;
  }

  renderSummaryPage() {
    let mapPrice = 50000;
    let materialPrice = 150000;
    const sizeText = (this.formData.size || '').toLowerCase().replace(/\s+/g, '');

    if (sizeText.includes('5x5')) {
      materialPrice = 30000;
    } else if (sizeText.includes('15x15')) {
      materialPrice = 120000;
    } else if (sizeText.includes('20x20')) {
      materialPrice = 180000;
    } else if (sizeText.includes('30x30') || sizeText.includes('large')) {
      materialPrice = 280000;
    } else if (sizeText.includes('40x40')) {
      materialPrice = 400000;
    }

    if (this.formData.beadType.includes('2.6mm')) {
      materialPrice += 20000;
    } else if (this.formData.beadType.includes('10mm')) {
      materialPrice -= 20000;
    }

    this.pricing.mapPrice = mapPrice;
    this.pricing.materialPrice = materialPrice;
    this.pricing.totalPrice = mapPrice + materialPrice;

    this.nextStep(3);
  }

  submitRequest() {
    this.isSubmitting = true;

    setTimeout(() => {
      this.isSubmitting = false;
      const randomNumber = Math.floor(1000 + Math.random() * 9000);
      this.generatedOrderCode = `#ORD-${randomNumber}`;

      const today = new Date();
      const formattedDate = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

      const newRequest = {
        id: this.generatedOrderCode,
        image: this.imagePreviewUrl || 'assets/index/custom_order.png',
        name: this.formData.requestName || 'Yêu cầu Custom mới',
        size: this.formData.size || 'Kích thước chuẩn',
        date: formattedDate,
        statusClass: 'status-pending',
        statusText: 'Đang chờ duyệt',
        actionType: 'view-delete'
      };

      let localData = JSON.parse(localStorage.getItem('custom_orders_cache') || '[]');
      localData.unshift(newRequest);
      localStorage.setItem('custom_orders_cache', JSON.stringify(localData));

      this.showSuccessModal = true;
    }, 1500);
  }

  finishAndNavigate() {
    this.showSuccessModal = false;
    this.router.navigate(['/custom-order-list']);
  }
}