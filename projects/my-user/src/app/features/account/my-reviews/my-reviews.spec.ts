import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MyReviews } from './my-reviews';

describe('MyReviews', () => {
  let fixture: ComponentFixture<MyReviews>;
  let component: MyReviews;
  let httpTestingController: HttpTestingController;

  beforeEach(async () => {
    localStorage.setItem('authToken', 'customer-token');
    localStorage.setItem('isLoggedIn', 'true');
    await TestBed.configureTestingModule({
      imports: [MyReviews],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(MyReviews);
    component = fixture.componentInstance;
    httpTestingController = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpTestingController.verify();
    localStorage.removeItem('authToken');
    localStorage.removeItem('isLoggedIn');
  });

  it('shows product details, star rating, review and attached media from the API', () => {
    httpTestingController.expectOne('/api/reviews/mine').flush([{
      id: 'review-1',
      rating: 4,
      variantName: 'Đỏ',
      content: 'Sản phẩm rất đẹp.',
      createdAt: '2026-10-25T10:00:00.000Z',
      media: [{ type: 'image', url: '/images/review.png' }],
      product: { name: 'Sản phẩm thử', image: '/images/product.png' },
    }]);
    fixture.detectChanges();

    expect(component.reviews).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('Sản phẩm thử');
    expect(fixture.nativeElement.textContent).toContain('Sản phẩm rất đẹp.');
    expect(fixture.nativeElement.querySelectorAll('.review-card__star--filled')).toHaveLength(4);
    expect(fixture.nativeElement.querySelector('.review-card__media img')?.getAttribute('src'))
      .toBe('/api/images/review.png');
  });
});
