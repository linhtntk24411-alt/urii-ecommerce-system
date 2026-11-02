import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CustomOrder } from './custom-order';

describe('CustomOrder', () => {
  let component: CustomOrder;
  let fixture: ComponentFixture<CustomOrder>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CustomOrder],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomOrder);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
