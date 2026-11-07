import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AdminApiService } from '../core/services/admin-api.service';
import { AdminLayoutComponent } from './admin-layout.component';

describe('AdminLayoutComponent', () => {
  let fixture: ComponentFixture<AdminLayoutComponent>;
  let component: AdminLayoutComponent;
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
          useValue: {
            logout,
            loadAllSearchData: vi.fn(),
            getOrders: vi.fn().mockResolvedValue([]),
            getUsers: vi.fn().mockResolvedValue([]),
            getProducts: vi.fn().mockResolvedValue([]),
            getCoupons: vi.fn().mockResolvedValue([]),
            getBlogs: vi.fn().mockResolvedValue([]),
            getLibraryMaps: vi.fn().mockReturnValue(of([])),
            getComments: vi.fn().mockReturnValue(of([])),
            getAdminNotifications: vi.fn().mockReturnValue(of({ notifications: [], unreadCount: 0 })),
            markAllNotificationsAsRead: vi.fn().mockReturnValue(of({})),
            markNotificationAsRead: vi.fn().mockReturnValue(of({}))
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AdminLayoutComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
  });

  it('opens confirmation and replaces route on confirmLogout', () => {
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const event = new Event('click', { cancelable: true });

    component.onLogout(event);
    expect(event.defaultPrevented).toBe(true);
    expect(component.isLogoutConfirmOpen).toBe(true);

    component.confirmLogout();
    expect(logout).toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/', { replaceUrl: true });
  });

  it('navigates to the referenced target when clicking a notification', () => {
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const notif = {
      id: 'NOTIF-1',
      title: 'Đơn hàng mới',
      typeId: 'ADMIN_ORDER_NEW',
      reference: { orderId: 'UR-12345' },
      isRead: false
    };

    component.onNotificationClick(notif);
    expect(notif.isRead).toBe(true);
    expect(navigateSpy).toHaveBeenCalledWith(['/orders'], {
      queryParams: { searchType: 'order', searchId: 'UR-12345' }
    });
  });
});
