import { ComponentFixture, TestBed } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import localeVi from '@angular/common/locales/vi';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { CartService } from '../../core/services/cart.service';
import { CheckoutSelectionService } from '../../core/services/checkout-selection.service';
import { CheckoutVoucher } from '../../core/services/checkout.service';
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

  afterEach(() => {
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

    const closeButton = fixture.nativeElement.querySelector('.checkout-login-close') as HTMLButtonElement;
    expect(closeButton.getAttribute('aria-label')).toBe('Quay lại giỏ hàng');
    closeButton.click();
    expect(navigateSpy).toHaveBeenCalledWith(['/cart']);

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

    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const closeButton = fixture.nativeElement.querySelector('.checkout-login-close') as HTMLButtonElement;
    closeButton.click();
    expect(navigateSpy).toHaveBeenCalledWith(['/cart']);
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

  it('creates new orders in the pending approval state', () => {
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
    expect(request.request.body.note).toBe('Gọi trước khi giao.');
    expect(request.request.body.voucher).toEqual({ voucherId: 'voucher-1', discountAmount: 10000 });
    request.flush({ id: 'order-1' });
    http.expectOne('/api/cart/items/cart-p-1').flush({ items: [] });

    expect(component.orderSuccess).toBe(true);
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
});
