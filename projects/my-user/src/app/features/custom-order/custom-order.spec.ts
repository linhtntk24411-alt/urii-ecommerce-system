import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { CustomOrderComponent } from './custom-order';

describe('CustomOrderComponent', () => {
  let component: CustomOrderComponent;
  let fixture: ComponentFixture<CustomOrderComponent>;
  let httpTestingController: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();
    vi.restoreAllMocks();
    await TestBed.configureTestingModule({
      imports: [CustomOrderComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomOrderComponent);
    component = fixture.componentInstance;
    httpTestingController = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows that the custom order will be sent to the admin instead of showing an estimated price', async () => {
    const steps = fixture.nativeElement.querySelectorAll('.step') as NodeListOf<HTMLElement>;
    steps[2].click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.currentStep).toBe(3);
    expect(fixture.nativeElement.textContent).toContain('Gửi yêu cầu đến admin');
    expect(fixture.nativeElement.textContent).toContain('Admin sẽ liên hệ tư vấn và báo giá');
    expect(fixture.nativeElement.textContent).not.toContain('Báo giá dự kiến');
    expect(fixture.nativeElement.textContent).not.toContain('200,000đ');
  });

  it('accepts a Vietnamese phone number with the +84 country code', () => {
    component.customOrderForm.patchValue({
      fullName: 'Nguyễn Hồng',
      phone: '+84373155184',
      email: 'hong@example.com',
      requestName: 'Chân dung',
      size: '15 x 15 cm',
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
      size: '15 x 15 cm',
      description: 'Chân dung 15 x 15',
    });

    component.nextStep();

    expect(component.currentStep).toBe(1);
    expect(component.errorMessage).toContain('0xxxxxxxxx hoặc +84xxxxxxxxx');
    expect(component.customOrderForm.get('phone')?.touched).toBe(true);
  });

  it('requires login before submitting a custom order', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    await component.onSubmit();

    expect(alertSpy).toHaveBeenCalledWith('Hãy đăng nhập để gửi yêu cầu Custom');
    expect(navigateSpy).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/' },
    });
    httpTestingController.expectNone('/api/custom-orders');
  });

  it('creates an authenticated custom order without requiring an image', async () => {
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('authToken', 'customer-token');
    component.customOrderForm.patchValue({
      fullName: 'Nguyễn Hồng',
      phone: '+84373155184',
      email: 'hong@example.com',
      requestName: 'Chân dung',
      size: '15 x 15 cm',
      beadType: 'Hạt Perler 5mm (Midi Beads)',
      description: 'Chân dung theo ảnh mẫu',
    });

    const submitPromise = component.onSubmit();
    const request = httpTestingController.expectOne('/api/custom-orders');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer customer-token');
    expect(request.request.body).toMatchObject({
      fullName: 'Nguyễn Hồng',
      requestName: 'Chân dung',
      size: '15 x 15 cm',
      beadType: 'Hạt Perler 5mm (Midi Beads)',
      description: 'Chân dung theo ảnh mẫu',
    });
    expect(request.request.body).not.toHaveProperty('imageUrl');
    request.flush({ message: 'Created' });
    await submitPromise;

    expect(component.hasSubmitted).toBe(true);
    expect(component.successMessage).toContain('Đã gửi yêu cầu đơn đặt hàng thành công');
    expect(component.currentStep).toBe(1);
    expect(component.customOrderForm.controls['fullName'].value).toBeNull();
  });

  it('uploads a selected image as a raw image body before creating the custom order', async () => {
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('authToken', 'customer-token');
    component.customOrderForm.patchValue({
      fullName: 'Nguyễn Hồng',
      phone: '+84373155184',
      email: 'hong@example.com',
      requestName: 'Chân dung',
      size: '15 x 15 cm',
      beadType: 'Hạt Perler 5mm (Midi Beads)',
      description: 'Chân dung theo ảnh mẫu',
    });
    component.selectedImage = new File(['image'], 'portrait.png', { type: 'image/png' });

    const submitPromise = component.onSubmit();
    const uploadRequest = httpTestingController.expectOne('/api/upload');
    expect(uploadRequest.request.method).toBe('POST');
    expect(uploadRequest.request.headers.get('Authorization')).toBe('Bearer customer-token');
    expect(uploadRequest.request.headers.get('Content-Type')).toBe('image/png');
    expect(uploadRequest.request.body).toBeInstanceOf(File);
    uploadRequest.flush({ imageUrl: '/uploads/portrait.png' });
    await Promise.resolve();

    const orderRequest = httpTestingController.expectOne('/api/custom-orders');
    expect(orderRequest.request.body.imageUrl).toBe('/uploads/portrait.png');
    orderRequest.flush({ message: 'Created' });
    await submitPromise;

    expect(component.hasSubmitted).toBe(true);
  });

  it('sends a public image URL without uploading a file', async () => {
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('authToken', 'customer-token');
    component.customOrderForm.patchValue({
      fullName: 'Nguyễn Hồng',
      phone: '+84373155184',
      email: 'hong@example.com',
      requestName: 'Chân dung',
      size: '15 x 15 cm',
      beadType: 'Hạt Perler 5mm (Midi Beads)',
      description: 'Chân dung theo ảnh mẫu',
      imageUrl: '/images/uploads/portrait.png',
    });

    const submitPromise = component.onSubmit();
    const request = httpTestingController.expectOne('/api/custom-orders');
    expect(request.request.body.imageUrl).toBe('/images/uploads/portrait.png');
    httpTestingController.expectNone('/api/upload');
    request.flush({ message: 'Created' });
    await submitPromise;

    expect(component.hasSubmitted).toBe(true);
    expect(component.customOrderForm.controls['imageUrl'].value).toBeNull();
  });

  it('rejects invalid public image URLs without sending a request', async () => {
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('authToken', 'customer-token');
    component.customOrderForm.patchValue({
      fullName: 'Nguyễn Hồng',
      phone: '+84373155184',
      email: 'hong@example.com',
      requestName: 'Chân dung',
      size: '15 x 15 cm',
      description: 'Chân dung theo ảnh mẫu',
      imageUrl: 'javascript:alert(1)',
    });

    await component.onSubmit();

    expect(component.errorMessage).toContain('URL http/https');
    httpTestingController.expectNone('/api/upload');
    httpTestingController.expectNone('/api/custom-orders');
  });
});
