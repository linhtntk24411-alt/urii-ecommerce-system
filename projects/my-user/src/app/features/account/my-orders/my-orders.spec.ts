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
    TestBed.resetTestingModule();
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
    TestBed.resetTestingModule();
  });

  function flushBackgroundRequests(eligible: any[] = [], counts: Record<string, number> = {}): void {
    const eligibleReqs = http.match('/api/reviews/eligible-orders');
    eligibleReqs.forEach((r) => r.flush(eligible));
    const summaryReqs = http.match('/api/orders/mine/summary');
    summaryReqs.forEach((r) => r.flush({ counts }));
  }

  it('loads customer orders from the authenticated Mongo-backed API', () => {
    setSignedIn();
    fixture.detectChanges();
    flushBackgroundRequests();

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
    expect(fixture.nativeElement.querySelector('.order-card a[href="/orders/UR-82901"]')?.getAttribute('href'))
      .toBe('/orders/UR-82901');
    expect(component.totalOrders).toBe(1);
  });

  it('shows an empty state when the API returns no stored orders', () => {
    setSignedIn();
    fixture.detectChanges();
    flushBackgroundRequests();

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
    http.expectNone('/api/reviews/eligible-orders');
    http.expectNone('/api/orders/mine/summary');
  });

  it('requests the selected status from the API instead of filtering fabricated rows', () => {
    setSignedIn();
    fixture.detectChanges();
    flushBackgroundRequests();

    http.expectOne((req) => req.url === '/api/orders/mine').flush({
      orders: [],
      total: 0,
      page: 1,
      limit: 5,
      totalPages: 0,
    });

    component.selectStatus('completed');
    flushBackgroundRequests();
    const request = http.expectOne((req) =>
      req.url === '/api/orders/mine' && req.params.get('statusId') === 'completed'
    );
    expect(request.request.params.get('page')).toBe('1');
    request.flush({ orders: [], total: 0, page: 1, limit: 5, totalPages: 0 });
  });

  it('displays prominent unreviewed banner when customer has orders waiting for review', () => {
    setSignedIn();
    fixture.detectChanges();

    flushBackgroundRequests([
      {
        id: 'UR-COMPLETED-1',
        statusId: 'completed',
        items: [{ productId: 'PROD-1', name: 'Hạt ủi pastel', unitPrice: 20000, quantity: 2 }],
      },
    ]);

    const ordersReq = http.expectOne((req) => req.url === '/api/orders/mine');
    ordersReq.flush({
      orders: [
        {
          id: 'UR-COMPLETED-1',
          statusId: 'completed',
          status: 'Đã giao',
          totalAmount: 40000,
          total: '40.000đ',
          items: [{ productId: 'PROD-1', name: 'Hạt ủi pastel', unitPrice: 20000, quantity: 2 }],
        },
      ],
      total: 1,
      page: 1,
      limit: 5,
      totalPages: 1,
    });
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.unreviewed-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Bạn có 1 đơn hàng chưa đánh giá');
    expect(banner.textContent).toContain('Đánh giá ngay (1)');

    const reviewTag = fixture.nativeElement.querySelector('.order-review-tag--pending');
    expect(reviewTag).toBeTruthy();
    expect(reviewTag.textContent).toContain('Chưa đánh giá');

    const reviewBtn = fixture.nativeElement.querySelector('.orders-button--review');
    expect(reviewBtn).toBeTruthy();
    expect(reviewBtn.textContent).toContain('Đánh giá ngay');
  });

  it('displays count badges on other tabs when status counts are available', () => {
    setSignedIn();
    fixture.detectChanges();
    flushBackgroundRequests(
      [{ id: 'UR-COMPLETED-1', statusId: 'completed', items: [{ productId: 'P1' }] }],
      {
        '': 12,
        pending: 3,
        processing: 1,
        shipping: 2,
        completed: 5,
        returned: 0,
        cancelled: 1,
      }
    );

    http.expectOne((req) => req.url === '/api/orders/mine').flush({
      orders: [],
      total: 12,
      page: 1,
      limit: 5,
      totalPages: 3,
    });
    fixture.detectChanges();

    const tabs = fixture.nativeElement.querySelectorAll('.order-tabs__item');
    expect(tabs.length).toBe(8);

    // Tab 0: "Tất cả" (12)
    expect(tabs[0].textContent).toContain('Tất cả');
    expect(tabs[0].querySelector('.order-tab-badge')?.textContent.trim()).toBe('12');

    // Tab 1: "Chờ xác nhận" (3)
    expect(tabs[1].textContent).toContain('Chờ xác nhận');
    expect(tabs[1].querySelector('.order-tab-badge')?.textContent.trim()).toBe('3');

    // Tab 2: "Chờ lấy hàng" (1)
    expect(tabs[2].textContent).toContain('Chờ lấy hàng');
    expect(tabs[2].querySelector('.order-tab-badge')?.textContent.trim()).toBe('1');

    // Tab 3: "Chờ giao hàng" (2)
    expect(tabs[3].textContent).toContain('Chờ giao hàng');
    expect(tabs[3].querySelector('.order-tab-badge')?.textContent.trim()).toBe('2');

    // Tab 4: "Đã giao" (5)
    expect(tabs[4].textContent).toContain('Đã giao');
    expect(tabs[4].querySelector('.order-tab-badge')?.textContent.trim()).toBe('5');

    // Tab 5: "Chưa đánh giá" (1)
    expect(tabs[5].textContent).toContain('Chưa đánh giá');
    expect(tabs[5].querySelector('.order-tab-badge')?.textContent.trim()).toBe('1');

    // Tab 6: "Trả hàng" (0 -> no badge)
    expect(tabs[6].textContent).toContain('Trả hàng');
    expect(tabs[6].querySelector('.order-tab-badge')).toBeNull();

    // Tab 7: "Đã hủy" (1)
    expect(tabs[7].textContent).toContain('Đã hủy');
    expect(tabs[7].querySelector('.order-tab-badge')?.textContent.trim()).toBe('1');
  });

  it('opens review modal, allows selecting rating and submitting review to /api/reviews', () => {
    setSignedIn();
    fixture.detectChanges();

    flushBackgroundRequests([
      {
        id: 'UR-COMPLETED-1',
        statusId: 'completed',
        items: [{ productId: 'PROD-1', name: 'Hạt ủi pastel', unitPrice: 20000, quantity: 1 }],
      },
    ]);

    http.expectOne((req) => req.url === '/api/orders/mine').flush({
      orders: [
        {
          id: 'UR-COMPLETED-1',
          statusId: 'completed',
          status: 'Đã giao',
          totalAmount: 20000,
          total: '20.000đ',
          items: [{ productId: 'PROD-1', name: 'Hạt ủi pastel', unitPrice: 20000, quantity: 1 }],
        },
      ],
      total: 1,
      page: 1,
      limit: 5,
      totalPages: 1,
    });
    fixture.detectChanges();

    const reviewBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.orders-button--review');
    reviewBtn.click();
    fixture.detectChanges();

    expect(component.isReviewModalOpen).toBe(true);
    expect(fixture.nativeElement.querySelector('.review-modal')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#review-modal-title')?.textContent).toContain('Đánh giá sản phẩm');

    component.reviewRating = 5;
    component.reviewContent = 'Hạt ủi màu rất đẹp, ủi dính đều!';
    component.submitReview();

    const postReq = http.expectOne('/api/reviews');
    expect(postReq.request.method).toBe('POST');
    expect(postReq.request.body).toEqual({
      orderId: 'UR-COMPLETED-1',
      productId: 'PROD-1',
      rating: 5,
      content: 'Hạt ủi màu rất đẹp, ủi dính đều!',
    });
    postReq.flush({ message: 'Đánh giá thành công' });

    // After success, it reloads eligible orders
    flushBackgroundRequests();
    fixture.detectChanges();

    expect(component.reviewSubmitSuccess).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Gửi đánh giá thành công!');
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
