import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { routes } from '../../app.routes';
import { SidebarAccount } from './sidebar-account';

describe('SidebarAccount', () => {
  let component: SidebarAccount;
  let fixture: ComponentFixture<SidebarAccount>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SidebarAccount],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SidebarAccount);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows account navigation without adding order or map counts', () => {
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Hồ sơ của tôi');
    expect(text).toContain('Đơn hàng của tôi');
    expect(text).toContain('Yêu cầu thiết kế');
    expect(text).toContain('Kho map đã lưu');
    expect(text).toContain('Sản phẩm yêu thích');
    expect(text).toContain('Đánh giá của tôi');
    expect(text).toContain('Bài viết của tôi');
    expect(text).not.toContain('Đăng xuất');
    expect(fixture.nativeElement.querySelector('.account-nav__link[href="/orders"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.account-nav__link[href="/favorites"]')).not.toBeNull();
  });

  it('keeps favorites and orders under the shared account layout', () => {
    const accountRoute = routes.find((route) => route.component === SidebarAccount);
    const childPaths = accountRoute?.children?.map((route) => route.path);

    expect(childPaths).toContain('orders');
    expect(childPaths).toContain('favorites');
    expect(routes.filter((route) => route.path === 'favorites')).toHaveLength(0);
  });
});
