import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { HeaderComponent } from './header.component';

describe('HeaderComponent', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;
  let httpTestingController: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    localStorage.clear();
    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
    httpTestingController = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    httpTestingController.verify();
    localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('updates the header when the auth state changes in the same tab', () => {
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('userName', 'Test User');
    localStorage.setItem('userEmail', 'test@example.com');
    window.dispatchEvent(new Event('auth:changed'));
    fixture.detectChanges();

    expect(component.isLoggedIn).toBe(true);
    expect(fixture.nativeElement.querySelector('.account-icon-wrapper')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.auth-buttons')).toBeNull();
    expect(fixture.nativeElement.querySelector('.account-menu a[routerLink="/my-blogs"]')?.textContent)
      .toContain('Bài viết của tôi');
  });

  it('loads the signed-in user profile from the API and updates the avatar', () => {
    localStorage.setItem('authToken', 'test-jwt-token');
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('userId', 'user-id');
    window.dispatchEvent(new Event('auth:changed'));

    const request = httpTestingController.expectOne('/api/auth/me');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer test-jwt-token');
    request.flush({
      id: 'user-id',
      name: 'Updated User',
      email: 'updated@example.com',
      avatar: '/images/avatar-user.jpg',
    });
    httpTestingController.expectOne('/api/cart').flush({ items: [] });
    httpTestingController.expectOne('/api/notifications/mine?page=1&limit=50').flush({
      notifications: [],
      unreadCount: 0,
    });
    fixture.detectChanges();

    expect(component.userName).toBe('Updated User');
    expect(component.userEmail).toBe('updated@example.com');
    expect(component.userAvatar).toBe('/api/images/avatar-user.jpg');
    expect(localStorage.getItem('userAvatar')).toBe('/api/images/avatar-user.jpg');
  });

  it('restores the saved login state after the initial browser render', async () => {
    fixture.destroy();
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('userName', 'Test User');
    localStorage.setItem('userEmail', 'test@example.com');
    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
    expect(component.authStatusReady).toBe(false);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.isLoggedIn).toBe(true);
    expect(fixture.nativeElement.querySelector('.account-icon-wrapper')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.auth-buttons')).toBeNull();
  });

  it('removes the auth token on logout while preserving the cart for the next login', () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('authToken', 'test-jwt-token');
    localStorage.setItem('userId', 'user-45');
    localStorage.setItem('cartItems:user:user-45', JSON.stringify([
      { productId: 'p-10', variant: null, quantity: 2 },
    ]));
    component.cartCount = 2;

    component.confirmLogout();

    expect(localStorage.getItem('authToken')).toBeNull();
    expect(localStorage.getItem('isLoggedIn')).toBeNull();
    expect(localStorage.getItem('userId')).toBeNull();
    expect(localStorage.getItem('cartItems:user:user-45')).toContain('"productId":"p-10"');
    expect(component.cartCount).toBe(0);

    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('userId', 'user-45');
    component.updateCartBadge();

    expect(component.cartCount).toBe(2);
  });

  it('opens the account menu and logout confirmation with clicks', () => {
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('userName', 'Test User');
    window.dispatchEvent(new Event('auth:changed'));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.account-circle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.isAccountMenuOpen).toBe(true);

    (fixture.nativeElement.querySelector('.btn-logout') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.isLogoutModalOpen).toBe(true);
    expect(fixture.nativeElement.querySelector('.modal.active')).not.toBeNull();

    localStorage.setItem('authToken', 'test-jwt-token');
    (fixture.nativeElement.querySelector('.modal-btn--danger') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(localStorage.getItem('authToken')).toBeNull();
    expect(localStorage.getItem('isLoggedIn')).toBeNull();
    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });

  it('displays user profile header, quick stats and my-vouchers link in avatar dropdown', () => {
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('userName', 'Nguyen Minh Anh');
    localStorage.setItem('userEmail', 'minhanh@example.com');
    window.dispatchEvent(new Event('auth:changed'));
    fixture.detectChanges();

    localStorage.setItem('authToken', 'test-jwt-token');
    (fixture.nativeElement.querySelector('.account-circle') as HTMLButtonElement).click();
    fixture.detectChanges();

    const voucherReq = httpTestingController.expectOne('/api/user-vouchers/mine');
    voucherReq.flush([
      { voucherId: 'FREESHIP', isUsed: false },
      { voucherId: 'WELCOME10', isUsed: false },
      { voucherId: 'SALE15', isUsed: true },
    ]);

    httpTestingController.match(() => true).forEach((req) => {
      if (req.request.url.includes('/api/orders/mine')) {
        req.flush({ total: 5, orders: [] });
      } else if (req.request.url.includes('/api/custom-orders/mine')) {
        req.flush({ total: 2, orders: [] });
      } else if (req.request.url.includes('/api/saved-maps/mine')) {
        req.flush([{ mapId: 'M1' }]);
      } else if (req.request.url.includes('/api/reviews/mine')) {
        req.flush([{ id: 'R1' }]);
      } else if (req.request.url.includes('/api/blogs')) {
        req.flush([{ id: 'B1', author: 'Nguyen Minh Anh' }]);
      } else {
        req.flush([]);
      }
    });

    fixture.detectChanges();

    expect(component.voucherCount).toBe(2);
    expect(component.orderCount).toBe(5);
    expect(component.customOrderCount).toBe(2);
    expect(component.savedMapCount).toBe(1);
    expect(component.reviewCount).toBe(1);
    expect(component.blogCount).toBe(1);

    expect(fixture.nativeElement.querySelector('.profile-header-name')?.textContent).toContain('Nguyen Minh Anh');
    expect(fixture.nativeElement.querySelector('.profile-header-email')?.textContent).toContain('minhanh@example.com');
    expect(fixture.nativeElement.querySelector('.account-menu a[routerLink="/orders"] .menu-badge')?.textContent).toContain('5');
    expect(fixture.nativeElement.querySelector('.account-menu a[routerLink="/my-vouchers"] .menu-badge')?.textContent).toContain('2');
    expect(fixture.nativeElement.querySelector('.account-menu a[routerLink="/custom-order-list"] .menu-badge')?.textContent).toContain('2');
    expect(fixture.nativeElement.querySelector('.account-menu a[routerLink="/saved-maps"] .menu-badge')?.textContent).toContain('1');
    expect(fixture.nativeElement.querySelector('.account-menu a[routerLink="/myreview"] .menu-badge')?.textContent).toContain('1');
    expect(fixture.nativeElement.querySelector('.account-menu a[routerLink="/my-blogs"] .menu-badge')?.textContent).toContain('1');
    expect(fixture.nativeElement.querySelector('.account-menu a[routerLink="/profile"] .menu-badge')).toBeNull();
    expect(fixture.nativeElement.querySelector('.account-menu a[routerLink="/support"] .menu-badge')).toBeNull();
    expect(fixture.nativeElement.querySelector('.strip-value')?.textContent).toContain('2');
  });
});
