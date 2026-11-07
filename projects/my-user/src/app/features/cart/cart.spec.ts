import { ComponentFixture, TestBed } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import { HttpTestingController } from '@angular/common/http/testing';
import localeVi from '@angular/common/locales/vi';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { CartItem, CartService } from '../../core/services/cart.service';
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

  it('loads the account cart from the API and caches server item identifiers', () => {
    window.localStorage.setItem('isLoggedIn', 'true');
    window.localStorage.setItem('userId', 'user-46');
    window.localStorage.setItem('authToken', 'account-token');
    const cart = TestBed.inject(CartService);
    let loaded: CartItem[] = [];

    cart.loadItems().subscribe((items) => loaded = items);

    const request = http.expectOne('/api/cart');
    expect(request.request.headers.get('Authorization')).toMatch(/^Bearer .+/);
    request.flush({ items: [{
      itemId: 'server-item-1',
      productId: 'p-12',
      variantName: 'Blue',
      variantIndex: 1,
      quantity: 3,
      selected: false,
    }] });

    expect(loaded).toEqual([{
      itemId: 'server-item-1',
      productId: 'p-12',
      variant: 'Blue',
      variantIndex: 1,
      quantity: 3,
      selected: false,
    }]);
    expect(cart.getItems()).toEqual(loaded);
  });

  it('removes several purchased items from the server sequentially', () => {
    window.localStorage.setItem('isLoggedIn', 'true');
    window.localStorage.setItem('userId', 'user-46');
    window.localStorage.setItem('authToken', 'account-token');
    const purchased = [
      { itemId: 'server-item-1', productId: 'p-1', variant: null, quantity: 1 },
      { itemId: 'server-item-2', productId: 'p-2', variant: null, quantity: 1 },
    ];
    window.localStorage.setItem('cartItems:user:user-46', JSON.stringify(purchased));
    const cart = TestBed.inject(CartService);

    cart.removePurchasedItems(purchased);

    http.expectOne('/api/cart/items/server-item-1').flush({
      items: [{
        itemId: 'server-item-2',
        productId: 'p-2',
        variantName: null,
        variantIndex: null,
        quantity: 1,
        selected: true,
      }],
    });
    http.expectOne('/api/cart/items/server-item-2').flush({ items: [] });

    expect(cart.getItems()).toEqual([]);
  });

  it('restores a cached account cart when the server cart is empty', () => {
    window.localStorage.setItem('isLoggedIn', 'true');
    window.localStorage.setItem('userId', 'user-46');
    window.localStorage.setItem('authToken', 'account-token');
    window.localStorage.setItem('cartItems:migrated:user-46', 'true');
    window.localStorage.setItem('cartItems:user:user-46', JSON.stringify([
      { productId: 'p-12', variant: 'Blue', quantity: 3 },
    ]));
    const cart = TestBed.inject(CartService);
    let loaded: CartItem[] = [];

    cart.loadItems().subscribe((items) => loaded = items);

    http.expectOne('/api/cart').flush({ items: [] });
    const upload = http.expectOne('/api/cart/items');
    expect(upload.request.body).toEqual({
      productId: 'p-12',
      variantName: 'Blue',
      quantity: 3,
    });
    upload.flush({ items: [{
      itemId: 'server-item-12',
      productId: 'p-12',
      variantName: 'Blue',
      variantIndex: 0,
      quantity: 3,
      selected: true,
    }] });

    expect(loaded[0].itemId).toBe('server-item-12');
    expect(cart.getItems()).toEqual(loaded);
  });

  it('shows the server reason for cart authorization failures and preserves cached items', () => {
    window.localStorage.setItem('isLoggedIn', 'true');
    window.localStorage.setItem('userId', 'user-46');
    window.localStorage.setItem('authToken', 'expired-token');
    window.localStorage.setItem('cartItems:user:user-46', JSON.stringify([
      { productId: 'p-12', variant: 'Blue', quantity: 2 },
    ]));

    component.loadCart();
    http.expectOne('/api/cart').flush(
      { message: 'Tài khoản khách hàng không còn tồn tại.' },
      { status: 401, statusText: 'Unauthorized' },
    );
    http.expectOne('/api/products').flush([
      { id: 'p-12', name: 'Sản phẩm đã lưu', price: 120000, stock: 5, variants: [] },
    ]);

    expect(component.requiresLogin).toBe(true);
    expect(component.lines).toHaveLength(1);
    expect(component.errorMessage).toContain('Máy chủ từ chối truy cập giỏ hàng');
    expect(component.errorMessage).toContain('Tài khoản khách hàng không còn tồn tại.');
    expect(TestBed.inject(CartService).getItems()).toEqual([
      { productId: 'p-12', variant: 'Blue', quantity: 2 },
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Đăng nhập lại');

    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (fixture.nativeElement.querySelector('.retry-cart-button') as HTMLButtonElement).click();
    expect(navigateSpy).toHaveBeenCalledWith(
      ['/login'],
      { queryParams: { returnUrl: '/cart' } },
    );
  });

  it('moves a guest cart to the new user id and merges matching items', () => {
    const cart = TestBed.inject(CartService);
    cart.addItem({ productId: 'p-6', variant: 'Small', quantity: 2 });
    window.localStorage.setItem('cartItems:user:user-43', JSON.stringify([
      { productId: 'p-6', variant: 'Small', quantity: 1 },
      { productId: 'p-7', variant: null, quantity: 1 },
    ]));

    cart.moveGuestCartToUser('user-43');
    window.localStorage.setItem('isLoggedIn', 'true');
    window.localStorage.setItem('userId', 'user-43');

    expect(cart.getItems()).toEqual([
      { productId: 'p-6', variant: 'Small', quantity: 3 },
      { productId: 'p-7', variant: null, quantity: 1 },
    ]);
    expect(window.localStorage.getItem('cartItems:guest')).toBeNull();
  });

  it('sends a registered guest cart to MongoDB after the new account logs in', () => {
    const cart = TestBed.inject(CartService);
    cart.addItem({ productId: 'p-13', variant: 'Red', quantity: 2 });
    cart.moveGuestCartToUser('user-47');
    window.localStorage.setItem('isLoggedIn', 'true');
    window.localStorage.setItem('userId', 'user-47');
    window.localStorage.setItem('authToken', 'new-user-token');

    let loaded: CartItem[] = [];
    cart.loadItems().subscribe((items) => loaded = items);

    http.expectOne('/api/cart').flush({ items: [] });

    const request = http.expectOne('/api/cart/items');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      productId: 'p-13',
      variantName: 'Red',
      quantity: 2,
    });
    request.flush({ items: [{
      itemId: 'server-item-13',
      productId: 'p-13',
      variantName: 'Red',
      variantIndex: 0,
      quantity: 2,
      selected: true,
    }] });

    expect(window.localStorage.getItem('cartItems:pending:user-47')).toBeNull();
    expect(cart.getItems()[0].itemId).toBe('server-item-13');
    expect(loaded[0].itemId).toBe('server-item-13');
  });

  it('hides the user cart while logged out and restores it for the same account', () => {
    const cart = TestBed.inject(CartService);
    window.localStorage.setItem('cartItems:guest', JSON.stringify([
      { productId: 'p-8', variant: null, quantity: 1 },
    ]));
    window.localStorage.setItem('cartItems:user:user-44', JSON.stringify([
      { productId: 'p-9', variant: null, quantity: 2 },
    ]));

    window.localStorage.setItem('isLoggedIn', 'true');
    window.localStorage.setItem('userId', 'user-44');
    expect(cart.getItems()).toEqual([
      { productId: 'p-9', variant: null, quantity: 2 },
    ]);

    window.localStorage.removeItem('isLoggedIn');
    window.localStorage.removeItem('userId');
    expect(cart.getItems()).toEqual([
      { productId: 'p-8', variant: null, quantity: 1 },
    ]);

    window.localStorage.setItem('isLoggedIn', 'true');
    window.localStorage.setItem('userId', 'user-44');
    expect(cart.getItems()).toEqual([
      { productId: 'p-9', variant: null, quantity: 2 },
    ]);
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
