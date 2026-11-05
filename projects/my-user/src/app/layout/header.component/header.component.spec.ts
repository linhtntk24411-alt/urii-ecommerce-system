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
  });

  it('loads the signed-in user profile from the API and updates the avatar', () => {
    localStorage.setItem('authToken', 'test-jwt-token');
    localStorage.setItem('isLoggedIn', 'true');
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

  it('removes the saved API token on logout', () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('authToken', 'test-jwt-token');

    component.confirmLogout();

    expect(localStorage.getItem('authToken')).toBeNull();
    expect(localStorage.getItem('isLoggedIn')).toBeNull();
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
});
