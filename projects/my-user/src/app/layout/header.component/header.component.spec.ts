import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HeaderComponent } from './header.component';

describe('HeaderComponent', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    localStorage.clear();
    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
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
});
