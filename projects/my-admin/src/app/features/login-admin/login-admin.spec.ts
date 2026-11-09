import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { LoginAdmin } from './login-admin';

describe('LoginAdmin', () => {
  let component: LoginAdmin;
  let fixture: ComponentFixture<LoginAdmin>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginAdmin],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([])
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginAdmin);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders header, footer and login form elements without chatbot widget or shopping link', () => {
    const compiled = fixture.nativeElement as HTMLElement;

    // Header elements
    const header = compiled.querySelector('.admin-auth-header');
    expect(header).toBeTruthy();
    expect(compiled.querySelector('.brand-logo')).toBeTruthy();
    expect(compiled.textContent).toContain('Hệ thống Quản trị');

    // Shopping link should NOT exist
    expect(compiled.textContent).not.toContain('Trang mua sắm');

    // Login form
    expect(compiled.textContent).toContain('Chào mừng trở lại');
    expect(compiled.querySelector('#login-email')).toBeTruthy();
    expect(compiled.querySelector('#login-password')).toBeTruthy();
    expect(compiled.querySelector('.primary-button')).toBeTruthy();

    // Footer elements
    const footer = compiled.querySelector('.urii-footer');
    expect(footer).toBeTruthy();
    expect(footer?.textContent).toContain('Urii Perler Beads');

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
});
