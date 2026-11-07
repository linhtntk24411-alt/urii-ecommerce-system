import { ComponentFixture, TestBed } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import localeVi from '@angular/common/locales/vi';
import { provideRouter } from '@angular/router';
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
    await TestBed.configureTestingModule({
      imports: [CheckOut],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(CheckOut);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    flushProvinces();
    http.expectOne('/api/vouchers?limit=100').flush([]);
    await fixture.whenStable();
  });

  function flushProvinces(): void {
    http.expectOne('https://provinces.open-api.vn/api/v2/p/').flush([
      { code: 1, name: 'Thành phố mẫu' },
    ]);
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

  it('applies a voucher returned by the public vouchers API', () => {
    const cart = TestBed.inject(CartService);
    cart.addItem({ productId: 'p-1', variant: null, quantity: 2 });
    fixture.destroy();
    fixture = TestBed.createComponent(CheckOut);
    component = fixture.componentInstance;
    fixture.detectChanges();
    flushProvinces();

    http.expectOne('/api/products').flush([
      { id: 'p-1', name: 'Sản phẩm', price: 100000, stock: 5, variants: [] },
    ]);
    http.expectOne('/api/vouchers?limit=100').flush([
      {
        id: 'voucher-1',
        code: 'SAVE10',
        name: 'Giảm 10%',
        type: 'percent',
        discountValue: 10,
        minOrder: 0,
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
    component.loadCheckout();
    http.expectOne('/api/products').flush([
      { id: 'p-1', name: 'Sản phẩm', price: 100000, stock: 5, variants: [] },
    ]);
    fixture.detectChanges();
    component.vouchers = [
      {
        id: 'voucher-eligible',
        code: 'SAVE10',
        name: 'Giảm 10%',
        type: 'percent',
        discountValue: 10,
        minOrder: 0,
      },
      {
        id: 'voucher-ineligible',
        code: 'SAVE20',
        name: 'Giảm 20%',
        type: 'percent',
        discountValue: 20,
        minOrder: 150000,
      },
    ] satisfies CheckoutVoucher[];

    const input = fixture.nativeElement.querySelector('#voucherCode') as HTMLInputElement;
    input.click();
    fixture.detectChanges();

    expect(component.voucherDropdownOpen).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('SAVE10');
    expect(fixture.nativeElement.textContent).toContain('Đơn tối thiểu 150.000');
    const eligibleOption = fixture.nativeElement.querySelector('.voucher-option') as HTMLButtonElement;
    expect(eligibleOption.disabled).toBe(false);
    eligibleOption.click();
    fixture.detectChanges();

    expect(component.appliedVoucher?.code).toBe('SAVE10');
    expect(component.voucherDropdownOpen).toBe(false);
    expect(component.itemDiscount).toBe(10000);
  });

  it('closes the voucher list when toggled, clicking outside, or pressing Escape', () => {
    TestBed.inject(CartService).addItem({ productId: 'p-1', variant: null, quantity: 1 });
    component.loadCheckout();
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
    fixture.destroy();
    fixture = TestBed.createComponent(CheckOut);
    component = fixture.componentInstance;
    fixture.detectChanges();
    flushProvinces();

    http.expectOne('/api/products').flush([
      { id: 'p-1', name: 'Sản phẩm', price: 100000, stock: 5, variants: [] },
    ]);
    http.expectOne('/api/vouchers?limit=100').flush([]);

    selectCheckoutAddress();
    component.placeOrder();

    const request = http.expectOne('/api/orders');
    expect(request.request.body.status).toBe('Đang chờ duyệt');
    expect(request.request.body.statusType).toBe('pending');
    request.flush({ id: 'order-1' });

    expect(component.orderSuccess).toBe(true);
    expect(component.orderNumber).toBe('order-1');
  });

  it('does not remove existing cart items after a successful buy-now checkout', () => {
    const cart = TestBed.inject(CartService);
    cart.addItem({ productId: 'p-1', variant: null, quantity: 3 });
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

    expect(cart.getItems()).toEqual([
      { productId: 'p-1', variant: null, quantity: 3 },
    ]);
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
    expect(window.localStorage.getItem('addresses_anonymous')).toContain('Nguyễn An');
  });

  it('uses the user profile address as the default ahead of saved delivery addresses', () => {
    window.localStorage.setItem('userEmail', 'customer@example.com');
    window.localStorage.setItem('userName', 'Nguyễn An');
    window.localStorage.setItem('userPhone', '0901234567');
    window.localStorage.setItem('userAddress', 'Số 12 đường chính, Phường A, Thành phố B');
    window.localStorage.setItem('addresses_customer@example.com', JSON.stringify([{
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
});
