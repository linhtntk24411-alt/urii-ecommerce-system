import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { OrdersAdmin } from './orders-admin';
import { AdminApiService } from '../../core/services/admin-api.service';
import { OrdersAdmin } from './orders-admin';

describe('OrdersAdmin', () => {
  let component: OrdersAdmin;
  let fixture: ComponentFixture<OrdersAdmin>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrdersAdmin],
      providers: [{
        provide: AdminApiService,
        useValue: {
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
