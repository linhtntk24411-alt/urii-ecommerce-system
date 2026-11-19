import { DialogService } from '../../../core/services/dialog.service';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CustomOrders } from './custom-orders';

describe('CustomOrders', () => {
  let fixture: ComponentFixture<CustomOrders>;
  let component: CustomOrders;
  let http: HttpTestingController;
  let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(async () => {
    localStorage.clear();
    routeParams = new BehaviorSubject(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [CustomOrders],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: routeParams.asObservable() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomOrders);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('loads customer design requests and database-backed counts', () => {
    setSignedIn();
    fixture.detectChanges();

    const request = http.expectOne((req) => req.url === '/api/custom-orders/mine');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer profile-token');
    request.flush({
      orders: [designRequestResponse()],
      total: 1,
      activeCount: 1,
      page: 1,
      limit: 5,
      totalPages: 1,
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Theo dõi yêu cầu thiết kế');
    expect(fixture.nativeElement.textContent).toContain('custom-order-abc');
    expect(fixture.nativeElement.textContent).toContain('Chân dung');
    expect(fixture.nativeElement.textContent).toContain('Đang chờ xử lý');
    expect(fixture.nativeElement.querySelector('.request-stat strong')?.textContent).toBe('1');
    expect(fixture.nativeElement.querySelector('.request-card__link')?.getAttribute('href'))
      .toBe('/custom-order-list/custom-order-abc');
  });

  it('shows an empty state and actual zero counts when Mongo has no customer requests', () => {
    setSignedIn();
    fixture.detectChanges();
    http.expectOne((req) => req.url === '/api/custom-orders/mine').flush({
      orders: [],
      total: 0,
      activeCount: 0,
      page: 1,
      limit: 5,
      totalPages: 0,
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Chưa có yêu cầu thiết kế');
    expect(fixture.nativeElement.querySelector('.requests-table')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('0');
  });

  it('loads one design request by route ID using the customer-scoped API', () => {
    setSignedIn();
    fixture.detectChanges();
    http.expectOne((req) => req.url === '/api/custom-orders/mine').flush({
      orders: [],
      total: 0,
      activeCount: 0,
      page: 1,
      limit: 5,
      totalPages: 0,
    });
    routeParams.next(convertToParamMap({ slug: 'custom-order-abc' }));
    fixture.detectChanges();

    const request = http.expectOne('/api/custom-orders/mine/custom-order-abc');
    request.flush(designRequestResponse());
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Chi tiết yêu cầu');
    expect(fixture.nativeElement.textContent).toContain('15 x 15 cm');
    expect(fixture.nativeElement.textContent).toContain('Mô tả mẫu');
  });

  function openQuotedRequest(fields: Record<string, unknown> = {}) {
    setSignedIn();
    routeParams.next(convertToParamMap({ slug: 'custom-order-abc' }));
    fixture.detectChanges();
    const quote = { ...designRequestResponse(), status: 'quoted', quotedPrice: 125000, quoteDate: '2026-11-19',
      quoteNote: 'Bao gồm đóng gói', quoteVersion: 1, quoteDecision: 'pending', ...fields };
    http.expectOne('/api/custom-orders/mine/custom-order-abc').flush(quote);
    fixture.detectChanges();
    return quote;
  }

  it('renders a saved quote and confirms acceptance for its version', async () => {
    const quote = openQuotedRequest();
    expect(fixture.nativeElement.textContent).toContain('125.000');
    expect(fixture.nativeElement.textContent).toContain('Bao gồm đóng gói');
    vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(true);
    const action = component.respondToQuote('accepted');
    await Promise.resolve();
    const request = http.expectOne('/api/custom-orders/mine/custom-order-abc/quote-response');
    expect(request.request.body).toEqual({ decision: 'accepted', quoteVersion: 1 });
    request.flush({ ...quote, quoteDecision: 'accepted' });
    await action;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Đã đồng ý báo giá');
    expect(fixture.nativeElement.textContent).not.toContain('Từ chối báo giá');
  });

  it('confirms rejection and removes response actions after cancellation', async () => {
    const quote = openQuotedRequest();
    const confirm = vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(true);
    const action = component.respondToQuote('rejected');
    await Promise.resolve();
    const request = http.expectOne('/api/custom-orders/mine/custom-order-abc/quote-response');
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('kết thúc'), expect.any(String), 'Từ chối báo giá');
    request.flush({ ...quote, status: 'cancelled', quoteDecision: 'rejected' });
    await action;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Đã từ chối báo giá');
    expect(fixture.nativeElement.textContent).not.toContain('Thương lượng giá');
  });

  it('sends a negotiation once and reloads when the quote changes', async () => {
    const quote = openQuotedRequest();
    component.openNegotiation(1);
    component.desiredPrice = 110000;
    component.dealNote = 'Ngân sách dự kiến';
    const action = component.respondToQuote('negotiating');
    await component.respondToQuote('negotiating');
    const request = http.expectOne('/api/custom-orders/mine/custom-order-abc/quote-response');
    expect(request.request.body).toEqual({ decision: 'negotiating', quoteVersion: 1, proposedPrice: 110000, note: 'Ngân sách dự kiến' });
    request.flush({ message: 'Báo giá đã thay đổi.' }, { status: 409, statusText: 'Conflict' });
    await action;
    http.expectOne('/api/custom-orders/mine/custom-order-abc').flush({ ...quote, quoteVersion: 2, quotedPrice: 120000 });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('120.000');
    expect(fixture.nativeElement.textContent).toContain('Báo giá đã thay đổi.');
  });

  it('does not show a price or response actions for incomplete legacy quotes', () => {
    openQuotedRequest({ quotedPrice: undefined, quoteVersion: undefined });
    expect(fixture.nativeElement.textContent).toContain('Báo giá chưa đầy đủ');
    expect(fixture.nativeElement.textContent).not.toContain('Đồng ý báo giá');
  });

  it('does not request private design requests for signed-out visitors', () => {
    fixture.detectChanges();

    expect(component.requiresLogin).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Đăng nhập để xem yêu cầu thiết kế');
    http.expectNone('/api/custom-orders/mine');
  });

  it('shows a sign-in action when the customer API rejects an expired session', () => {
    setSignedIn();
    fixture.detectChanges();
    http.expectOne((req) => req.url === '/api/custom-orders/mine').flush(
      { message: 'Token không hợp lệ hoặc đã hết hạn.' },
      { status: 401, statusText: 'Unauthorized' },
    );
    fixture.detectChanges();

    expect(component.requiresLogin).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Đăng nhập để xem yêu cầu thiết kế');
    expect(fixture.nativeElement.querySelector('.requests-button--primary')?.textContent)
      .toContain('Đăng nhập');
  });

  it('sends status filters to the backend instead of filtering local or sample rows', () => {
    setSignedIn();
    fixture.detectChanges();
    http.expectOne((req) => req.url === '/api/custom-orders/mine').flush({
      orders: [],
      total: 0,
      activeCount: 0,
      page: 1,
      limit: 5,
      totalPages: 0,
    });

    component.selectStatus('completed');
    const request = http.expectOne((req) =>
      req.url === '/api/custom-orders/mine' && req.params.get('status') === 'completed'
    );
    request.flush({ orders: [], total: 0, activeCount: 0, page: 1, limit: 5, totalPages: 0 });
  });

  function setSignedIn(): void {
    localStorage.setItem('authToken', 'profile-token');
    localStorage.setItem('isLoggedIn', 'true');
  }
});

function designRequestResponse() {
  return {
    id: 'custom-order-abc',
    requestName: 'Chân dung',
    imageUrl: '/images/reference.png',
    size: '15 x 15 cm',
    beadType: 'Hạt Perler 5mm',
    status: 'pending',
    createdAt: '2026-11-05T00:00:00.000Z',
    description: 'Mô tả mẫu',
    imageNote: '',
  };
}
