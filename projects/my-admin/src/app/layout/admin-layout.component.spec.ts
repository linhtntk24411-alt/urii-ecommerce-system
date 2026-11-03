import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { AdminApiService } from '../core/services/admin-api.service';
import { AdminLayoutComponent } from './admin-layout.component';

describe('AdminLayoutComponent', () => {
  let fixture: ComponentFixture<AdminLayoutComponent>;
  let logout: ReturnType<typeof vi.fn>;
  let router: Router;

  beforeEach(async () => {
    logout = vi.fn();

    await TestBed.configureTestingModule({
      imports: [AdminLayoutComponent],
      providers: [
        provideRouter([]),
        {
          provide: AdminApiService,
          useValue: { logout }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AdminLayoutComponent);
    router = TestBed.inject(Router);
  });

  it('clears the session and replaces the current route with login on logout', () => {
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const event = new Event('click', { cancelable: true });

    fixture.componentInstance.onLogout(event);

    expect(event.defaultPrevented).toBe(true);
    expect(logout).toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/', { replaceUrl: true });
  });
});
