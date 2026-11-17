import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { LoginAdmin } from './login-admin';
import { PLATFORM_ID } from '@angular/core';
import { afterEach, vi } from 'vitest';
import { AdminApiService } from '../../core/services/admin-api.service';

describe('LoginAdmin', () => {
  let component: LoginAdmin;
  let fixture: ComponentFixture<LoginAdmin>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginAdmin],
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: AdminApiService, useValue: { setToken: vi.fn() } },
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([])
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginAdmin);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => { TestBed.inject(HttpTestingController).verify(); fixture.destroy(); vi.restoreAllMocks(); });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders the existing login card and social buttons without adding a chatbot or shopping link', () => {
    const compiled = fixture.nativeElement as HTMLElement;

    // Page branding
    expect(compiled.querySelector('.welcome-kicker')?.textContent).toContain('Chào mừng đến với');
    expect(compiled.querySelector('.welcome-title')?.textContent).toContain('Hệ thống quản trị');
    expect(compiled.querySelector('.site-logo')?.getAttribute('src')).toBe('assets/Urii-Logo.png');
    expect(compiled.querySelector('.site-footer')).toBeTruthy();

    // Login card
    const header = compiled.querySelector('.auth-header');
    expect(header).toBeTruthy();
    expect(compiled.querySelector('.auth-card')).toBeTruthy();

    // Shopping link should NOT exist
    expect(compiled.textContent).not.toContain('Trang mua sắm');

    // Login form
    expect(compiled.textContent).toContain('Đăng nhập quản trị');
    expect(compiled.querySelector('#login-email')).toBeTruthy();
    expect(compiled.querySelector('#login-password')).toBeTruthy();
    expect(compiled.querySelector('.primary-button')).toBeTruthy();

    // Footer elements
    expect(compiled.querySelectorAll('.social-buttons button').length).toBe(2);

    // Chatbot red button should NOT exist
    expect(compiled.querySelector('.chatbot-button')).toBeNull();
  });

  it('toggles password visibility', () => {
    expect(component.showPassword).toBe(false);
    component.togglePasswordVisibility();
    expect(component.showPassword).toBe(true);
    component.togglePasswordVisibility();
    expect(component.showPassword).toBe(false);
  });

  it('opens the reset flow from the login link, validates email and prevents duplicate sends', () => {
    const input = fixture.nativeElement.querySelector('#login-email'); input.value = ' Admin@Example.test ';
    fixture.nativeElement.querySelector('.field-heading .reset-link').click(); fixture.detectChanges();
    expect(component.resetOpen).toBe(true); expect(component.resetEmail).toBe('Admin@Example.test');
    component.resetEmail = 'invalid'; component.sendResetOtp(); expect(component.resetError).toBeTruthy();
    component.resetEmail = ' Admin@Example.test '; component.sendResetOtp(); component.sendResetOtp();
    const request = TestBed.inject(HttpTestingController).expectOne('/api/auth/admin/forgot-password');
    expect(request.request.body).toEqual({ email: 'admin@example.test' });
    request.flush({ message: 'Sent' });
    expect(component.resetStep).toBe('otp'); expect(component.resetCountdown).toBe(60);
    component.sendResetOtp(); TestBed.inject(HttpTestingController).expectNone('/api/auth/admin/forgot-password');
    component.closePasswordReset(); expect(component.resetCountdown).toBe(0);
  });

  it('verifies OTP before resetting, validates confirmation and clears sensitive form fields on success', () => {
    const http = TestBed.inject(HttpTestingController);
    component.openPasswordReset('admin@example.test'); component.sendResetOtp();
    http.expectOne('/api/auth/admin/forgot-password').flush({ message: 'Sent' });
    component.resetOtp = 'wrong'; component.verifyResetOtp(); expect(component.resetStep).toBe('otp');
    component.resetOtp = '123456'; component.verifyResetOtp(); component.verifyResetOtp();
    http.expectOne('/api/auth/admin/verify-reset-otp').flush({ message: 'Verified' });
    expect(component.resetStep).toBe('password');
    component.resetPassword = 'Password123'; component.resetConfirm = 'Wrong123'; component.submitResetPassword();
    http.expectNone('/api/auth/admin/reset-password'); expect(component.resetError).toBeTruthy();
    component.resetConfirm = 'Password123'; component.submitResetPassword(); component.submitResetPassword();
    const request = http.expectOne('/api/auth/admin/reset-password');
    expect(request.request.body).toEqual({ email: 'admin@example.test', otp: '123456', password: 'Password123', confirmPassword: 'Password123' });
    request.flush({ message: 'Success' });
    expect(component.resetStep).toBe('success'); expect(component.resetPassword).toBe(''); expect(component.resetOtp).toBe('');
    expect(TestBed.inject(AdminApiService).setToken).not.toHaveBeenCalled();
    component.closePasswordReset(); expect(component.resetOpen).toBe(false);
  });

  it('shows server errors without advancing and permits resend after expiry', () => {
    const http = TestBed.inject(HttpTestingController);
    component.openPasswordReset('user@example.test'); component.sendResetOtp();
    http.expectOne('/api/auth/admin/forgot-password').flush({ message: 'Admin only' }, { status: 403, statusText: 'Forbidden' });
    expect(component.resetBusy).toBe(false); expect(component.resetStep).toBe('email'); expect(component.resetError).toBe('Admin only');
    component.resetEmail = 'admin@example.test'; component.sendResetOtp(); http.expectOne('/api/auth/admin/forgot-password').flush({});
    component.resetCountdown = 0; component.resetOtp = '123456'; component.verifyResetOtp(); http.expectNone('/api/auth/admin/verify-reset-otp');
    component.sendResetOtp(); http.expectOne('/api/auth/admin/forgot-password').flush({});
    expect(component.resetCountdown).toBe(60); expect(component.resetBusy).toBe(false);
  });
});
