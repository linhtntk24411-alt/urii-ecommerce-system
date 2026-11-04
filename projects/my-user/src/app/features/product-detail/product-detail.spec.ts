import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { CartService } from '../../core/services/cart.service';
import { CheckoutSelectionService } from '../../core/services/checkout-selection.service';
import { ToastService } from '../../core/services/toast.service';
import { ProductDetail } from './product-detail';

@Component({ standalone: true, template: '' })
class CheckoutRouteStub {}

describe('ProductDetail', () => {
  let component: ProductDetail;
  let fixture: ComponentFixture<ProductDetail>;

  beforeEach(async () => {
    window.localStorage.removeItem('products');
    await TestBed.configureTestingModule({
      imports: [ProductDetail],
      providers: [provideRouter([{ path: 'checkout', component: CheckoutRouteStub }])],
    }).compileComponents();

    TestBed.inject(CartService).saveItems([]);
    TestBed.inject(CheckoutSelectionService).clear();
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    fixture = TestBed.createComponent(ProductDetail);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows a success popup after adding a product variant to the cart', () => {
    component.product = {
      id: 'detail-toast-product',
      slug: 'detail-toast-product',
      name: 'Sản phẩm chi tiết',
      image: '',
      description: '',
      rating: 0,
      reviews: 0,
      stock: 4,
      originalPrice: 50000,
      customerReviews: [],
      variants: [{ name: 'Màu đỏ' }],
    };
    component.selectedVariant = component.product.variants?.[0] ?? null;
    component.addToCart();

    expect(TestBed.inject(CartService).getItems()).toEqual([
      { productId: 'detail-toast-product', variant: 'Màu đỏ', quantity: 1 },
    ]);
    expect(TestBed.inject(ToastService).messages()[0]).toMatchObject({
      message: 'Đã thêm "Sản phẩm chi tiết" vào giỏ hàng.',
      kind: 'success',
    });
  });

  it('buys the selected variant directly without adding it to the cart', async () => {
    component.product = {
      id: 'direct-detail-product',
      slug: 'direct-detail-product',
      name: 'Mua ngay chi tiết',
      image: '',
      description: '',
      rating: 0,
      reviews: 0,
      stock: 4,
      originalPrice: 50000,
      customerReviews: [],
      variants: [{ name: 'Màu xanh' }],
    };
    component.selectedVariant = component.product.variants?.[0] ?? null;
    component.buyNow();
    await fixture.whenStable();

    expect(TestBed.inject(CartService).getItems()).toEqual([]);
    expect(TestBed.inject(Router).url).toBe('/checkout');
    expect(TestBed.inject(CheckoutSelectionService).get()).toEqual([
      { productId: 'direct-detail-product', variant: 'Màu xanh', quantity: 1 },
    ]);
    expect(TestBed.inject(CheckoutSelectionService).shouldRemoveFromCartAfterCheckout()).toBe(false);
  });

  it('should display the cached product when the API is unavailable', async () => {
    window.localStorage.setItem('products', JSON.stringify([{
      id: 'cached-product',
      slug: 'cached-product',
      name: 'Sản phẩm đã lưu',
      image: 'assets/product/7.png',
      description: 'Dữ liệu cache',
      rating: 5,
      reviews: 2,
      stock: 3,
      originalPrice: 50000,
    }]));
    const fetchSpy = vi.spyOn(window, 'fetch').mockRejectedValue(new Error('API unavailable'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await component.loadProduct('cached-product');

    expect(component.product?.name).toBe('Sản phẩm đã lưu');
    expect(component.statusMessage).toContain('dữ liệu đã lưu');
    expect(component.errorMessage).toBe('');

    fetchSpy.mockRestore();
    consoleSpy.mockRestore();
    window.localStorage.removeItem('products');
  });

  it('should load the matching product from the API by slug', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{
        _id: 'mongo-product-1',
        id: 'mongo-product-1',
        slug: 'mongo-product',
        name: 'Sản phẩm từ API',
        image: 'assets/product/7.png',
        description: 'Dữ liệu API',
        originalPrice: 75000,
        stock: 4,
      }]), { status: 200 }),
    );

    await component.loadProduct('mongo-product');

    expect(fetchSpy).toHaveBeenCalledWith('/api/products');
    expect(component.product?.name).toBe('Sản phẩm từ API');
    expect(component.statusMessage).toBe('');
    expect(component.errorMessage).toBe('');

    fetchSpy.mockRestore();
  });

  it('should select a single variant by index, even when variant names match', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{
        id: 'variant-product',
        slug: 'variant-product',
        name: 'Sản phẩm nhiều phân loại',
        originalPrice: 68000,
        variants: [
          { name: 'Từ 6 tuổi trở lên', price: 68000, stock: 54 },
          { name: 'Từ 6 tuổi trở lên', price: 128700, stock: 23 },
        ],
      }]), { status: 200 }),
    );

    await component.loadProduct('variant-product');
    expect(component.selectedVariantIndex).toBe(0);

    const selected = component.product?.variants?.[1];
    expect(selected).toBeDefined();
    component.selectProductVariant(selected!, 1);

    expect(component.selectedVariantIndex).toBe(1);
    expect(component.displayPrice).toBe(128700);
    expect(component.availableStock).toBe(23);

    fetchSpy.mockRestore();
  });

  it('should display customer reviews with their product variant, photos and videos', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      if (String(input).startsWith('/api/reviews/product/')) {
        return new Response(JSON.stringify({
          productName: 'Sản phẩm được đánh giá',
          reviews: [{
            id: 'review-1',
            customerName: 'Nguyễn An',
            rating: 5,
            comment: 'Đúng mô tả, đóng gói cẩn thận.',
            variantName: 'Màu đỏ',
            images: ['/images/review-photo.jpg'],
            videos: ['/images/review-video.mp4'],
          }],
        }), { status: 200 });
      }

      return new Response(JSON.stringify([{
        id: 'reviewed-product',
        slug: 'reviewed-product',
        name: 'Sản phẩm được đánh giá',
        rating: 5,
        reviewCount: 1,
      }]), { status: 200 });
    });

    await component.loadProduct('reviewed-product');
    fixture.detectChanges();

    expect(fetchSpy).toHaveBeenCalledWith('/api/reviews/product/reviewed-product');
    expect(component.averageReviewRating).toBe(5);
    expect(component.reviewCount).toBe(1);
    expect(component.filteredCustomerReviews[0].variantName).toBe('Màu đỏ');
    expect(fixture.nativeElement.textContent).toContain('Sản phẩm được đánh giá');
    expect(fixture.nativeElement.textContent).toContain('Màu đỏ');
    expect(fixture.nativeElement.querySelectorAll('.product-rating-stars .bi-star-fill').length)
      .toBe(5);
    expect(fixture.nativeElement.querySelector('.review-media-image img')?.getAttribute('src'))
      .toBe('/images/review-photo.jpg');
    expect(fixture.nativeElement.querySelector('.review-media-video')?.getAttribute('src'))
      .toBe('/images/review-video.mp4');

    component.setReviewMediaFilter('photos');
    expect(component.filteredCustomerReviews).toHaveLength(1);
    component.setReviewRatingFilter(4);
    expect(component.filteredCustomerReviews).toHaveLength(0);
    component.resetReviewFilters();
    expect(component.filteredCustomerReviews).toHaveLength(1);

    fetchSpy.mockRestore();
  });
});
