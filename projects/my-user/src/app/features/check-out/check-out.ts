import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, ElementRef, HostListener, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AddressArea, AddressLookupService } from '../../core/services/address-lookup.service';
import { CartItem, CartService } from '../../core/services/cart.service';
import { CheckoutService, CheckoutVoucher, CreateOrderPayload } from '../../core/services/checkout.service';
import { CheckoutSelectionService } from '../../core/services/checkout-selection.service';
import { CatalogProduct, ProductCatalogService } from '../../core/services/product-catalog.service';
import { ToastService } from '../../core/services/toast.service';

interface CheckoutLine {
  item: CartItem;
  product: CatalogProduct | null;
}

interface DeliveryAddress {
  id: string;
  name: string;
  phone: string;
  detail: string;
  ward: string;
  province: string;
  fullAddress: string;
  isDefault: boolean;
}

@Component({
  selector: 'app-check-out',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './check-out.html',
  styleUrl: './check-out.css',
})
export class CheckOut implements OnInit {
  private readonly cart = inject(CartService);
  private readonly catalog = inject(ProductCatalogService);
  private readonly checkout = inject(CheckoutService);
  private readonly selection = inject(CheckoutSelectionService);
  private readonly addressLookup = inject(AddressLookupService);
  private readonly toast = inject(ToastService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  lines: CheckoutLine[] = [];
  vouchers: CheckoutVoucher[] = [];
  loading = true;
  loadingVouchers = false;
  submitting = false;
  errorMessage = '';
  voucherError = '';
  voucherLoadError = '';
  voucherMessage = '';
  appliedVoucher: CheckoutVoucher | null = null;
  voucherCode = '';
  voucherDropdownOpen = false;
  customerName = '';
  phone = '';
  shippingAddress = '';
  orderNote = '';
  paymentMethod = 'cod';
  orderSuccess = false;
  orderNumber = '';
  addresses: DeliveryAddress[] = [];
  selectedAddressId: string | null = null;
  addressManagerOpen = false;
  addAddressFormOpen = false;
  addressError = '';
  addressFormError = '';
  provinces: AddressArea[] = [];
  wards: AddressArea[] = [];
  selectedProvinceCode: number | null = null;
  selectedWardCode: number | null = null;
  loadingProvinces = false;
  loadingWards = false;
  readonly newAddress = { name: '', phone: '', detail: '', isDefault: false };

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.loadAddresses();
    this.loadProvinces();
    this.loadCheckout();
    this.loadVouchers();
  }

  get currentAddress(): DeliveryAddress | null {
    return this.addresses.find((address) => address.id === this.selectedAddressId)
      ?? this.addresses.find((address) => address.isDefault)
      ?? this.addresses[0]
      ?? null;
  }

  get subtotal(): number {
    return this.lines.reduce((total, line) => total + this.lineTotal(line), 0);
  }

  get shippingFee(): number {
    return this.subtotal === 0 || this.subtotal >= 200000 ? 0 : 30000;
  }

  get itemDiscount(): number {
    if (!this.appliedVoucher || this.appliedVoucher.type === 'shipping') return 0;
    const discount = this.appliedVoucher.type === 'percent'
      ? this.subtotal * this.appliedVoucher.discountValue / 100
      : this.appliedVoucher.discountValue;
    const capped = this.appliedVoucher.maxDiscount === undefined
      ? discount
      : Math.min(discount, this.appliedVoucher.maxDiscount);
    return Math.min(this.subtotal, Math.max(0, capped));
  }

  get shippingDiscount(): number {
    return this.appliedVoucher?.type === 'shipping' ? this.shippingFee : 0;
  }

  get totalDiscount(): number {
    return this.itemDiscount + this.shippingDiscount;
  }

  get total(): number {
    return Math.max(0, this.subtotal + this.shippingFee - this.totalDiscount);
  }

  get hasUnavailableItems(): boolean {
    return this.lines.some((line) => !line.product);
  }

  loadCheckout(): void {
    this.loading = true;
    this.errorMessage = '';
    let items: CartItem[];
    try {
      items = this.selection.get() ?? this.cart.getItems();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Không thể đọc giỏ hàng.';
      this.loading = false;
      return;
    }

    if (items.length === 0) {
      this.lines = [];
      this.loading = false;
      return;
    }

    this.catalog.getProducts().subscribe({
      next: (products) => {
        this.lines = items.map((item) => ({
          item,
          product: products.find((product) => product.id === item.productId) ?? null,
        }));
        this.loading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Không thể tải sản phẩm cho checkout:', error);
        this.errorMessage = 'Không thể tải thông tin sản phẩm. Vui lòng thử lại.';
        this.loading = false;
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  loadVouchers(): void {
    this.loadingVouchers = true;
    this.voucherLoadError = '';
    this.checkout.getActiveVouchers().subscribe({
      next: (vouchers) => {
        this.vouchers = vouchers;
        this.loadingVouchers = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Không thể tải danh sách voucher:', error);
        this.voucherLoadError = 'Không tải được voucher. Vui lòng kiểm tra kết nối rồi thử lại.';
        this.loadingVouchers = false;
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  loadAddresses(): void {
    this.addressError = '';
    const email = window.localStorage.getItem('userEmail')?.trim() || 'anonymous';
    const storageKey = `addresses_${email}`;
    const profileAddress = window.localStorage.getItem('userAddress')?.trim() ?? '';
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved !== null) {
        const parsed: unknown = JSON.parse(saved);
        if (!Array.isArray(parsed)) {
          throw new Error('Danh sách địa chỉ đã lưu không đúng định dạng.');
        }
        this.addresses = parsed.flatMap((entry): DeliveryAddress[] => {
          if (!this.isRecord(entry)) return [];
          const id = entry['id'];
          const name = entry['name'];
          const phone = entry['phone'];
          const fullAddress = entry['fullAddress'];
          if (
            typeof id !== 'string'
            || typeof name !== 'string'
            || typeof phone !== 'string'
            || typeof fullAddress !== 'string'
          ) {
            return [];
          }
          return [{
            id,
            name,
            phone,
            detail: typeof entry['detail'] === 'string' ? entry['detail'] : '',
            ward: typeof entry['ward'] === 'string' ? entry['ward'] : '',
            province: typeof entry['province'] === 'string' ? entry['province'] : '',
            fullAddress,
            isDefault: entry['isDefault'] === true,
          }];
        });
      }

      if (profileAddress) {
        const parts = profileAddress.split(',').map((part) => part.trim());
        const existingProfileAddress = this.addresses.find(
          (address) => address.fullAddress.toLocaleLowerCase() === profileAddress.toLocaleLowerCase(),
        );
        const profile: DeliveryAddress = {
          id: existingProfileAddress?.id ?? `profile-${email}`,
          name: window.localStorage.getItem('userName')?.trim() || existingProfileAddress?.name || '',
          phone: window.localStorage.getItem('userPhone')?.trim() || existingProfileAddress?.phone || '',
          detail: existingProfileAddress?.detail || parts[0] || profileAddress,
          ward: existingProfileAddress?.ward || (parts.length > 2 ? parts[1] : ''),
          province: existingProfileAddress?.province || (parts.length > 1 ? parts[parts.length - 1] : ''),
          fullAddress: profileAddress,
          isDefault: true,
        };
        this.addresses = [
          profile,
          ...this.addresses
            .filter((address) => address.id !== profile.id)
            .map((address) => ({ ...address, isDefault: false })),
        ];
        this.persistAddresses();
      }
    } catch (error) {
      console.error('Không thể tải địa chỉ nhận hàng đã lưu:', error);
      this.addressError = error instanceof Error
        ? error.message
        : 'Không thể tải danh sách địa chỉ nhận hàng.';
      this.addresses = [];
    }

    const preferred = this.addresses.find((address) => address.isDefault) ?? this.addresses[0];
    this.selectedAddressId = preferred?.id ?? null;
    if (preferred) {
      this.customerName = preferred.name;
      this.phone = preferred.phone;
      this.shippingAddress = preferred.fullAddress;
    }
  }

  loadProvinces(): void {
    this.loadingProvinces = true;
    this.addressError = '';
    this.addressLookup.getProvinces().subscribe({
      next: (provinces) => {
        this.provinces = provinces;
        this.loadingProvinces = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Không thể tải danh sách tỉnh/thành phố:', error);
        this.addressError = 'Không thể tải danh sách tỉnh/thành phố. Vui lòng thử lại.';
        this.loadingProvinces = false;
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  openAddressManager(): void {
    this.addressManagerOpen = true;
    this.addressFormError = '';
  }

  closeAddressManager(): void {
    this.addressManagerOpen = false;
    this.addAddressFormOpen = false;
    this.addressFormError = '';
  }

  selectAddress(id: string): void {
    this.selectedAddressId = id;
    this.addresses = this.addresses.map((address) => ({
      ...address,
      isDefault: address.id === id,
    }));
    this.persistAddresses();
    this.applyCurrentAddress();
  }

  setDefaultAddress(id: string, event: Event): void {
    event.stopPropagation();
    this.selectAddress(id);
  }

  deleteAddress(id: string, event: Event): void {
    event.stopPropagation();
    if (this.addresses.length <= 1) {
      this.addressFormError = 'Bạn cần ít nhất một địa chỉ nhận hàng.';
      return;
    }
    if (!window.confirm('Bạn có chắc chắn muốn xóa địa chỉ này?')) return;

    const deletingDefault = this.addresses.find((address) => address.id === id)?.isDefault;
    this.addresses = this.addresses.filter((address) => address.id !== id);
    if (deletingDefault || this.selectedAddressId === id) {
      const nextDefault = this.addresses[0];
      this.addresses = this.addresses.map((address, index) => ({
        ...address,
        isDefault: index === 0,
      }));
      this.selectedAddressId = nextDefault?.id ?? null;
    }
    this.persistAddresses();
    this.applyCurrentAddress();
  }

  toggleAddAddressForm(): void {
    this.addAddressFormOpen = !this.addAddressFormOpen;
    this.addressFormError = '';
    if (!this.addAddressFormOpen) {
      this.resetNewAddress();
    }
  }

  onProvinceChange(value: string): void {
    const code = Number(value);
    this.selectedProvinceCode = Number.isInteger(code) && code > 0 ? code : null;
    this.selectedWardCode = null;
    this.wards = [];
    if (this.selectedProvinceCode === null) return;

    this.loadingWards = true;
    this.addressLookup.getWards(this.selectedProvinceCode).subscribe({
      next: (wards) => {
        this.wards = wards;
        this.loadingWards = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Không thể tải danh sách phường/xã:', error);
        this.addressFormError = 'Không thể tải phường/xã. Vui lòng chọn lại tỉnh/thành.';
        this.loadingWards = false;
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  onProvinceSelect(event: Event): void {
    const target = event.target;
    this.onProvinceChange(target instanceof HTMLSelectElement ? target.value : '');
  }

  onWardSelect(event: Event): void {
    const target = event.target;
    const code = target instanceof HTMLSelectElement ? Number(target.value) : NaN;
    this.selectedWardCode = Number.isInteger(code) && code > 0 ? code : null;
  }

  saveNewAddress(): void {
    this.addressFormError = '';
    const name = this.newAddress.name.trim();
    const phone = this.newAddress.phone.replace(/\s+/g, '');
    const detail = this.newAddress.detail.trim();
    const province = this.provinces.find((area) => area.code === this.selectedProvinceCode);
    const ward = this.wards.find((area) => area.code === this.selectedWardCode);

    if (!name || !detail) {
      this.addressFormError = 'Vui lòng nhập họ tên và địa chỉ chi tiết.';
      return;
    }
    if (!/^[0-9]{10,11}$/.test(phone)) {
      this.addressFormError = 'Số điện thoại không hợp lệ (cần 10-11 chữ số).';
      return;
    }
    if (!province || !ward) {
      this.addressFormError = 'Vui lòng chọn tỉnh/thành phố và phường/xã.';
      return;
    }

    const address: DeliveryAddress = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      phone,
      detail,
      ward: ward.name,
      province: province.name,
      fullAddress: `${detail}, ${ward.name}, ${province.name}`,
      isDefault: this.newAddress.isDefault || this.addresses.length === 0,
    };
    if (address.isDefault) {
      this.addresses = this.addresses.map((entry) => ({ ...entry, isDefault: false }));
    }
    this.addresses = [...this.addresses, address];
    this.persistAddresses();
    if (address.isDefault) {
      this.selectedAddressId = address.id;
      this.applyCurrentAddress();
    }
    this.addAddressFormOpen = false;
    this.resetNewAddress();
    this.toast.show('Đã thêm địa chỉ nhận hàng.');
  }

  confirmAddressSelection(): void {
    if (!this.currentAddress) {
      this.addressFormError = 'Vui lòng thêm hoặc chọn địa chỉ nhận hàng.';
      return;
    }
    this.applyCurrentAddress();
    this.closeAddressManager();
  }

  applyVoucher(): void {
    this.voucherError = '';
    this.voucherMessage = '';
    this.voucherDropdownOpen = false;
    const code = this.voucherCode.trim().toUpperCase();
    if (!code) {
      this.voucherError = 'Vui lòng nhập mã voucher.';
      this.appliedVoucher = null;
      return;
    }
    if (this.loadingVouchers) {
      this.voucherError = 'Danh sách voucher đang được tải. Vui lòng thử lại.';
      return;
    }
    if (this.voucherLoadError) {
      this.voucherError = this.voucherLoadError;
      return;
    }

    const voucher = this.vouchers.find((entry) => entry.code === code);
    if (!voucher) {
      this.appliedVoucher = null;
      this.voucherError = 'Mã voucher không hợp lệ hoặc đã hết hạn.';
      return;
    }
    if (this.subtotal < voucher.minOrder) {
      this.appliedVoucher = null;
      this.voucherError = `Đơn hàng cần đạt tối thiểu ${this.formatCurrency(voucher.minOrder)} để dùng mã này.`;
      return;
    }
    if (voucher.type === 'shipping' && this.shippingFee === 0) {
      this.appliedVoucher = null;
      this.voucherError = 'Đơn hàng hiện đã được miễn phí vận chuyển.';
      return;
    }

    this.appliedVoucher = voucher;
    this.voucherMessage = `Đã áp dụng voucher ${voucher.code}.`;
  }

  clearVoucher(): void {
    this.appliedVoucher = null;
    this.voucherCode = '';
    this.voucherError = '';
    this.voucherMessage = '';
  }

  toggleVoucherDropdown(): void {
    if (!this.appliedVoucher) this.voucherDropdownOpen = !this.voucherDropdownOpen;
  }

  @HostListener('document:click', ['$event'])
  closeVoucherDropdownOnOutsideClick(event: MouseEvent): void {
    const voucherBox = this.elementRef.nativeElement.querySelector('.voucher-box');
    if (event.target instanceof Node && !voucherBox?.contains(event.target)) {
      this.voucherDropdownOpen = false;
    }
  }

  @HostListener('document:keydown.escape')
  closeVoucherDropdownOnEscape(): void {
    this.voucherDropdownOpen = false;
  }

  isVoucherApplicable(voucher: CheckoutVoucher): boolean {
    return this.subtotal >= voucher.minOrder
      && (voucher.type !== 'shipping' || this.shippingFee > 0);
  }

  voucherRestriction(voucher: CheckoutVoucher): string {
    if (this.subtotal < voucher.minOrder) {
      return `Đơn tối thiểu ${this.formatCurrency(voucher.minOrder)}`;
    }
    if (voucher.type === 'shipping' && this.shippingFee === 0) {
      return 'Đơn hàng đã được miễn phí vận chuyển';
    }
    return this.voucherDiscountLabel(voucher);
  }

  voucherDiscountLabel(voucher: CheckoutVoucher): string {
    if (voucher.type === 'shipping') return 'Miễn phí vận chuyển';
    if (voucher.type === 'percent') {
      return `Giảm ${voucher.discountValue}%${voucher.maxDiscount !== undefined
        ? `, tối đa ${this.formatCurrency(voucher.maxDiscount)}`
        : ''}`;
    }
    return `Giảm ${this.formatCurrency(voucher.discountValue)}`;
  }

  selectVoucher(voucher: CheckoutVoucher): void {
    if (!this.isVoucherApplicable(voucher)) return;
    this.voucherCode = voucher.code;
    this.voucherDropdownOpen = false;
    this.applyVoucher();
  }

  linePrice(line: CheckoutLine): number {
    const variant = line.product?.variants.find((entry) => entry.name === line.item.variant);
    return variant?.price ?? line.product?.price ?? 0;
  }

  lineTotal(line: CheckoutLine): number {
    return this.linePrice(line) * line.item.quantity;
  }

  placeOrder(): void {
    this.errorMessage = '';
    if (this.submitting) return;
    if (this.lines.length === 0) {
      this.errorMessage = 'Giỏ hàng chưa có sản phẩm để thanh toán.';
      return;
    }
    if (this.hasUnavailableItems) {
      this.errorMessage = 'Một số sản phẩm không còn khả dụng. Vui lòng quay lại giỏ hàng.';
      return;
    }
    const address = this.currentAddress;
    if (!address) {
      this.errorMessage = 'Vui lòng chọn địa chỉ nhận hàng.';
      return;
    }

    const insufficientStock = this.lines.some((line) => {
      const variant = line.product?.variants.find((entry) => entry.name === line.item.variant);
      const stock = variant?.stock ?? line.product?.stock;
      return stock !== undefined && line.item.quantity > stock;
    });
    if (insufficientStock) {
      this.errorMessage = 'Số lượng trong giỏ vượt quá tồn kho hiện tại. Vui lòng cập nhật lại.';
      return;
    }

    const payload: CreateOrderPayload = {
      userName: this.customerName.trim(),
      date: new Date().toISOString(),
      status: 'Đang chờ duyệt',
      statusType: 'pending',
      total: String(Math.round(this.total)),
      items: this.lines.map((line) => ({
        productId: line.item.productId,
        name: line.product?.name ?? '',
        price: this.linePrice(line),
        quantity: line.item.quantity,
        image: line.product?.image ?? '',
      })),
      payment: { method: this.paymentMethod, status: 'pending' },
      shipping: { method: 'standard', fee: this.shippingFee },
      address: {
        name: address.name,
        phone: address.phone,
        address: address.fullAddress,
      },
    };

    this.submitting = true;
    this.checkout.createOrder(payload).subscribe({
      next: (response: unknown) => {
        this.submitting = false;
        this.orderNumber = this.readOrderNumber(response);
        this.orderSuccess = true;
        if (this.selection.shouldRemoveFromCartAfterCheckout()) {
          this.cart.removePurchasedItems(this.lines.map((line) => line.item));
        }
        this.selection.clear();
        this.lines = [];
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        this.submitting = false;
        console.error('Không thể tạo đơn hàng:', error);
        if (error instanceof HttpErrorResponse && error.status === 403) {
          this.errorMessage = 'Backend hiện chỉ cho phép quản trị viên tạo đơn hàng. Đơn chưa được ghi nhận; cần backend mở API cho khách hàng.';
        } else if (error instanceof HttpErrorResponse && error.status === 401) {
          this.errorMessage = 'Máy chủ yêu cầu đăng nhập để tạo đơn. Đơn chưa được ghi nhận.';
        } else if (error instanceof HttpErrorResponse && error.status === 0) {
          this.errorMessage = 'Không kết nối được máy chủ. Đơn chưa được ghi nhận; vui lòng thử lại.';
        } else {
          const serverMessage = this.readServerMessage(error);
          this.errorMessage = serverMessage
            ? `Không thể tạo đơn hàng: ${serverMessage}`
            : 'Không thể tạo đơn hàng. Đơn chưa được ghi nhận; vui lòng thử lại.';
        }
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
      maximumFractionDigits: 0,
    }).format(amount);
  }

  private persistAddresses(): void {
    const email = window.localStorage.getItem('userEmail')?.trim() || 'anonymous';
    try {
      window.localStorage.setItem(`addresses_${email}`, JSON.stringify(this.addresses));
    } catch (error) {
      console.error('Không thể lưu địa chỉ nhận hàng:', error);
      this.addressError = 'Không thể lưu địa chỉ. Vui lòng kiểm tra bộ nhớ trình duyệt.';
    }
  }

  private applyCurrentAddress(): void {
    const address = this.currentAddress;
    if (!address) {
      this.customerName = '';
      this.phone = '';
      this.shippingAddress = '';
      return;
    }
    this.customerName = address.name;
    this.phone = address.phone;
    this.shippingAddress = address.fullAddress;
  }

  private resetNewAddress(): void {
    this.newAddress.name = '';
    this.newAddress.phone = '';
    this.newAddress.detail = '';
    this.newAddress.isDefault = false;
    this.selectedProvinceCode = null;
    this.selectedWardCode = null;
    this.wards = [];
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private readOrderNumber(response: unknown): string {
    if (typeof response !== 'object' || response === null || Array.isArray(response)) return '';
    const record = response as Record<string, unknown>;
    const value = record['id'] ?? record['_id'];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }

  private readServerMessage(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return '';
    if (typeof error.error === 'object' && error.error !== null && 'message' in error.error) {
      const message = error.error['message'];
      return typeof message === 'string' ? message : '';
    }
    return '';
  }
}
