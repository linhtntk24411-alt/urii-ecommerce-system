import { CommonModule, isPlatformBrowser, Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AddressArea, AddressLookupService } from '../../core/services/address-lookup.service';
import { CartItem, CartService } from '../../core/services/cart.service';
import {
  CheckoutService,
  CheckoutVoucher,
  CreateOrderPayload,
  OrderPaymentInfo,
  PaymentStatusId,
} from '../../core/services/checkout.service';
import { CheckoutSelectionService } from '../../core/services/checkout-selection.service';
import { CatalogProduct, ProductCatalogService } from '../../core/services/product-catalog.service';
import { ToastService } from '../../core/services/toast.service';
import { UserSocketService } from '../../core/services/user-socket.service';
import { DialogService } from '../../core/services/dialog.service';

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

interface PersistedQrPaymentSession {
  orderId: string;
  orderNumber: string;
  paymentCode: string;
  qrCodeUrl: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export type CopiedPaymentField = 'accountNumber' | 'amountDue' | 'paymentCode';

@Component({
  selector: 'app-check-out',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './check-out.html',
  styleUrl: './check-out.css',
})
export class CheckOut implements OnInit, OnDestroy {
  private readonly cart = inject(CartService);
  private readonly catalog = inject(ProductCatalogService);
  private readonly checkout = inject(CheckoutService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly selection = inject(CheckoutSelectionService);
  private readonly addressLookup = inject(AddressLookupService);
  private readonly toast = inject(ToastService);
  private readonly socket = inject(UserSocketService);
  private readonly dialogService = inject(DialogService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private currentUserId: string | null = null;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private pollingSubscription: Subscription | null = null;
  private copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  readonly pollIntervalMs = 4000;

  lines: CheckoutLine[] = [];
  vouchers: CheckoutVoucher[] = [];
  loading = true;
  loginRequired = false;
  profileLoading = false;
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

  qrCheckoutActive = false;
  creatingPayment = false;
  restoringPayment = false;
  qrPaymentCreateFailed = false;
  qrImageError = false;
  paymentError = '';
  pollingError = '';
  pollingActive = false;
  pollingInFlight = false;
  activePaymentOrderId: string | null = null;
  paymentInfo: OrderPaymentInfo | null = null;
  copiedField: CopiedPaymentField | null = null;

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
    const token = window.localStorage.getItem('authToken')?.trim();
    const userId = window.localStorage.getItem('userId')?.trim();
    if (window.localStorage.getItem('isLoggedIn') !== 'true' || !token || !userId) {
      this.loginRequired = true;
      this.loadCheckout();
      return;
    }

    this.currentUserId = userId;
    this.loadCurrentUser(token);
    this.loadProvinces();
    this.loadCheckout();
    this.loadVouchers(token);
    this.tryRestoreActiveQrSession(token);
  }

  ngOnDestroy(): void {
    this.stopPaymentPolling();
    if (this.copyResetTimer !== null) {
      clearTimeout(this.copyResetTimer);
      this.copyResetTimer = null;
    }
  }

  private loadCurrentUser(token: string): void {
    this.profileLoading = true;
    this.checkout.getCurrentUser(token).subscribe({
      next: (response: unknown) => {
        if (!this.isRecord(response)
          || (typeof response['id'] === 'string' ? response['id'] : response['_id']) !== this.currentUserId
          || typeof response['name'] !== 'string'
          || typeof response['email'] !== 'string') {
          console.error('API hồ sơ cá nhân trả về dữ liệu không hợp lệ hoặc không khớp tài khoản đang đăng nhập.');
          this.addressError = 'Không thể xác thực thông tin hồ sơ. Vui lòng tải lại trang.';
          this.profileLoading = false;
          this.changeDetectorRef.markForCheck();
          return;
        }

        const name = response['name'].trim();
        const email = response['email'].trim();
        const phone = typeof response['phone'] === 'string' ? response['phone'].trim() : '';
        const address = typeof response['address'] === 'string' ? response['address'].trim() : '';
        window.localStorage.setItem('userName', name);
        window.localStorage.setItem('userEmail', email);
        window.localStorage.setItem('userPhone', phone);
        window.localStorage.setItem('userAddress', address);
        this.customerName = name;
        this.phone = phone;
        this.loadAddresses();
        this.profileLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Không thể tải hồ sơ khách hàng cho checkout:', error);
        if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 404)) {
          this.profileLoading = false;
          this.loginRequired = true;
          this.changeDetectorRef.markForCheck();
          return;
        }
        this.addressError = 'Không thể tải hồ sơ. Vui lòng thử lại trước khi đặt hàng.';
        this.profileLoading = false;
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  get currentAddress(): DeliveryAddress | null {
    return this.addresses.find((address) => address.id === this.selectedAddressId)
      ?? this.addresses.find((address) => address.isDefault)
      ?? this.addresses[0]
      ?? null;
  }

  goToLogin(): void {
    void this.router.navigate(['/login'], { queryParams: { returnUrl: '/checkout' } });
  }

  goToRegister(): void {
    void this.router.navigate(['/register'], { queryParams: { returnUrl: '/checkout' } });
  }

  goBackToPreviousPage(): void {
    this.location.back();
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

  get sortedVouchers(): CheckoutVoucher[] {
    return this.vouchers
      .map((voucher, index) => ({ voucher, index }))
      .sort((a, b) => Number(this.isVoucherApplicable(b.voucher)) - Number(this.isVoucherApplicable(a.voucher))
        || a.index - b.index)
      .map(({ voucher }) => voucher);
  }

  loadCheckout(): void {
    this.loading = true;
    this.errorMessage = '';
    const selected = this.selection.get();
    if (selected !== null) {
      this.loadProductsForCheckout(selected);
      return;
    }

    this.cart.loadItems().subscribe({
      next: (items) => this.loadProductsForCheckout(items),
      error: (error: unknown) => {
        console.error('Không thể tải giỏ hàng cho checkout:', error);
        this.errorMessage = 'Không thể đồng bộ giỏ hàng. Vui lòng thử lại.';
        this.loading = false;
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  private loadProductsForCheckout(items: CartItem[]): void {
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

  loadVouchers(token: string): void {
    this.loadingVouchers = true;
    this.voucherLoadError = '';
    this.checkout.getMyAvailableVouchers(token).subscribe({
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
    this.addresses = [];
    this.selectedAddressId = null;
    this.shippingAddress = '';
    const storageKey = this.addressStorageKey();
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
        if (window.localStorage.getItem(storageKey) === null) {
          window.localStorage.setItem(storageKey, JSON.stringify(this.addresses));
        }
      }

      if (profileAddress) {
        const parts = profileAddress.split(',').map((part) => part.trim());
        const existingProfileAddress = this.addresses.find(
          (address) => address.fullAddress.toLocaleLowerCase() === profileAddress.toLocaleLowerCase(),
        );
        const profile: DeliveryAddress = {
          id: existingProfileAddress?.id ?? `profile-${this.currentUserId}`,
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

  async deleteAddress(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    if (this.addresses.length <= 1) {
      this.addressFormError = 'Bạn cần ít nhất một địa chỉ nhận hàng.';
      return;
    }
    const confirmed = await this.dialogService.confirm('Bạn có chắc chắn muốn xóa địa chỉ này?', 'Xác nhận xóa địa chỉ', 'Xóa', 'Hủy');
    if (!confirmed) return;

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

  private resolveLineVariantIndex(line: CheckoutLine): number | null {
    if (typeof line.item.variantIndex === 'number' && line.item.variantIndex >= 0) {
      return line.item.variantIndex;
    }
    if (!line.item.variant || !line.product?.variants?.length) {
      return null;
    }
    const foundIndex = line.product.variants.findIndex((entry) => entry.name === line.item.variant);
    return foundIndex >= 0 ? foundIndex : null;
  }

  placeOrder(): void {
    this.errorMessage = '';
    this.paymentError = '';
    if (this.submitting || this.creatingPayment) return;

    const token = window.localStorage.getItem('authToken')?.trim();
    if (!token) {
      this.loginRequired = true;
      return;
    }

    if (this.paymentMethod === 'bank_transfer' && this.activePaymentOrderId && this.qrPaymentCreateFailed) {
      this.requestQrPayment(this.activePaymentOrderId, token);
      return;
    }

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

    const isBankTransfer = this.paymentMethod === 'bank_transfer';
    const payload: CreateOrderPayload = {
      userName: this.customerName.trim(),
      date: new Date().toISOString(),
      status: 'Đang chờ duyệt',
      statusType: 'pending',
      total: String(Math.round(this.total)),
      items: this.lines.map((line) => {
        const variantIndex = this.resolveLineVariantIndex(line);
        return {
          productId: line.item.productId,
          name: line.product?.name ?? '',
          price: this.linePrice(line),
          quantity: line.item.quantity,
          image: line.product?.image ?? '',
          ...(line.item.variant ? { variantName: line.item.variant } : {}),
          ...(variantIndex !== null ? { variantIndex } : {}),
        };
      }),
      payment: isBankTransfer
        ? {
            method: 'bank_transfer',
            methodId: 'bank_transfer',
            status: 'Chờ thanh toán',
            statusId: 'awaiting_payment',
          }
        : { method: this.paymentMethod, status: 'pending' },
      shipping: { method: 'standard', fee: this.shippingFee },
      ...(this.orderNote.trim() ? { note: this.orderNote.trim() } : {}),
      ...(this.appliedVoucher
        ? { voucher: { voucherId: this.appliedVoucher.id, discountAmount: this.totalDiscount } }
        : {}),
      address: {
        name: address.name,
        phone: address.phone,
        address: address.fullAddress,
      },
    };

    this.submitting = true;
    this.checkout.createOrder(payload, token).subscribe({
      next: (response: unknown) => {
        this.submitting = false;
        const createdOrderId = this.readOrderNumber(response);
        this.orderNumber = createdOrderId;
        if (this.selection.shouldRemoveFromCartAfterCheckout()) {
          this.cart.removePurchasedItems(this.lines.map((line) => line.item));
        }
        this.selection.clear();
        this.lines = [];

        if (isBankTransfer) {
          if (!createdOrderId) {
            this.errorMessage = 'Đơn hàng đã tạo nhưng máy chủ không trả về mã đơn hàng để khởi tạo QR.';
            this.changeDetectorRef.markForCheck();
            return;
          }
          this.activePaymentOrderId = createdOrderId;
          this.qrCheckoutActive = true;
          this.requestQrPayment(createdOrderId, token);
          this.changeDetectorRef.markForCheck();
          return;
        }

        this.orderSuccess = true;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        this.submitting = false;
        console.error('Không thể tạo đơn hàng:', error);
        if (error instanceof HttpErrorResponse && error.status === 403) {
          this.errorMessage = 'Bạn không có quyền tạo đơn hàng. Đơn chưa được ghi nhận.';
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

  requestQrPayment(orderId: string, tokenOverride?: string): void {
    const token = tokenOverride ?? window.localStorage.getItem('authToken')?.trim();
    if (!token) {
      this.stopPaymentPolling();
      this.loginRequired = true;
      this.changeDetectorRef.markForCheck();
      return;
    }

    this.creatingPayment = true;
    this.paymentError = '';
    this.pollingError = '';
    this.qrPaymentCreateFailed = false;
    this.qrImageError = false;
    this.activePaymentOrderId = orderId;
    this.qrCheckoutActive = true;

    this.checkout.createOrderPayment(orderId, token).subscribe({
      next: (payment) => {
        this.creatingPayment = false;
        this.qrPaymentCreateFailed = false;
        this.paymentInfo = payment;
        this.orderNumber = this.orderNumber || payment.orderId;

        if (payment.statusId === 'awaiting_payment' && !payment.isExpired) {
          this.persistQrSession(payment);
          this.startPaymentPolling(payment.orderId);
        } else {
          this.stopPaymentPolling();
          if (payment.statusId === 'paid' || payment.statusId === 'cancelled') {
            this.clearPersistedQrSession();
          }
        }
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        this.creatingPayment = false;
        this.qrPaymentCreateFailed = true;
        console.error('Không thể khởi tạo thanh toán QR:', error);
        this.paymentError = this.formatPaymentApiError(error, 'Không thể tạo mã QR thanh toán.');
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  retryCreateQrPayment(): void {
    const orderId = this.paymentInfo?.orderId ?? this.activePaymentOrderId;
    if (!orderId || this.creatingPayment) return;
    this.requestQrPayment(orderId);
  }

  recreateExpiredQrPayment(): void {
    const orderId = this.paymentInfo?.orderId ?? this.activePaymentOrderId;
    if (!orderId || this.creatingPayment) return;
    this.requestQrPayment(orderId);
  }

  startPaymentPolling(orderId: string): void {
    this.stopPaymentPolling();
    if (!this.isBrowser || !orderId) return;

    this.pollingActive = true;
    this.pollingTimer = setInterval(() => {
      this.pollPaymentOnce(orderId, false);
    }, this.pollIntervalMs);
  }

  stopPaymentPolling(): void {
    if (this.pollingTimer !== null) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    if (this.pollingSubscription !== null) {
      this.pollingSubscription.unsubscribe();
      this.pollingSubscription = null;
    }
    this.pollingInFlight = false;
    this.pollingActive = false;
  }

  checkPaymentStatusNow(): void {
    const orderId = this.paymentInfo?.orderId ?? this.activePaymentOrderId;
    if (!orderId) return;
    this.pollPaymentOnce(orderId, true);
  }

  private pollPaymentOnce(orderId: string, isManual: boolean): void {
    if (this.pollingInFlight && !isManual) {
      return;
    }
    if (isManual && this.pollingSubscription !== null) {
      this.pollingSubscription.unsubscribe();
      this.pollingSubscription = null;
    }

    const token = window.localStorage.getItem('authToken')?.trim();
    if (!token) {
      this.stopPaymentPolling();
      this.loginRequired = true;
      this.changeDetectorRef.markForCheck();
      return;
    }

    this.pollingInFlight = true;
    if (isManual) {
      this.pollingError = '';
      this.paymentError = '';
    }

    this.pollingSubscription = this.checkout.getOrderPaymentStatus(orderId, token).subscribe({
      next: (latest) => {
        this.pollingInFlight = false;
        this.pollingError = '';
        this.paymentError = '';
        this.paymentInfo = this.mergePaymentWithCachedQr(latest, this.paymentInfo);

        if (latest.statusId === 'paid') {
          this.stopPaymentPolling();
          this.clearPersistedQrSession();
          this.toast.show('Đã nhận thanh toán thành công!');
        } else if (latest.statusId === 'expired' || latest.isExpired) {
          this.stopPaymentPolling();
        } else if (latest.statusId === 'cancelled') {
          this.stopPaymentPolling();
          this.clearPersistedQrSession();
        } else if (isManual) {
          this.toast.show('Hệ thống vẫn đang chờ nhận giao dịch chuyển khoản.');
          if (!this.pollingActive) {
            this.startPaymentPolling(orderId);
          }
        }
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        this.pollingInFlight = false;
        console.error('Lỗi khi kiểm tra trạng thái thanh toán:', error);
        if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403 || error.status === 404)) {
          this.stopPaymentPolling();
          this.pollingError = this.formatPaymentApiError(error, 'Không thể kiểm tra trạng thái thanh toán.');
        } else if (error instanceof HttpErrorResponse && error.status === 0) {
          this.pollingError = 'Mất kết nối mạng khi kiểm tra trạng thái thanh toán. Bạn có thể bấm "Kiểm tra lại trạng thái" để thử lại.';
        } else {
          this.pollingError = this.formatPaymentApiError(
            error,
            'Không thể đồng bộ trạng thái thanh toán tạm thời. Vui lòng thử kiểm tra lại.',
          );
        }
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  private tryRestoreActiveQrSession(token: string): void {
    const saved = this.readPersistedQrSession();
    if (!saved || !saved.orderId) return;

    this.paymentMethod = 'bank_transfer';
    this.activePaymentOrderId = saved.orderId;
    this.orderNumber = saved.orderNumber || saved.orderId;
    this.qrCheckoutActive = true;
    this.restoringPayment = true;
    this.paymentError = '';
    this.pollingError = '';

    this.checkout.getOrderPaymentStatus(saved.orderId, token).subscribe({
      next: (latest) => {
        this.restoringPayment = false;
        const merged = this.mergePaymentWithPersistedSession(latest, saved);
        this.paymentInfo = merged;

        if (merged.statusId === 'awaiting_payment' && !merged.isExpired) {
          if (merged.qrCodeUrl) {
            this.persistQrSession(merged);
            this.startPaymentPolling(merged.orderId);
          } else {
            this.requestQrPayment(merged.orderId, token);
          }
        } else {
          this.stopPaymentPolling();
          if (merged.statusId === 'paid' || merged.statusId === 'cancelled') {
            this.clearPersistedQrSession();
          }
        }
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        this.restoringPayment = false;
        console.error('Không thể khôi phục phiên thanh toán QR:', error);
        if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 403)) {
          this.clearPersistedQrSession();
          this.qrCheckoutActive = false;
          this.activePaymentOrderId = null;
          this.errorMessage = 'Không tìm thấy phiên thanh toán trước đó. Vui lòng kiểm tra mục Đơn hàng của bạn.';
        } else {
          this.paymentError = this.formatPaymentApiError(
            error,
            'Không thể khôi phục trạng thái thanh toán do lỗi kết nối. Vui lòng bấm "Kiểm tra lại trạng thái".',
          );
        }
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  private mergePaymentWithCachedQr(
    latest: OrderPaymentInfo,
    previous: OrderPaymentInfo | null,
  ): OrderPaymentInfo {
    if (!previous || previous.paymentCode !== latest.paymentCode) {
      return latest;
    }
    const keepQr = latest.statusId === 'awaiting_payment' && !latest.isExpired;
    return {
      ...latest,
      qrCodeUrl: latest.qrCodeUrl || (keepQr ? previous.qrCodeUrl : ''),
      bankCode: latest.bankCode || previous.bankCode,
      bankName: latest.bankName || previous.bankName,
      accountNumber: latest.accountNumber || previous.accountNumber,
      accountName: latest.accountName || previous.accountName,
    };
  }

  private mergePaymentWithPersistedSession(
    latest: OrderPaymentInfo,
    saved: PersistedQrPaymentSession,
  ): OrderPaymentInfo {
    if (saved.paymentCode && saved.paymentCode !== latest.paymentCode) {
      return latest;
    }
    const keepQr = latest.statusId === 'awaiting_payment' && !latest.isExpired;
    return {
      ...latest,
      qrCodeUrl: latest.qrCodeUrl || (keepQr ? saved.qrCodeUrl : ''),
      bankCode: latest.bankCode || saved.bankCode,
      bankName: latest.bankName || saved.bankName,
      accountNumber: latest.accountNumber || saved.accountNumber,
      accountName: latest.accountName || saved.accountName,
    };
  }

  onQrImageError(): void {
    this.qrImageError = true;
    this.changeDetectorRef.markForCheck();
  }

  async copyPaymentField(field: CopiedPaymentField, rawValue: string, successMessage: string): Promise<void> {
    const value = rawValue.trim();
    if (!value || !this.isBrowser) return;

    let copied = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        copied = false;
      }
    }

    if (copied) {
      this.copiedField = field;
      if (this.copyResetTimer !== null) {
        clearTimeout(this.copyResetTimer);
      }
      this.copyResetTimer = setTimeout(() => {
        this.copiedField = null;
        this.changeDetectorRef.markForCheck();
      }, 2000);
      this.toast.show(successMessage);
      this.changeDetectorRef.markForCheck();
    } else {
      this.toast.show('Không thể tự động sao chép. Vui lòng sao chép thủ công.');
    }
  }

  paymentStatusLabel(statusId: PaymentStatusId | undefined): string {
    switch (statusId) {
      case 'awaiting_payment':
        return 'Đang chờ thanh toán';
      case 'paid':
        return 'Đã thanh toán';
      case 'expired':
        return 'Đã hết hạn';
      case 'cancelled':
        return 'Đã hủy';
      default:
        return 'Đang xử lý';
    }
  }

  exitQrCheckout(): void {
    this.stopPaymentPolling();
    this.clearPersistedQrSession();
    this.qrCheckoutActive = false;
    this.paymentInfo = null;
    this.activePaymentOrderId = null;
    this.paymentError = '';
    this.pollingError = '';
    this.qrPaymentCreateFailed = false;
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
      maximumFractionDigits: 0,
    }).format(amount);
  }

  private qrSessionStorageKey(): string | null {
    if (!this.currentUserId) return null;
    return `activeQrPayment:v1:user:${this.currentUserId}`;
  }

  private persistQrSession(payment: OrderPaymentInfo): void {
    const key = this.qrSessionStorageKey();
    if (!key || !this.isBrowser) return;
    const sessionData: PersistedQrPaymentSession = {
      orderId: payment.orderId,
      orderNumber: this.orderNumber || payment.orderId,
      paymentCode: payment.paymentCode,
      qrCodeUrl: payment.qrCodeUrl,
      bankCode: payment.bankCode,
      bankName: payment.bankName,
      accountNumber: payment.accountNumber,
      accountName: payment.accountName,
    };
    try {
      window.localStorage.setItem(key, JSON.stringify(sessionData));
    } catch (error) {
      console.error('Không thể lưu thông tin phiên QR:', error);
    }
  }

  private readPersistedQrSession(): PersistedQrPaymentSession | null {
    const key = this.qrSessionStorageKey();
    if (!key || !this.isBrowser) return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!this.isRecord(parsed) || typeof parsed['orderId'] !== 'string' || !parsed['orderId'].trim()) {
        return null;
      }
      return {
        orderId: parsed['orderId'].trim(),
        orderNumber: typeof parsed['orderNumber'] === 'string' ? parsed['orderNumber'].trim() : parsed['orderId'].trim(),
        paymentCode: typeof parsed['paymentCode'] === 'string' ? parsed['paymentCode'].trim() : '',
        qrCodeUrl: typeof parsed['qrCodeUrl'] === 'string' ? parsed['qrCodeUrl'].trim() : '',
        bankCode: typeof parsed['bankCode'] === 'string' ? parsed['bankCode'].trim() : '',
        bankName: typeof parsed['bankName'] === 'string' ? parsed['bankName'].trim() : '',
        accountNumber: typeof parsed['accountNumber'] === 'string' ? parsed['accountNumber'].trim() : '',
        accountName: typeof parsed['accountName'] === 'string' ? parsed['accountName'].trim() : '',
      };
    } catch {
      return null;
    }
  }

  private clearPersistedQrSession(): void {
    const key = this.qrSessionStorageKey();
    if (!key || !this.isBrowser) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage errors on cleanup
    }
  }

  private formatPaymentApiError(error: unknown, fallback: string): string {
    const serverMessage = this.readServerMessage(error);
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return 'Không kết nối được máy chủ thanh toán. Vui lòng kiểm tra kết nối mạng và thử lại.';
      }
      if (error.status === 401) {
        return 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.';
      }
      if (error.status === 403) {
        return serverMessage || 'Bạn không có quyền truy cập thông tin thanh toán của đơn hàng này.';
      }
      if (error.status === 404) {
        return serverMessage || 'Không tìm thấy đơn hàng hoặc thông tin thanh toán.';
      }
      if (error.status === 409) {
        return serverMessage || 'Không thể khởi tạo thanh toán cho trạng thái đơn hàng hiện tại.';
      }
      if (error.status === 503) {
        return serverMessage || 'Cổng thanh toán QR đang tạm thời bảo trì. Vui lòng thử lại sau.';
      }
    }
    return serverMessage ? `${fallback} (${serverMessage})` : fallback;
  }

  private persistAddresses(): void {
    try {
      window.localStorage.setItem(this.addressStorageKey(), JSON.stringify(this.addresses));
    } catch (error) {
      console.error('Không thể lưu địa chỉ nhận hàng:', error);
      this.addressError = 'Không thể lưu địa chỉ. Vui lòng kiểm tra bộ nhớ trình duyệt.';
    }
  }

  private addressStorageKey(): string {
    if (!this.currentUserId) {
      throw new Error('Không thể tải địa chỉ nếu chưa xác định tài khoản hiện tại.');
    }
    return `addresses:v2:user:${this.currentUserId}`;
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
