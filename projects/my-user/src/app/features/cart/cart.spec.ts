import { ComponentFixture, TestBed } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import { HttpTestingController } from '@angular/common/http/testing';
import localeVi from '@angular/common/locales/vi';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CartService } from '../../core/services/cart.service';
import { Cart } from './cart';

registerLocaleData(localeVi, 'vi-VN');

describe('Cart', () => {
  let component: Cart;
  let fixture: ComponentFixture<Cart>;
  let http: HttpTestingController;

  beforeEach(async () => {
    window.localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Cart],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Cart);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
    window.localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('stores guest items and merges matching product variants', () => {
    const cart = TestBed.inject(CartService);
    cart.addItem({ productId: 'p-1', variant: 'Small', quantity: 1 });
    cart.addItem({ productId: 'p-1', variant: 'Small', quantity: 2 });
    cart.addItem({ productId: 'p-1', variant: 'Large', quantity: 1 });

    expect(cart.getItems()).toEqual([
      { productId: 'p-1', variant: 'Small', quantity: 3 },
      { productId: 'p-1', variant: 'Large', quantity: 1 },
    ]);
  });

  it('keeps logged-in carts under the user id', () => {
    window.localStorage.setItem('isLoggedIn', 'true');
    window.localStorage.setItem('userId', 'user-42');

    TestBed.inject(CartService).addItem({ productId: 'p-2', variant: null, quantity: 1 });

    expect(window.localStorage.getItem('cartItems:user:user-42')).toContain('"productId":"p-2"');
    expect(window.localStorage.getItem('cartItems:guest')).toBeNull();
  });

  it('keeps cart items visible and uses cached product details when the API is unavailable', () => {
    const cart = TestBed.inject(CartService);
    cart.addItem({ productId: 'p-3', variant: 'Blue', quantity: 2 });
    window.localStorage.setItem('products', JSON.stringify([{
      id: 'p-3',
      name: 'Sản phẩm đã lưu',
      image: 'cached-image.jpg',
      originalPrice: 45000,
      variants: [{ name: 'Blue', price: 50000, stock: 5 }],
    }]));

    component.loadCart();
    http.expectOne('/api/products').flush('Server unavailable', {
      status: 503,
      statusText: 'Service Unavailable',
    });

    expect(component.lines).toHaveLength(1);
    expect(component.lines[0].product?.name).toBe('Sản phẩm đã lưu');
    expect(component.lines[0].item.quantity).toBe(2);
    expect(component.errorMessage).toContain('Máy chủ đang gián đoạn');
    expect(cart.getItems()).toHaveLength(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sản phẩm đã lưu');
  });

  it('does not render a non-empty cart as empty when product details cannot be loaded', () => {
    TestBed.inject(CartService).addItem({ productId: 'missing-product', variant: null, quantity: 1 });

    component.loadCart();
    http.expectOne('/api/products').flush('Server unavailable', {
      status: 503,
      statusText: 'Service Unavailable',
    });
    fixture.detectChanges();

    expect(component.lines).toHaveLength(1);
    expect(fixture.nativeElement.textContent).not.toContain('Giỏ hàng đang trống');
    expect(fixture.nativeElement.textContent).toContain('Chưa tải được thông tin sản phẩm');
  });

  it('allows changing a cart item variant and updates its price and saved selection', () => {
    const cart = TestBed.inject(CartService);
    cart.addItem({ productId: 'p-4', variant: 'Small', quantity: 1 });
    component.loadCart();
    http.expectOne('/api/products').flush([{
      id: 'p-4',
      name: 'Sản phẩm nhiều phân loại',
      price: 100000,
      variants: [
        { name: 'Small', price: 90000, stock: 5 },
        { name: 'Large', price: 120000, stock: 2 },
      ],
    }]);
    fixture.detectChanges();

    const selector = fixture.nativeElement.querySelector('.variant-selector') as HTMLSelectElement;
    selector.value = 'Large';
    selector.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(cart.getItems()).toEqual([
      { productId: 'p-4', variant: 'Large', quantity: 1 },
    ]);
    expect(component.lines[0].item.variant).toBe('Large');
    expect(component.unitPrice(component.lines[0])).toBe(120000);
  });

  it('merges quantities when changing to a variant already in the cart', () => {
    const cart = TestBed.inject(CartService);
    cart.addItem({ productId: 'p-5', variant: 'Small', quantity: 1 });
    cart.addItem({ productId: 'p-5', variant: 'Large', quantity: 2 });
    component.loadCart();
    http.expectOne('/api/products').flush([{
      id: 'p-5',
      name: 'Sản phẩm nhiều phân loại',
      price: 100000,
      variants: [
        { name: 'Small', price: 90000, stock: 5 },
        { name: 'Large', price: 120000, stock: 5 },
      ],
    }]);
    fixture.detectChanges();

    const smallLine = component.lines.find((line) => line.item.variant === 'Small');
    expect(smallLine).toBeDefined();
    const selectors = fixture.nativeElement.querySelectorAll('.variant-selector') as NodeListOf<HTMLSelectElement>;
    const selector = selectors[component.lines.indexOf(smallLine!)];
    selector.value = 'Large';
    selector.dispatchEvent(new Event('change'));

    expect(component.lines).toHaveLength(1);
    expect(component.lines[0].item).toEqual({ productId: 'p-5', variant: 'Large', quantity: 3 });
    expect(cart.getItems()).toEqual([
      { productId: 'p-5', variant: 'Large', quantity: 3 },
    ]);
  });
});
