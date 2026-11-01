import { isPlatformBrowser } from '@angular/common';
import { Component, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AdminApiService,
  Promotion,
  PromotionPayload,
  apiErrorMessage
} from './admin-api.service';

interface PromotionForm {
  code: string;
  name: string;
  description: string;
  type: Promotion['type'];
  discountValue: number;
  minOrder: number;
  maxDiscount: number | null;
  startDate: string;
  endDate: string;
  quantity: number | null;
  isActive: boolean;
}

@Component({
  imports: [FormsModule],
  selector: 'admin-promotions',
  templateUrl: './promotions.component.html',
  styleUrl: './promotions.component.css'
})
export class PromotionsComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly promotions = signal<Promotion[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly editingId = signal<string | null>(null);
  form: PromotionForm = this.emptyForm();

  ngOnInit(): void {
    if (this.isBrowser && this.api.token()) {
      void this.load();
    }
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.promotions.set(await this.api.getPromotions());
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Không thể tải chương trình khuyến mãi.'));
    } finally {
      this.loading.set(false);
    }
  }

  edit(promotion: Promotion): void {
    this.editingId.set(promotion._id);
    this.notice.set('');
    this.error.set('');
    this.form = {
      code: promotion.code,
      name: promotion.name,
      description: promotion.description || '',
      type: promotion.type,
      discountValue: promotion.discountValue,
      minOrder: promotion.minOrder,
      maxDiscount: promotion.maxDiscount ?? null,
      startDate: this.toInputDate(promotion.startDate),
      endDate: this.toInputDate(promotion.endDate),
      quantity: promotion.quantity ?? null,
      isActive: promotion.isActive
    };
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.form = this.emptyForm();
    this.error.set('');
  }

  async save(): Promise<void> {
    this.saving.set(true);
    this.error.set('');
    this.notice.set('');
    const payload: PromotionPayload = {
      code: this.form.code.trim().toUpperCase(),
      name: this.form.name.trim(),
      description: this.form.description.trim(),
      type: this.form.type,
      discountValue: Number(this.form.discountValue),
      minOrder: Number(this.form.minOrder),
      maxDiscount: this.form.maxDiscount,
      startDate: this.form.startDate,
      endDate: this.form.endDate,
      quantity: this.form.quantity,
      isActive: this.form.isActive
    };

    try {
      if (this.editingId()) {
        await this.api.updatePromotion(this.editingId()!, payload);
        this.notice.set('Đã cập nhật chương trình khuyến mãi.');
      } else {
        await this.api.createPromotion(payload);
        this.notice.set('Đã tạo chương trình khuyến mãi.');
      }
      this.cancelEdit();
      await this.load();
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Không thể lưu chương trình khuyến mãi.'));
    } finally {
      this.saving.set(false);
    }
  }

  async remove(promotion: Promotion): Promise<void> {
    if (!window.confirm(`Xóa chương trình ${promotion.code}? Thao tác này không thể hoàn tác.`)) {
      return;
    }
    this.error.set('');
    this.notice.set('');
    try {
      await this.api.deletePromotion(promotion._id);
      this.notice.set('Đã xóa chương trình khuyến mãi.');
      await this.load();
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Không thể xóa chương trình khuyến mãi.'));
    }
  }

  formatDiscount(promotion: Promotion): string {
    if (promotion.type === 'percent') {
      return `${promotion.discountValue}%`;
    }
    return `${promotion.discountValue.toLocaleString('vi-VN')}đ`;
  }

  private toInputDate(value?: string): string {
    if (!value) {
      return '';
    }
    const dayFirst = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    return dayFirst ? `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}` : value;
  }

  private emptyForm(): PromotionForm {
    return {
      code: '',
      name: '',
      description: '',
      type: 'percent',
      discountValue: 10,
      minOrder: 0,
      maxDiscount: null,
      startDate: '',
      endDate: '',
      quantity: null,
      isActive: true
    };
  }
}
