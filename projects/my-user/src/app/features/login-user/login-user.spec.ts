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

  it('toggles visibility independently for registration password fields', () => {
    fixture.detectChanges();
    const registerPassword = fixture.nativeElement.querySelector('#register-password') as HTMLInputElement;
    const confirmPassword = fixture.nativeElement.querySelector('#confirm-password') as HTMLInputElement;
    const registerEye = registerPassword.parentElement?.querySelector('button') as HTMLButtonElement;
    const confirmEye = confirmPassword.parentElement?.querySelector('button') as HTMLButtonElement;

    expect(registerPassword.type).toBe('password');
    expect(confirmPassword.type).toBe('password');
    registerEye.click();
    fixture.detectChanges();
    expect(registerPassword.type).toBe('text');
    expect(confirmPassword.type).toBe('password');
    confirmEye.click();
    fixture.detectChanges();
    expect(confirmPassword.type).toBe('text');
    expect(registerPassword.type).toBe('text');
  });

  it('starts Google OAuth through the backend endpoint and reports a blocked popup', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    component.startSocialLogin('google');

    expect(openSpy).toHaveBeenCalledWith(
      '/api/auth/oauth/google',
      'urii-google-oauth',
      'popup,width=520,height=680',
    );
    expect(component.socialAuthMessage).toContain('đã chặn cửa sổ đăng nhập');
    expect(component.isSocialAuthInProgress).toBe(false);
  });

  it('starts Facebook OAuth from the registration social button', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    fixture.detectChanges();

    const facebookButton = fixture.nativeElement.querySelector(
      '.register-panel .social-button:nth-child(2)',
    ) as HTMLButtonElement;
    facebookButton.click();

    expect(openSpy).toHaveBeenCalledWith(
      '/api/auth/oauth/facebook',
      'urii-facebook-oauth',
      'popup,width=520,height=680',
    );
  });

  it('updates password requirement indicators and blocks weak registration passwords', () => {
    component.registerForm.patchValue({
      name: 'Test User',
      email: 'person@example.com',
      password: 'lowercase1',
      confirmPassword: 'lowercase1',
    });

    expect(component.passwordRequirementStatus).toEqual({
      length: true,
      uppercase: false,
      lowercase: true,
      number: true,
    });

    component.register();

    expect(component.registerForm.controls.password.invalid).toBe(true);
    httpTestingController.expectNone('/api/auth/register');
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

  it('shows a reminder and does not call the API when required credentials are missing', () => {
    fixture.detectChanges();

    const form = fixture.nativeElement.querySelector('.login-panel') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(component.errorMessage).toBe('Vui lòng nhập email và mật khẩu.');
    expect(fixture.nativeElement.querySelector('.login-panel [role="alert"]')?.textContent)
      .toContain('Vui lòng nhập email và mật khẩu.');
    httpTestingController.expectNone('/api/auth/login');
  });

  it('offers registration when the API reports an unknown email', () => {
    component.loginForm.setValue({ email: 'new@example.com', password: 'valid-password' });
    component.login();
    httpTestingController.expectOne('/api/auth/login').flush(
      { message: 'Không tìm thấy tài khoản với email này.' },
      { status: 404, statusText: 'Not Found' },
    );
    fixture.detectChanges();

    expect(component.showRegisterPrompt).toBe(true);
    expect(component.errorMessage).toContain('Bạn chưa có tài khoản?');
    const registerPrompt = fixture.nativeElement.querySelector('.register-prompt-link') as HTMLButtonElement;
    expect(registerPrompt).not.toBeNull();
    registerPrompt.click();
    fixture.detectChanges();

    expect(component.isRegisterMode).toBe(true);
    expect(component.showRegisterPrompt).toBe(false);
  });

  it('registers an account through the API and switches to login with the new email', () => {
    component.registerForm.setValue({
      name: '  Test User  ',
      email: ' person@example.com ',
      password: 'UriiPass123',
      confirmPassword: 'UriiPass123',
    });

    component.register();

    const request = httpTestingController.expectOne('/api/auth/register');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      name: 'Test User',
      email: 'person@example.com',
      password: 'UriiPass123',
    });
    request.flush({ message: 'Đăng ký thành công!' });

    expect(component.isRegisterMode).toBe(false);
    expect(component.loginForm.controls.email.value).toBe('person@example.com');
    expect(component.registerSuccessMessage).toBe('Đăng ký thành công!');
    expect(localStorage.getItem('isLoggedIn')).toBeNull();
  });

  it('signs in after registration, saves the session, and navigates to the home page', () => {
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    component.registerForm.setValue({
      name: 'Test User',
      email: 'person@example.com',
      password: 'UriiPass123',
      confirmPassword: 'UriiPass123',
    });

    component.register();
    httpTestingController.expectOne('/api/auth/register').flush({ message: 'Đăng ký thành công!' });
    fixture.detectChanges();

    expect(component.isRegisterMode).toBe(false);
    expect((fixture.nativeElement.querySelector('#login-mode') as HTMLInputElement).checked).toBe(true);

    component.loginForm.controls.password.setValue('UriiPass123');
    component.login();
    httpTestingController.expectOne('/api/auth/login').flush({
      token: 'new-user-token',
      user: {
        id: 'new-user-id',
        name: 'Test User',
        email: 'person@example.com',
        role: 'user',
      },
    });

    expect(localStorage.getItem('authToken')).toBe('new-user-token');
    expect(localStorage.getItem('isLoggedIn')).toBe('true');
    expect(localStorage.getItem('userEmail')).toBe('person@example.com');
    expect(navigateSpy).toHaveBeenCalledWith(['/']);
  });

  it('does not send registration when password confirmation does not match', () => {
    component.registerForm.setValue({
      name: 'Test User',
      email: 'person@example.com',
      password: 'UriiPass123',
      confirmPassword: 'different123',
    });

    component.register();

    expect(component.registerForm.hasError('passwordsMismatch')).toBe(true);
    httpTestingController.expectNone('/api/auth/register');
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

    expect(component.errorMessage).toBe('Mật khẩu không chính xác. Vui lòng thử lại.');
    expect(component.showRegisterPrompt).toBe(false);
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
    expect(component.showRegisterPrompt).toBe(false);
    expect(component.isSubmitting).toBe(false);
  });

  it('opens the password reset form with the login email prefilled', () => {
    component.loginForm.controls.email.setValue('person@example.com');

    component.openPasswordReset();

    expect(component.isForgotPasswordModalOpen).toBe(true);
    expect(component.forgotPasswordEmail).toBe('person@example.com');
  });
});
