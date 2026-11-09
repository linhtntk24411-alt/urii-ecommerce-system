import { ComponentFixture, TestBed } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Location } from '@angular/common';
import localeVi from '@angular/common/locales/vi';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { CartService } from '../../core/services/cart.service';
import { CheckoutSelectionService } from '../../core/services/checkout-selection.service';
import { CheckoutVoucher } from '../../core/services/checkout.service';
import { ToastService } from '../../core/services/toast.service';
import { CheckOut } from './check-out';

registerLocaleData(localeVi, 'vi-VN');

describe('CheckOut', () => {
  let component: CheckOut;
  let fixture: ComponentFixture<CheckOut>;
  let http: HttpTestingController;

  beforeEach(async () => {
    window.localStorage.clear();
    window.localStorage.setItem('isLoggedIn', 'true');
    window.localStorage.setItem('authToken', 'checkout-token');
    window.localStorage.setItem('userId', 'checkout-user-id');
    await TestBed.configureTestingModule({
      imports: [CheckOut],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(CheckOut);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    flushCart();
    flushProvinces();
    flushProfile();
    http.expectOne('/api/user-vouchers/available-to-use').flush([]);
    await fixture.whenStable();
  });

  function flushProvinces(): void {
    http.expectOne('https://provinces.open-api.vn/api/v2/p/').flush([
      { code: 1, name: 'Thành phố mẫu' },
    ]);
  }

  function flushProfile(profile: Record<string, unknown> = {
    id: 'checkout-user-id',
    name: 'Khách hàng',
    email: 'customer@example.com',
    phone: '0900000000',
    address: '',
  }): void {
    http.expectOne('/api/auth/me').flush(profile);
  }

  function flushCart(items: Array<Record<string, unknown>> = []): void {
    http.expectOne('/api/cart').flush({ items });
  }

  function flushCartAdd(productId: string, quantity = 1): void {
    http.expectOne('/api/cart/items').flush({
      items: [{
        itemId: `cart-${productId}`,
        productId,
        variantName: null,
        variantIndex: null,
        quantity,
        selected: true,
      }],
    });
  }

  function selectCheckoutAddress(): void {
    component.addresses = [{
      id: 'address-1',
      name: 'Khách hàng',
      phone: '0900000000',
      detail: 'Số 1',
      ward: 'Phường mẫu',
      province: 'Thành phố mẫu',
      fullAddress: 'Số 1, Phường mẫu, Thành phố mẫu',
      isDefault: true,
    }];
    component.selectedAddressId = 'address-1';
  }

  function prepareSingleProductCheckout(price = 100000, quantity = 1): void {
    TestBed.inject(CheckoutSelectionService).set(
      [{ productId: 'p-1', variant: null, quantity }],
      false,
    );
    component.loadCheckout();
    http.expectOne('/api/products').flush([
      { id: 'p-1', name: 'Sản phẩm mẫu', price, stock: 10, variants: [] },
    ]);
    selectCheckoutAddress();
    fixture.detectChanges();
  }

  function samplePaymentPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      payment: {
        id: 'pay-1',
        orderId: 'order-qr-1',
        paymentCode: 'URII1234567890ABCDEF',
        amountDue: 130000,
        currency: 'VND',
        methodId: 'bank_transfer',
        provider: 'sepay',
        statusId: 'awaiting_payment',
        expiresAt: '2027-12-31T23:59:59.000Z',
        paidAt: null,
        isExpired: false,
        isPayable: true,
        qrCodeUrl: 'https://img.vietqr.io/image/970422-0123456789-compact2.png?amount=130000&addInfo=URII1234567890ABCDEF&accountName=URII+OFFICIAL+STORE',
        ...overrides,
      },
    };
  }

  afterEach(() => {
    component.stopPaymentPolling();
    vi.useRealTimers();
    http.verify();
    window.localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows a login prompt to guest customers before allowing checkout', () => {
    fixture.destroy();
    window.localStorage.clear();
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(CheckOut);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.loginRequired).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Đăng nhập để tiếp tục thanh toán');
    expect(fixture.nativeElement.textContent).toContain('Chưa có tài khoản?');
    expect(navigateSpy).not.toHaveBeenCalled();

    const registerLink = fixture.nativeElement.querySelector('.checkout-login-register a') as HTMLAnchorElement;
    expect(registerLink.getAttribute('href')).toContain('/register');
    expect(registerLink.getAttribute('href')).toContain('returnUrl');

    const loginButton = fixture.nativeElement.querySelector('.checkout-login-primary') as HTMLButtonElement;
    loginButton.click();

    expect(navigateSpy).toHaveBeenCalledWith(
      ['/login'],
      { queryParams: { returnUrl: '/checkout' } },
    );

    const location = TestBed.inject(Location);
    const backSpy = vi.spyOn(location, 'back');
    const closeButton = fixture.nativeElement.querySelector('.checkout-login-close') as HTMLButtonElement;
    expect(closeButton.getAttribute('aria-label')).toBe('Quay lại trang trước');
    closeButton.click();
    expect(backSpy).toHaveBeenCalledOnce();
    expect(navigateSpy).toHaveBeenCalledOnce();

    http.expectNone('/api/auth/me');
    http.expectNone('/api/products');
    http.expectNone('/api/user-vouchers/available-to-use');
    http.expectNone('https://provinces.open-api.vn/api/v2/p/');
  });

  it('keeps guest cart items visible behind the login prompt', () => {
    fixture.destroy();
    window.localStorage.clear();
    const cart = TestBed.inject(CartService);
    cart.addItem({ productId: 'guest-product', variant: null, quantity: 2 });

    fixture = TestBed.createComponent(CheckOut);
    component = fixture.componentInstance;
    fixture.detectChanges();

    http.expectOne('/api/products').flush([
      { id: 'guest-product', name: 'Sản phẩm khách', price: 25000, stock: 5, variants: [] },
    ]);
    fixture.detectChanges();

    expect(component.loginRequired).toBe(true);
    expect(component.lines).toHaveLength(1);
    expect(cart.getItems()).toEqual([
      { productId: 'guest-product', variant: null, quantity: 2 },
    ]);

    const backSpy = vi.spyOn(TestBed.inject(Location), 'back');
    const closeButton = fixture.nativeElement.querySelector('.checkout-login-close') as HTMLButtonElement;
    closeButton.click();
    expect(backSpy).toHaveBeenCalledOnce();
    expect(cart.getItems()).toEqual([
      { productId: 'guest-product', variant: null, quantity: 2 },
    ]);
  });

  it('applies a voucher owned by the current account', () => {
    const cart = TestBed.inject(CartService);
    cart.addItem({ productId: 'p-1', variant: null, quantity: 2 });
    http.expectOne('/api/cart/items').flush({
      items: [{
        itemId: 'cart-p-1',
        productId: 'p-1',
        variantName: null,
        variantIndex: null,
        quantity: 2,
        selected: true,
      }],
    });
    fixture.destroy();
    fixture = TestBed.createComponent(CheckOut);
    component = fixture.componentInstance;
    fixture.detectChanges();
    flushCart([{
      itemId: 'cart-p-1',
      productId: 'p-1',
      variantName: null,
      variantIndex: null,
      quantity: 2,
      selected: true,
    }]);
    flushProvinces();
    flushProfile();

    http.expectOne('/api/products').flush([
      { id: 'p-1', name: 'Sản phẩm', price: 100000, stock: 5, variants: [] },
    ]);
    http.expectOne('/api/user-vouchers/available-to-use').flush([
      {
        userId: 'checkout-user-id',
        voucherId: 'voucher-1',
        isUsed: false,
        voucher: {
          id: 'voucher-1',
          code: 'SAVE10',
          name: 'Giảm 10%',
          type: 'percent',
          discountValue: 10,
          minOrder: 0,
          isActive: true,
        },
      },
    ]);

    component.voucherCode = 'save10';
    component.applyVoucher();

    expect(component.subtotal).toBe(200000);
    expect(component.itemDiscount).toBe(20000);
    expect(component.total).toBe(180000);
  });

  it('opens the available voucher list and applies a selected eligible voucher', () => {
    TestBed.inject(CartService).addItem({ productId: 'p-1', variant: null, quantity: 1 });
    flushCartAdd('p-1');
    component.loadCheckout();
    flushCart([{
      itemId: 'cart-p-1',
      productId: 'p-1',
      variantName: null,
      variantIndex: null,
      quantity: 1,
      selected: true,
    }]);
    http.expectOne('/api/products').flush([
      { id: 'p-1', name: 'Sản phẩm', price: 100000, stock: 5, variants: [] },
    ]);
    fixture.detectChanges();
    component.vouchers = [
      {
        id: 'voucher-ineligible',
        code: 'SAVE20',
        name: 'Giảm 20%',
        type: 'percent',
        discountValue: 20,
        minOrder: 150000,
      },
      {
        id: 'voucher-eligible',
        code: 'SAVE10',
        name: 'Giảm 10%',
        type: 'percent',
        discountValue: 10,
        minOrder: 0,
      },
    ] satisfies CheckoutVoucher[];

    const input = fixture.nativeElement.querySelector('#voucherCode') as HTMLInputElement;
    input.click();
    fixture.detectChanges();

    expect(component.voucherDropdownOpen).toBe(true);
    const options = fixture.nativeElement.querySelectorAll('.voucher-option') as NodeListOf<HTMLButtonElement>;
    expect(options[0].textContent).toContain('SAVE10');
    expect(options[1].textContent).toContain('SAVE20');
    expect(fixture.nativeElement.textContent).toContain('SAVE10');
    expect(fixture.nativeElement.textContent).toContain('Đơn tối thiểu 150.000');
    const eligibleOption = options[0];
    expect(eligibleOption.disabled).toBe(false);
    eligibleOption.click();
    fixture.detectChanges();

    expect(component.appliedVoucher?.code).toBe('SAVE10');
    expect(component.voucherDropdownOpen).toBe(false);
    expect(component.itemDiscount).toBe(10000);
  });

  it('closes the voucher list when toggled, clicking outside, or pressing Escape', () => {
    TestBed.inject(CartService).addItem({ productId: 'p-1', variant: null, quantity: 1 });
    flushCartAdd('p-1');
    component.loadCheckout();
    flushCart([{
      itemId: 'cart-p-1',
      productId: 'p-1',
      variantName: null,
      variantIndex: null,
      quantity: 1,
      selected: true,
    }]);
    http.expectOne('/api/products').flush([
      { id: 'p-1', name: 'Sản phẩm', price: 100000, stock: 5, variants: [] },
    ]);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('#voucherCode') as HTMLInputElement;

    input.click();
    fixture.detectChanges();
    expect(component.voucherDropdownOpen).toBe(true);

    input.click();
    fixture.detectChanges();
    expect(component.voucherDropdownOpen).toBe(false);

    input.click();
    document.body.click();
    fixture.detectChanges();
    expect(component.voucherDropdownOpen).toBe(false);

    input.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(component.voucherDropdownOpen).toBe(false);
  });

  it('creates new orders in the pending approval state (COD remains unchanged and does not call payment API)', () => {
    const cart = TestBed.inject(CartService);
    cart.addItem({ productId: 'p-1', variant: null, quantity: 1 });
    flushCartAdd('p-1');
    fixture.destroy();
    fixture = TestBed.createComponent(CheckOut);
    component = fixture.componentInstance;
    fixture.detectChanges();
    flushCart([{
      itemId: 'cart-p-1',
      productId: 'p-1',
      variantName: null,
      variantIndex: null,
      quantity: 1,
      selected: true,
    }]);
    flushProvinces();
    flushProfile();

    http.expectOne('/api/products').flush([
      { id: 'p-1', name: 'Sản phẩm', price: 100000, stock: 5, variants: [] },
    ]);
    http.expectOne('/api/user-vouchers/available-to-use').flush([]);

    selectCheckoutAddress();
    expect(component.paymentMethod).toBe('cod');
    component.orderNote = 'Gọi trước khi giao.';
    component.appliedVoucher = {
      id: 'voucher-1',
      code: 'SAVE10',
      name: 'Giảm 10%',
      type: 'percent',
      discountValue: 10,
      minOrder: 0,
    };
    component.placeOrder();

    const request = http.expectOne('/api/orders');
    expect(request.request.headers.get('Authorization')).toBe('Bearer checkout-token');
    expect(request.request.body.status).toBe('Đang chờ duyệt');
    expect(request.request.body.statusType).toBe('pending');
    expect(request.request.body.payment).toEqual({ method: 'cod', status: 'pending' });
    expect(request.request.body.note).toBe('Gọi trước khi giao.');
    expect(request.request.body.voucher).toEqual({ voucherId: 'voucher-1', discountAmount: 10000 });
    request.flush({ id: 'order-1' });
    http.expectOne('/api/cart/items/cart-p-1').flush({ items: [] });
    http.expectNone('/api/orders/order-1/payment');

    expect(component.orderSuccess).toBe(true);
    expect(component.qrCheckoutActive).toBe(false);
    expect(component.orderNumber).toBe('order-1');
  });

  it('does not remove existing cart items after a successful buy-now checkout', () => {
    const cart = TestBed.inject(CartService);
    cart.addItem({ productId: 'p-1', variant: null, quantity: 3 });
    flushCartAdd('p-1', 3);
    TestBed.inject(CheckoutSelectionService).set(
      [{ productId: 'p-1', variant: null, quantity: 1 }],
      false,
    );

    component.loadCheckout();
    http.expectOne('/api/products').flush([
      { id: 'p-1', name: 'Sản phẩm', price: 100000, stock: 5, variants: [] },
    ]);
    selectCheckoutAddress();
    component.placeOrder();

    http.expectOne('/api/orders').flush({ id: 'order-buy-now' });

    expect(cart.getItems()[0]).toMatchObject({
      productId: 'p-1',
      variant: null,
      quantity: 3,
      itemId: 'cart-p-1',
    });
  });

  it('loads wards from the provinces API and saves the selected delivery address', () => {
    component.openAddressManager();
    component.newAddress.name = 'Nguyễn An';
    component.newAddress.phone = '0901234567';
    component.newAddress.detail = 'Số 12 đường mẫu';
    component.newAddress.isDefault = true;
    component.onProvinceChange('1');

    http.expectOne('https://provinces.open-api.vn/api/v2/p/1?depth=2').flush({
      code: 1,
      name: 'Thành phố mẫu',
      wards: [{ code: 101, name: 'Phường mẫu' }],
    });
    component.selectedWardCode = 101;
    component.saveNewAddress();

    expect(component.currentAddress).toMatchObject({
      name: 'Nguyễn An',
      phone: '0901234567',
      fullAddress: 'Số 12 đường mẫu, Phường mẫu, Thành phố mẫu',
      isDefault: true,
    });
    expect(window.localStorage.getItem('addresses:v2:user:checkout-user-id')).toContain('Nguyễn An');
  });

  it('uses the user profile address as the default ahead of saved delivery addresses', () => {
    window.localStorage.setItem('userEmail', 'customer@example.com');
    window.localStorage.setItem('userName', 'Nguyễn An');
    window.localStorage.setItem('userPhone', '0901234567');
    window.localStorage.setItem('userAddress', 'Số 12 đường chính, Phường A, Thành phố B');
    window.localStorage.setItem('addresses:v2:user:checkout-user-id', JSON.stringify([{
      id: 'old-address',
      name: 'Nguyễn An',
      phone: '0901234567',
      detail: 'Số 99',
      ward: 'Phường cũ',
      province: 'Thành phố cũ',
      fullAddress: 'Số 99, Phường cũ, Thành phố cũ',
      isDefault: true,
    }]));

    component.loadAddresses();

    expect(component.currentAddress?.fullAddress).toBe('Số 12 đường chính, Phường A, Thành phố B');
    expect(component.currentAddress?.isDefault).toBe(true);
    expect(component.addresses.find((address) => address.id === 'old-address')?.isDefault).toBe(false);
    expect(component.shippingAddress).toBe('Số 12 đường chính, Phường A, Thành phố B');
  });

  it('uses the current server profile address ahead of saved delivery addresses', () => {
    fixture.destroy();
    window.localStorage.setItem('addresses:v2:user:checkout-user-id', JSON.stringify([{
      id: 'old-address',
      name: 'Nguyễn An',
      phone: '0901234567',
      detail: 'Số 99',
      ward: 'Phường cũ',
      province: 'Thành phố cũ',
      fullAddress: 'Số 99, Phường cũ, Thành phố cũ',
      isDefault: true,
    }]));

    fixture = TestBed.createComponent(CheckOut);
    component = fixture.componentInstance;
    fixture.detectChanges();
    flushProvinces();
    flushCart();
    flushProfile({
      id: 'checkout-user-id',
      name: 'Nguyễn An',
      email: 'customer@example.com',
      phone: '0901234567',
      address: 'Số 12 đường chính, Phường A, Thành phố B',
    });
    http.expectOne('/api/user-vouchers/available-to-use').flush([]);

    expect(component.currentAddress?.fullAddress).toBe('Số 12 đường chính, Phường A, Thành phố B');
    expect(component.currentAddress?.isDefault).toBe(true);
    expect(component.addresses.find((address) => address.id === 'old-address')?.isDefault).toBe(false);
    expect(window.localStorage.getItem('userAddress')).toBe('Số 12 đường chính, Phường A, Thành phố B');
    expect(window.localStorage.getItem('addresses:v2:user:checkout-user-id')).toContain(
      'Số 12 đường chính, Phường A, Thành phố B',
    );
  });

  it('does not reuse the previous account address or phone for a new account', () => {
    fixture.destroy();
    window.localStorage.setItem('userId', 'new-user-id');
    window.localStorage.setItem('userEmail', 'previous@example.com');
    window.localStorage.setItem('userPhone', '0911111111');
    window.localStorage.setItem('userAddress', 'Địa chỉ tài khoản trước');
    window.localStorage.setItem('addresses_previous@example.com', JSON.stringify([{
      id: 'previous-address',
      name: 'Tài khoản trước',
      phone: '0911111111',
      detail: 'Số 99',
      ward: 'Phường cũ',
      province: 'Thành phố cũ',
      fullAddress: 'Số 99, Phường cũ, Thành phố cũ',
      isDefault: true,
    }]));
    window.localStorage.setItem('addresses_new@example.com', JSON.stringify([{
      id: 'legacy-address',
      name: 'Địa chỉ cũ',
      phone: '0922222222',
      detail: 'Địa chỉ cũ',
      ward: '',
      province: '',
      fullAddress: 'Địa chỉ cũ theo email',
      isDefault: true,
    }]));
    window.localStorage.setItem('addresses:user:new-user-id', JSON.stringify([{
      id: 'contaminated-address',
      name: 'Tài khoản trước',
      phone: '0898123206',
      detail: '1.2.18 hẻm số 1',
      ward: 'Linh Trung',
      province: 'Thủ Đức',
      fullAddress: '1.2.18 hẻm số 1, đường số 7',
      isDefault: true,
    }]));

    fixture = TestBed.createComponent(CheckOut);
    component = fixture.componentInstance;
    fixture.detectChanges();
    flushProvinces();
    flushCart();
    flushProfile({
      id: 'new-user-id',
      name: 'Tài khoản mới',
      email: 'new@example.com',
      phone: '',
      address: '',
    });
    http.expectOne('/api/user-vouchers/available-to-use').flush([]);

    expect(component.addresses).toEqual([]);
    expect(component.currentAddress).toBeNull();
    expect(component.phone).toBe('');
    expect(component.shippingAddress).toBe('');
    expect(window.localStorage.getItem('userPhone')).toBe('');
    expect(window.localStorage.getItem('userAddress')).toBe('');
    expect(window.localStorage.getItem('addresses:v2:user:new-user-id')).toBeNull();
    expect(window.localStorage.getItem('addresses:user:new-user-id')).toContain('0898123206');
    expect(window.localStorage.getItem('addresses_previous@example.com')).toContain('Số 99, Phường cũ, Thành phố cũ');
    expect(window.localStorage.getItem('addresses_new@example.com')).toContain('Địa chỉ cũ theo email');
  });

  describe('QR Checkout Integration (Stage 5)', () => {
    it('allows switching between COD and QR bank_transfer payment methods in the UI', () => {
      prepareSingleProductCheckout();

      const codRadio = fixture.nativeElement.querySelector('input[name="paymentMethod"][value="cod"]') as HTMLInputElement;
      const qrRadio = fixture.nativeElement.querySelector('input[name="paymentMethod"][value="bank_transfer"]') as HTMLInputElement;
      expect(codRadio).toBeTruthy();
      expect(qrRadio).toBeTruthy();
      expect(qrRadio.disabled).toBe(false);
      expect(component.paymentMethod).toBe('cod');

      qrRadio.click();
      fixture.detectChanges();
      expect(component.paymentMethod).toBe('bank_transfer');
      expect(fixture.nativeElement.querySelector('.btn-place-order')?.textContent).toContain('Đặt hàng & Tạo mã QR');

      codRadio.click();
      fixture.detectChanges();
      expect(component.paymentMethod).toBe('cod');
      expect(fixture.nativeElement.querySelector('.btn-place-order')?.textContent).toContain('Đặt hàng');
    });

    it('creates an order and then calls POST /api/orders/:id/payment to display accurate QR details and backend amountDue', () => {
      prepareSingleProductCheckout(100000, 1);
      component.paymentMethod = 'bank_transfer';
      component.placeOrder();

      const orderReq = http.expectOne('/api/orders');
      expect(orderReq.request.method).toBe('POST');
      expect(orderReq.request.body.payment).toEqual({
        method: 'bank_transfer',
        methodId: 'bank_transfer',
        status: 'Chờ thanh toán',
        statusId: 'awaiting_payment',
      });
      orderReq.flush({ id: 'order-qr-1' });

      const paymentReq = http.expectOne('/api/orders/order-qr-1/payment');
      expect(paymentReq.request.method).toBe('POST');
      expect(paymentReq.request.headers.get('Authorization')).toBe('Bearer checkout-token');
      // Return a backend snapshot amountDue (155000) different from frontend local calc (130000) to verify backend authority
      paymentReq.flush(samplePaymentPayload({ amountDue: 155000 }));
      fixture.detectChanges();

      expect(component.qrCheckoutActive).toBe(true);
      expect(component.orderSuccess).toBe(false);
      expect(component.paymentInfo?.paymentCode).toBe('URII1234567890ABCDEF');
      expect(component.paymentInfo?.amountDue).toBe(155000);
      expect(component.paymentInfo?.bankCode).toBe('970422');
      expect(component.paymentInfo?.accountNumber).toBe('0123456789');
      expect(component.paymentInfo?.accountName).toBe('URII OFFICIAL STORE');
      expect(component.pollingActive).toBe(true);

      const qrImg = fixture.nativeElement.querySelector('.qr-code-image') as HTMLImageElement;
      expect(qrImg).toBeTruthy();
      expect(qrImg.getAttribute('src')).toContain('https://img.vietqr.io/image/970422-0123456789-compact2.png');

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('MB Bank');
      expect(text).toContain('0123456789');
      expect(text).toContain('URII OFFICIAL STORE');
      expect(text).toContain('URII1234567890ABCDEF');
      expect(text).toContain('155.000');
      expect(text).toContain('Đang chờ thanh toán');
    });

    it('copies exact transfer content (paymentCode), account number, and backend amountDue to clipboard', async () => {
      prepareSingleProductCheckout();
      component.paymentMethod = 'bank_transfer';
      component.placeOrder();

      http.expectOne('/api/orders').flush({ id: 'order-qr-1' });
      http.expectOne('/api/orders/order-qr-1/payment').flush(samplePaymentPayload());
      fixture.detectChanges();

      const writeTextSpy = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextSpy },
        configurable: true,
      });
      const toastSpy = vi.spyOn(TestBed.inject(ToastService), 'show');

      const copyContentBtn = fixture.nativeElement.querySelector('.copy-content-btn') as HTMLButtonElement;
      const copyAccountBtn = fixture.nativeElement.querySelector('.copy-account-btn') as HTMLButtonElement;
      const copyAmountBtn = fixture.nativeElement.querySelector('.copy-amount-btn') as HTMLButtonElement;

      copyContentBtn.click();
      await fixture.whenStable();
      expect(writeTextSpy).toHaveBeenCalledWith('URII1234567890ABCDEF');
      expect(component.copiedField).toBe('paymentCode');
      expect(toastSpy).toHaveBeenCalledWith('Đã sao chép nội dung chuyển khoản.');

      copyAccountBtn.click();
      await fixture.whenStable();
      expect(writeTextSpy).toHaveBeenCalledWith('0123456789');
      expect(component.copiedField).toBe('accountNumber');

      copyAmountBtn.click();
      await fixture.whenStable();
      expect(writeTextSpy).toHaveBeenCalledWith('130000');
      expect(component.copiedField).toBe('amountDue');
    });

    it('polls GET /api/orders/:id/payment and transitions to paid state while stopping polling', () => {
      vi.useFakeTimers();
      prepareSingleProductCheckout();
      component.paymentMethod = 'bank_transfer';
      component.placeOrder();

      http.expectOne('/api/orders').flush({ id: 'order-qr-1' });
      http.expectOne('/api/orders/order-qr-1/payment').flush(samplePaymentPayload());
      fixture.detectChanges();
      expect(component.pollingActive).toBe(true);

      // First poll tick -> still awaiting_payment
      vi.advanceTimersByTime(component.pollIntervalMs);
      const pollReq1 = http.expectOne('/api/orders/order-qr-1/payment');
      expect(pollReq1.request.method).toBe('GET');
      pollReq1.flush(samplePaymentPayload({ qrCodeUrl: undefined }));
      fixture.detectChanges();
      expect(component.pollingActive).toBe(true);
      // Keeps cached qrCodeUrl while awaiting_payment
      expect(component.paymentInfo?.qrCodeUrl).toContain('img.vietqr.io');

      // Second poll tick -> paid
      vi.advanceTimersByTime(component.pollIntervalMs);
      const pollReq2 = http.expectOne('/api/orders/order-qr-1/payment');
      pollReq2.flush(samplePaymentPayload({
        statusId: 'paid',
        paidAt: '2026-11-09T12:00:00.000Z',
        isPayable: false,
        qrCodeUrl: undefined,
      }));
      fixture.detectChanges();

      expect(component.paymentInfo?.statusId).toBe('paid');
      expect(component.pollingActive).toBe(false);
      expect(fixture.nativeElement.textContent).toContain('Thanh toán chuyển khoản thành công!');
      expect(fixture.nativeElement.textContent).toContain('Đơn hàng đang chờ cửa hàng xác nhận');
      expect(window.localStorage.getItem('activeQrPayment:v1:user:checkout-user-id')).toBeNull();

      // Verify no more polling happens after paid
      vi.advanceTimersByTime(component.pollIntervalMs * 3);
      http.expectNone('/api/orders/order-qr-1/payment');
    });

    it('stops polling when status becomes expired and allows manual QR recreation without auto-looping', () => {
      vi.useFakeTimers();
      prepareSingleProductCheckout();
      component.paymentMethod = 'bank_transfer';
      component.placeOrder();

      http.expectOne('/api/orders').flush({ id: 'order-qr-1' });
      http.expectOne('/api/orders/order-qr-1/payment').flush(samplePaymentPayload());
      fixture.detectChanges();

      vi.advanceTimersByTime(component.pollIntervalMs);
      const pollReq = http.expectOne('/api/orders/order-qr-1/payment');
      pollReq.flush(samplePaymentPayload({
        statusId: 'expired',
        isExpired: true,
        isPayable: false,
        qrCodeUrl: undefined,
      }));
      fixture.detectChanges();

      expect(component.paymentInfo?.statusId).toBe('expired');
      expect(component.pollingActive).toBe(false);
      expect(fixture.nativeElement.textContent).toContain('Mã QR thanh toán đã hết hạn');

      // Ensure it does NOT auto-create a new QR or keep polling
      vi.advanceTimersByTime(component.pollIntervalMs * 3);
      http.expectNone('/api/orders/order-qr-1/payment');

      // User clicks "Tạo lại mã QR mới"
      const recreateBtn = fixture.nativeElement.querySelector('.qr-recreate-btn') as HTMLButtonElement;
      expect(recreateBtn).toBeTruthy();
      recreateBtn.click();

      const recreateReq = http.expectOne('/api/orders/order-qr-1/payment');
      expect(recreateReq.request.method).toBe('POST');
      recreateReq.flush(samplePaymentPayload({
        id: 'pay-2',
        paymentCode: 'URII9999999999ABCDEF',
        statusId: 'awaiting_payment',
        isExpired: false,
        isPayable: true,
        qrCodeUrl: 'https://img.vietqr.io/image/970422-0123456789-compact2.png?amount=130000&addInfo=URII9999999999ABCDEF&accountName=URII+OFFICIAL+STORE',
      }));
      fixture.detectChanges();

      expect(component.paymentInfo?.paymentCode).toBe('URII9999999999ABCDEF');
      expect(component.paymentInfo?.statusId).toBe('awaiting_payment');
      expect(component.pollingActive).toBe(true);
    });

    it('stops polling and shows cancelled notice when Payment status is cancelled', () => {
      vi.useFakeTimers();
      prepareSingleProductCheckout();
      component.paymentMethod = 'bank_transfer';
      component.placeOrder();

      http.expectOne('/api/orders').flush({ id: 'order-qr-1' });
      http.expectOne('/api/orders/order-qr-1/payment').flush(samplePaymentPayload());
      fixture.detectChanges();

      vi.advanceTimersByTime(component.pollIntervalMs);
      const pollReq = http.expectOne('/api/orders/order-qr-1/payment');
      pollReq.flush(samplePaymentPayload({
        statusId: 'cancelled',
        isPayable: false,
        qrCodeUrl: undefined,
      }));
      fixture.detectChanges();

      expect(component.paymentInfo?.statusId).toBe('cancelled');
      expect(component.pollingActive).toBe(false);
      expect(fixture.nativeElement.textContent).toContain('Giao dịch thanh toán đã bị hủy');
      expect(window.localStorage.getItem('activeQrPayment:v1:user:checkout-user-id')).toBeNull();

      vi.advanceTimersByTime(component.pollIntervalMs * 2);
      http.expectNone('/api/orders/order-qr-1/payment');
    });

    it('handles Payment creation API errors (e.g. 503/409) gracefully and retries without creating a duplicate Order', () => {
      prepareSingleProductCheckout();
      component.paymentMethod = 'bank_transfer';
      component.placeOrder();

      http.expectOne('/api/orders').flush({ id: 'order-qr-err' });
      const failPaymentReq = http.expectOne('/api/orders/order-qr-err/payment');
      failPaymentReq.flush(
        { message: 'Thiếu cấu hình SEPAY_BANK_CODE' },
        { status: 503, statusText: 'Service Unavailable' },
      );
      fixture.detectChanges();

      expect(component.qrCheckoutActive).toBe(true);
      expect(component.qrPaymentCreateFailed).toBe(true);
      expect(component.paymentError).toContain('Thiếu cấu hình SEPAY_BANK_CODE');
      expect(fixture.nativeElement.textContent).toContain('Không thể tải thông tin thanh toán QR');

      // Retry should call POST /api/orders/order-qr-err/payment directly WITHOUT calling POST /api/orders again
      const retryBtn = fixture.nativeElement.querySelector('.qr-retry-create-btn') as HTMLButtonElement;
      retryBtn.click();
      http.expectNone('/api/orders');

      const retryReq = http.expectOne('/api/orders/order-qr-err/payment');
      expect(retryReq.request.method).toBe('POST');
      retryReq.flush(samplePaymentPayload({ orderId: 'order-qr-err' }));
      fixture.detectChanges();

      expect(component.qrPaymentCreateFailed).toBe(false);
      expect(component.paymentInfo?.orderId).toBe('order-qr-err');
      expect(component.pollingActive).toBe(true);
    });

    it('restores active QR Payment from backend on page refresh and never trusts status from localStorage', () => {
      fixture.destroy();
      window.localStorage.setItem(
        'activeQrPayment:v1:user:checkout-user-id',
        JSON.stringify({
          orderId: 'order-restored-1',
          orderNumber: 'order-restored-1',
          paymentCode: 'URII1234567890ABCDEF',
          qrCodeUrl: 'https://img.vietqr.io/image/970422-0123456789-compact2.png?amount=130000&addInfo=URII1234567890ABCDEF&accountName=URII+OFFICIAL+STORE',
          bankCode: '970422',
          bankName: 'MB Bank (Ngân hàng Quân Đội) (970422)',
          accountNumber: '0123456789',
          accountName: 'URII OFFICIAL STORE',
          // Even if someone tampers with localStorage adding statusId: 'paid', component must query backend!
          statusId: 'paid',
        }),
      );

      fixture = TestBed.createComponent(CheckOut);
      component = fixture.componentInstance;
      fixture.detectChanges();
      flushCart();
      flushProvinces();
      flushProfile();
      http.expectOne('/api/user-vouchers/available-to-use').flush([]);

      // Must call GET /api/orders/order-restored-1/payment to get authoritative state
      const restoreReq = http.expectOne('/api/orders/order-restored-1/payment');
      expect(restoreReq.request.method).toBe('GET');
      restoreReq.flush(samplePaymentPayload({
        orderId: 'order-restored-1',
        statusId: 'awaiting_payment',
        qrCodeUrl: undefined,
      }));
      fixture.detectChanges();

      expect(component.qrCheckoutActive).toBe(true);
      expect(component.paymentInfo?.orderId).toBe('order-restored-1');
      expect(component.paymentInfo?.statusId).toBe('awaiting_payment');
      expect(component.paymentInfo?.qrCodeUrl).toContain('img.vietqr.io');
      expect(component.pollingActive).toBe(true);
    });

    it('handles network disconnection (status 0) during polling and allows manual status check recovery', () => {
      vi.useFakeTimers();
      prepareSingleProductCheckout();
      component.paymentMethod = 'bank_transfer';
      component.placeOrder();

      http.expectOne('/api/orders').flush({ id: 'order-qr-1' });
      http.expectOne('/api/orders/order-qr-1/payment').flush(samplePaymentPayload());
      fixture.detectChanges();

      vi.advanceTimersByTime(component.pollIntervalMs);
      const pollReq = http.expectOne('/api/orders/order-qr-1/payment');
      pollReq.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
      fixture.detectChanges();

      expect(component.pollingError).toContain('Mất kết nối mạng');
      expect(fixture.nativeElement.textContent).toContain('Mất kết nối mạng');
      // QR info remains visible so user is not kicked off the screen
      expect(component.paymentInfo?.paymentCode).toBe('URII1234567890ABCDEF');

      // Manual check button recovers when connection returns
      const checkBtn = fixture.nativeElement.querySelector('.check-payment-status-btn') as HTMLButtonElement;
      checkBtn.click();

      const manualReq = http.expectOne('/api/orders/order-qr-1/payment');
      manualReq.flush(samplePaymentPayload({
        statusId: 'paid',
        paidAt: '2026-11-09T12:05:00.000Z',
        isPayable: false,
      }));
      fixture.detectChanges();

      expect(component.pollingError).toBe('');
      expect(component.paymentInfo?.statusId).toBe('paid');
      expect(component.pollingActive).toBe(false);
    });

    it('never creates duplicate polling intervals or overlapping poll requests', () => {
      vi.useFakeTimers();
      prepareSingleProductCheckout();
      component.paymentMethod = 'bank_transfer';
      component.placeOrder();

      http.expectOne('/api/orders').flush({ id: 'order-qr-1' });
      http.expectOne('/api/orders/order-qr-1/payment').flush(samplePaymentPayload());
      fixture.detectChanges();

      // Call startPaymentPolling multiple times
      component.startPaymentPolling('order-qr-1');
      component.startPaymentPolling('order-qr-1');
      component.startPaymentPolling('order-qr-1');

      // Advance one interval: only ONE request should be fired
      vi.advanceTimersByTime(component.pollIntervalMs);
      const pendingReqs = http.match('/api/orders/order-qr-1/payment');
      expect(pendingReqs).toHaveLength(1);

      // Advance another interval while first request is still in-flight: no second overlapping request should fire
      vi.advanceTimersByTime(component.pollIntervalMs);
      http.expectNone('/api/orders/order-qr-1/payment');

      pendingReqs[0].flush(samplePaymentPayload());
    });

    it('passes variantName and variantIndex to POST /api/orders for multi-variant products', () => {
      TestBed.inject(CheckoutSelectionService).set(
        [{ productId: 'p-var', variant: 'Size M', quantity: 2 }],
        false,
      );
      component.loadCheckout();
      http.expectOne('/api/products').flush([
        {
          id: 'p-var',
          name: 'Áo khoác Urii',
          price: 150000,
          stock: 10,
          variants: [
            { name: 'Size S', price: 150000, stock: 4 },
            { name: 'Size M', price: 165000, stock: 6 },
          ],
        },
      ]);
      selectCheckoutAddress();
      component.paymentMethod = 'bank_transfer';
      component.placeOrder();

      const orderReq = http.expectOne('/api/orders');
      expect(orderReq.request.body.items).toEqual([
        {
          productId: 'p-var',
          name: 'Áo khoác Urii',
          price: 165000,
          quantity: 2,
          image: '',
          variantName: 'Size M',
          variantIndex: 1,
        },
      ]);
      orderReq.flush({ id: 'order-var-1' });
      http.expectOne('/api/orders/order-var-1/payment').flush(samplePaymentPayload({
        orderId: 'order-var-1',
        amountDue: 330000,
      }));
      fixture.detectChanges();

      expect(component.paymentInfo?.amountDue).toBe(330000);
    });

    it('stops polling and clears session when returning/refreshing Checkout after backend already marked Payment paid', () => {
      fixture.destroy();
      window.localStorage.setItem(
        'activeQrPayment:v1:user:checkout-user-id',
        JSON.stringify({
          orderId: 'order-already-paid',
          orderNumber: 'order-already-paid',
          paymentCode: 'URII1234567890ABCDEF',
          qrCodeUrl: 'https://img.vietqr.io/image/970422-0123456789-compact2.png?amount=130000&addInfo=URII1234567890ABCDEF&accountName=URII+OFFICIAL+STORE',
          bankCode: '970422',
          bankName: 'MB Bank',
          accountNumber: '0123456789',
          accountName: 'URII OFFICIAL STORE',
        }),
      );

      fixture = TestBed.createComponent(CheckOut);
      component = fixture.componentInstance;
      fixture.detectChanges();
      flushCart();
      flushProvinces();
      flushProfile();
      http.expectOne('/api/user-vouchers/available-to-use').flush([]);

      const restoreReq = http.expectOne('/api/orders/order-already-paid/payment');
      restoreReq.flush(samplePaymentPayload({
        orderId: 'order-already-paid',
        statusId: 'paid',
        paidAt: '2026-11-09T12:10:00.000Z',
        isPayable: false,
        qrCodeUrl: undefined,
      }));
      fixture.detectChanges();

      expect(component.qrCheckoutActive).toBe(true);
      expect(component.paymentInfo?.statusId).toBe('paid');
      expect(component.pollingActive).toBe(false);
      expect(window.localStorage.getItem('activeQrPayment:v1:user:checkout-user-id')).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Thanh toán chuyển khoản thành công!');
    });
  });
});
