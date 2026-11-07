import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OrdersAdmin } from './orders-admin';

describe('OrdersAdmin', () => {
  let component: OrdersAdmin;
  let fixture: ComponentFixture<OrdersAdmin>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrdersAdmin],
    }).compileComponents();

    fixture = TestBed.createComponent(OrdersAdmin);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
