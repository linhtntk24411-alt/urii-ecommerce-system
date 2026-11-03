import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { CustomOrderComponent } from './custom-order';

describe('CustomOrderComponent', () => {
  let component: CustomOrderComponent;
  let fixture: ComponentFixture<CustomOrderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CustomOrderComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomOrderComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('accepts a Vietnamese phone number with the +84 country code', () => {
    component.customOrderForm.patchValue({
      fullName: 'Nguyễn Hồng',
      phone: '+84373155184',
      email: 'hong@example.com',
      requestName: 'Chân dung',
      description: 'Chân dung 15 x 15',
    });

    component.nextStep();

    expect(component.currentStep).toBe(2);
    expect(component.errorMessage).toBe('');
  });

  it('shows a clear validation message for an invalid phone number', () => {
    component.customOrderForm.patchValue({
      fullName: 'Nguyễn Hồng',
      phone: '12345',
      email: 'hong@example.com',
      requestName: 'Chân dung',
      description: 'Chân dung 15 x 15',
    });

    component.nextStep();

    expect(component.currentStep).toBe(1);
    expect(component.errorMessage).toContain('0xxxxxxxxx hoặc +84xxxxxxxxx');
    expect(component.customOrderForm.get('phone')?.touched).toBe(true);
  });
});
