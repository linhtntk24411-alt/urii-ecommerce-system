import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MyOrders } from './my-orders';

describe('MyOrders', () => {
  let fixture: ComponentFixture<MyOrders>;
  let component: MyOrders;
  let http: HttpTestingController;
  let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(async () => {
    localStorage.clear();
    routeParams = new BehaviorSubject(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [MyOrders],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: routeParams.asObservable() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MyOrders);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('loads customer orders from the authenticated Mongo-backed API', () => {
    setSignedIn();
    fixture.detectChanges();

    const request = http.expectOne((req) => req.url === '/api/orders/mine');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer profile-token');
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('limit')).toBe('5');
    request.flush({
      orders: [orderResponse()],
      total: 1,
      page: 1,
      limit: 5,
      totalPages: 1,
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('UR-82901');
    expect(fixture.nativeElement.textContent).toContain('15.000đ');
    expect(fixture.nativeElement.querySelector('.order-card a')?.getAttribute('href'))
      .toBe('/orders/UR-82901');
    expect(component.totalOrders).toBe(1);
  });

  it('shows an empty state when the API returns no stored orders', () => {
    setSignedIn();
    fixture.detectChanges();
    http.expectOne((req) => req.url === '/api/orders/mine').flush({
      orders: [],
      total: 0,
      page: 1,
      limit: 5,
      totalPages: 0,
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Chưa có đơn hàng');
    expect(fixture.nativeElement.querySelector('.order-card')).toBeNull();
    expect(fixture.nativeElement.querySelector('.orders-pagination')).toBeNull();
  });

  it('loads a selected order by its route slug through the customer detail API', () => {
    setSignedIn();
    fixture.detectChanges();
    http.expectOne((req) => req.url === '/api/orders/mine').flush({
      orders: [],
      total: 0,
      page: 1,
      limit: 5,
      totalPages: 0,
    });
    routeParams.next(convertToParamMap({ slug: 'UR-82901' }));
    fixture.detectChanges();

    const request = http.expectOne('/api/orders/mine/UR-82901');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer profile-token');
    request.flush(orderResponse());
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Chi tiết đơn hàng');
    expect(fixture.nativeElement.textContent).toContain('UR-82901');
    expect(fixture.nativeElement.textContent).toContain('Hạt ủi');
  });

  it('does not request private orders for a signed-out visitor', () => {
    fixture.detectChanges();

    expect(component.requiresLogin).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Đăng nhập để xem đơn hàng');
    http.expectNone('/api/orders/mine');
  });

  it('requests the selected status from the API instead of filtering fabricated rows', () => {
    setSignedIn();
    fixture.detectChanges();
    http.expectOne((req) => req.url === '/api/orders/mine').flush({
      orders: [],
      total: 0,
      page: 1,
      limit: 5,
      totalPages: 0,
    });

    component.selectStatus('completed');
    const request = http.expectOne((req) =>
      req.url === '/api/orders/mine' && req.params.get('statusId') === 'completed'
    );
    expect(request.request.params.get('page')).toBe('1');
    request.flush({ orders: [], total: 0, page: 1, limit: 5, totalPages: 0 });
  });

  function setSignedIn(): void {
    localStorage.setItem('authToken', 'profile-token');
    localStorage.setItem('isLoggedIn', 'true');
  }
});

function orderResponse() {
  return {
    id: 'UR-82901',
    userId: '6ade4310c044b23d6c6a8681',
    date: '20/05/2024',
    statusId: 'pending',
    totalAmount: 15000,
    items: [{ productId: '1075483767', name: 'Hạt ủi', unitPrice: 15000, quantity: 1 }],
    payment: { method: 'Thanh toán khi nhận hàng (COD)', statusId: 'unpaid' },
    shipping: { method: 'Giao hàng tiêu chuẩn', trackingNumber: 'GHK-2024-0520-001' },
    address: { name: 'Nguyễn Minh Anh', phone: '0901234567', address: 'TP. Hồ Chí Minh' },
  };
}
