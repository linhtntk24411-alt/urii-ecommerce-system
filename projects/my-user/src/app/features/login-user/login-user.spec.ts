import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { LoginUser } from './login-user';

describe('LoginUser', () => {
  let component: LoginUser;
  let fixture: ComponentFixture<LoginUser>;
  let httpTestingController: HttpTestingController;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginUser],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    localStorage.clear();
    fixture = TestBed.createComponent(LoginUser);
    component = fixture.componentInstance;
    httpTestingController = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    await fixture.whenStable();
  });

  afterEach(() => {
    httpTestingController.verify();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('toggles password visibility from the eye button', () => {
    fixture.detectChanges();
    const passwordInput = fixture.nativeElement.querySelector('#login-password') as HTMLInputElement;
    const toggleButton = fixture.nativeElement.querySelector('.password-icon') as HTMLButtonElement;

    expect(passwordInput.type).toBe('password');
    expect(toggleButton.getAttribute('aria-label')).toBe('Hiện mật khẩu');

    toggleButton.click();
    fixture.detectChanges();
    expect(passwordInput.type).toBe('text');
    expect(toggleButton.getAttribute('aria-label')).toBe('Ẩn mật khẩu');

    toggleButton.click();
    fixture.detectChanges();
    expect(passwordInput.type).toBe('password');
  });

  it('logs in, stores the public profile and notifies the header', () => {
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    component.loginForm.setValue({ email: ' person@example.com ', password: 'uri123' });

    component.login();

    const request = httpTestingController.expectOne('/api/auth/login');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'person@example.com', password: 'uri123' });
    request.flush({
      token: 'test-jwt-token',
      user: {
        id: 'user-id',
        name: 'Test User',
        email: 'person@example.com',
        role: 'user',
        avatar: '',
      },
    });

    expect(localStorage.getItem('isLoggedIn')).toBe('true');
    expect(localStorage.getItem('authToken')).toBe('test-jwt-token');
    expect(localStorage.getItem('userName')).toBe('Test User');
    expect(localStorage.getItem('userEmail')).toBe('person@example.com');
    expect(localStorage.getItem('userRole')).toBe('user');
    expect(dispatchSpy.mock.calls[0][0].type).toBe('auth:changed');
    expect(navigateSpy).toHaveBeenCalledWith(['/']);
    expect(component.isSubmitting).toBe(false);
  });

  it('returns to a local page requested before login', () => {
    const route = TestBed.inject(ActivatedRoute);
    Object.defineProperty(route, 'snapshot', {
      configurable: true,
      value: { queryParamMap: convertToParamMap({ returnUrl: '/blog-detail/test-blog' }) },
    });
    const navigateByUrlSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    component.loginForm.setValue({ email: 'person@example.com', password: 'secret' });

    component.login();
    httpTestingController.expectOne('/api/auth/login').flush({
      token: 'test-jwt-token',
      user: {
        id: 'user-id',
        name: 'Test User',
        email: 'person@example.com',
        role: 'user',
        avatar: '',
      },
    });

    expect(navigateByUrlSpy).toHaveBeenCalledWith('/blog-detail/test-blog');
  });

  it('does not mark the user as logged in when the API omits its token', () => {
    component.loginForm.setValue({ email: 'person@example.com', password: 'uri123' });

    component.login();
    httpTestingController.expectOne('/api/auth/login').flush({
      user: {
        id: 'user-id',
        name: 'Test User',
        email: 'person@example.com',
        role: 'user',
      },
    });

    expect(component.errorMessage).toBe('Máy chủ trả về dữ liệu đăng nhập không hợp lệ.');
    expect(localStorage.getItem('isLoggedIn')).toBeNull();
    expect(localStorage.getItem('authToken')).toBeNull();
  });

  it('shows an error when the credentials are rejected', () => {
    component.loginForm.setValue({ email: 'person@example.com', password: 'wrong' });
    component.login();
    httpTestingController.expectOne('/api/auth/login').flush(
      { message: 'invalid credentials' },
      { status: 401, statusText: 'Unauthorized' },
    );

    expect(component.errorMessage).toBe('Email hoặc mật khẩu không chính xác.');
    expect(localStorage.getItem('isLoggedIn')).toBeNull();
    expect(localStorage.getItem('authToken')).toBeNull();
    expect(component.isSubmitting).toBe(false);
  });

  it('stops submitting and reports an error when the auth API fails', () => {
    component.loginForm.setValue({ email: 'person@example.com', password: 'uri123' });

    component.login();
    httpTestingController.expectOne('/api/auth/login').flush(
      { message: 'database unavailable' },
      { status: 503, statusText: 'Service Unavailable' },
    );

    expect(component.errorMessage).toBe('Không thể đăng nhập lúc này. Vui lòng thử lại sau.');
    expect(component.isSubmitting).toBe(false);
  });

  it('opens the password reset form with the login email prefilled', () => {
    component.loginForm.controls.email.setValue('person@example.com');

    component.openPasswordReset();

    expect(component.isPasswordResetOpen).toBe(true);
    expect(component.passwordResetForm.controls.email.value).toBe('person@example.com');
  });

  it('shows a demo email notice without calling an API or changing password data', () => {
    component.passwordResetForm.controls.email.setValue('person@example.com');

    component.sendPasswordResetNotice();

    expect(component.passwordResetMessage).toBe('Chúng tôi đã gửi hướng dẫn đặt lại mật khẩu qua email. Vui lòng kiểm tra hộp thư của bạn.');
    expect(localStorage.getItem('isLoggedIn')).toBeNull();
    httpTestingController.expectNone('/api/auth/change-password');
  });
});
