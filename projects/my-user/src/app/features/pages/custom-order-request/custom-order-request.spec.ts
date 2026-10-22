import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CustomOrderRequest } from './custom-order-request';

describe('CustomOrderRequest', () => {
  let component: CustomOrderRequest;
  let fixture: ComponentFixture<CustomOrderRequest>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CustomOrderRequest],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomOrderRequest);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
