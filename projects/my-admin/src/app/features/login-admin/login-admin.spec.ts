import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoginAdmin } from './login-admin';

describe('LoginAdmin', () => {
  let component: LoginAdmin;
  let fixture: ComponentFixture<LoginAdmin>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginAdmin],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginAdmin);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows login by default and lets the user switch to registration', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const loginMode = compiled.querySelector<HTMLInputElement>('#login-mode');
    const registerMode = compiled.querySelector<HTMLInputElement>('#register-mode');

    expect(compiled.textContent).toContain('Đăng nhập');
    expect(compiled.textContent).toContain('Đăng ký');
    expect(loginMode?.checked).toBe(true);

    registerMode?.click();
    expect(registerMode?.checked).toBe(true);
  });
});
