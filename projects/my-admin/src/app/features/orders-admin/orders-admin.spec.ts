import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, NEVER } from 'rxjs';
import { OrdersAdmin } from './orders-admin';
import { AdminApiService } from '../../core/services/admin-api.service';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { AdminSocketService } from '../../core/services/admin-socket.service';

describe('OrdersAdmin', () => {
  let component: OrdersAdmin;
  let fixture: ComponentFixture<OrdersAdmin>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrdersAdmin],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: AdminSocketService, useValue: { onCrudChange: () => NEVER } },
        {
        provide: AdminApiService,
        useValue: {
          products$: of([]),
          getCustomOrders: () => of([]),
          getReturnRequests: () => of({ requests: [], total: 0, page: 1 }),
          getOrders: () => of([{
            id: 'UR-1',
            userName: '  Phạm   Thu Hà ',
            address: { name: 'Phạm Thu Hà' },
            items: [],
            total: 0,
            statusType: 'pending'
          }]),
          getInitialUsers: () => [{
            _id: 'user-1',
            name: 'Phạm Thu Hà',
            avatar: 'images/avatar_user2.jpeg',
            email: 'ha@example.com',
            role: 'user'
          }],
          getUsers: async () => [],
          getLibraryMapImageUrl: (path: string) => `http://localhost:3002/${path}`
        }
      }]
    }).compileComponents();

    fixture = TestBed.createComponent(OrdersAdmin);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('keeps cancellation handling and its pagination when switching request tabs', async () => {
    vi.spyOn(TestBed.inject(AdminApiService), 'getOrders').mockReturnValue(of(Array.from({ length: 5 }, (_, i) => ({ id: `C-${i}`, statusType: 'pending', cancellationStatusId: 'pending_approval' }))));
    component.loadOrders();
    component.currentCancelPage = 2;
    fixture.nativeElement.querySelector('#return-tab').click();
    await fixture.whenStable();
    fixture.nativeElement.querySelector('#cancel-tab').click();
    await fixture.whenStable();
    expect(component.currentCancelPage).toBe(2);
    expect(component.pagedCancelRequests.map(order => order.id)).toEqual(['C-4']);
    const panel = fixture.nativeElement.querySelector('#cancel-request-panel');
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('Duyệt hủy');
    expect(panel.textContent).toContain('Không duyệt');
  });

  it('loads server pagination and filters independently of cancellations', () => {
    const api = TestBed.inject(AdminApiService);
    const spy = vi.spyOn(api, 'getReturnRequests').mockReturnValue(of({ requests: [], total: 9, page: 2 }));
    component.returnTypeFilter = 'unclassified';
    component.returnStatusFilter = 'pending_approval';
    component.loadReturnRequests(2);
    expect(spy).toHaveBeenCalledWith({ page: 2, limit: 4, requestType: 'unclassified', status: 'pending_approval', orderType: '' });
    expect(component.returnTotal).toBe(9);
    expect(component.currentCancelPage).toBe(1);
  });

  it('requires a classification on approval and a reason for rejection', () => {
    component.selectedReturn = { availableActions: ['approve', 'reject'] };
    component.beginReturnAction('approve');
    component.submitReturnAction();
    expect(component.returnError).toContain('chọn loại');
    component.beginReturnAction('reject');
    component.submitReturnAction();
    expect(component.returnError).toContain('lý do');
    component.beginReturnAction('confirm-refund');
    expect(component.returnAction).toBe('reject');
  });

  it('labels return requests using request state instead of stale completed order status', () => {
    expect(component.getStatusLabel({ status: 'completed', returnStatusId: 'pending_approval' })).toBe('Hoàn trả: Chờ duyệt');
  });

  it('should use the matching customer avatar instead of initials', () => {
    expect(component.orders[0].customerImage).toBe('images/avatar_user2.jpeg');
    expect(component.getCustomerAvatarUrl(component.orders[0].customerImage))
      .toBe('http://localhost:3002/images/avatar_user2.jpeg');

    fixture.detectChanges();
    const avatar = fixture.nativeElement.querySelector(
      '.table-orders .customer-avatar'
    ) as HTMLImageElement;
    expect(avatar.src).toBe('http://localhost:3002/images/avatar_user2.jpeg');
  });
});
