import { DialogService } from '../../core/services/dialog.service';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { CartService } from '../../core/services/cart.service';
import { CheckoutSelectionService } from '../../core/services/checkout-selection.service';
import { ToastService } from '../../core/services/toast.service';
import { Product } from './product';

@Component({ standalone: true, template: '' })
class CheckoutRouteStub {}

describe('Product', () => {
  let component: Product;
  let fixture: ComponentFixture<Product>;

  beforeEach(async () => {
    window.localStorage.removeItem('products');
    await TestBed.configureTestingModule({
      imports: [Product],
      providers: [provideRouter([{ path: 'checkout', component: CheckoutRouteStub }])],
    }).compileComponents();

    TestBed.inject(CartService).saveItems([]);
    TestBed.inject(CheckoutSelectionService).clear();
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    fixture = TestBed.createComponent(Product);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should combine price and rating filters', () => {
    component.allProducts = [
      {
        id: 1,
        name: 'Sản phẩm A',
        category: 'KIT',
        description: '',
        image: '',
        originalPrice: 40000,
        isSale: false,
        isHot: false,
        rating: 4.5,
        reviews: 8,
        stock: 1,
        variants: [],
      },
      {
        id: 2,
        name: 'Sản phẩm B',
        category: 'kit',
        description: '',
        image: '',
        originalPrice: 60000,
        isSale: false,
        isHot: false,
        rating: 5,
        reviews: 10,
        stock: 1,
        variants: [],
      },
    ];
    component.selectedPriceRanges = ['under-50'];

    component.setRatingFilter('4.0');

    expect(component.filteredProducts.map((product) => product.id)).toEqual([1]);
    expect(component.productCountText).toBe('Hiển thị 1-1 trong số 1 sản phẩm');
  });

  it('shows a success popup after adding a product to the cart', () => {
    component.addToCart({
      id: 'toast-product',
      name: 'Sản phẩm popup',
      category: 'KIT',
      description: '',
      image: '',
      originalPrice: 50000,
      isSale: false,
      isHot: false,
      rating: 0,
      reviews: 0,
      stock: 1,
      variants: [{ name: 'Mặc định' }],
    });

    expect(TestBed.inject(CartService).getItems()).toEqual([
      { productId: 'toast-product', variant: 'Mặc định', quantity: 1 },
    ]);
    expect(TestBed.inject(ToastService).messages()[0]).toMatchObject({
      message: 'Đã thêm "Sản phẩm popup" vào giỏ hàng.',
      kind: 'success',
    });
  });

  it('buys a product directly without adding it to the cart', async () => {
    component.buyNow({
      id: 'buy-now-product',
      name: 'Mua ngay',
      category: 'KIT',
      description: '',
      image: '',
      originalPrice: 50000,
      isSale: false,
      isHot: false,
      rating: 0,
      reviews: 0,
      stock: 1,
      variants: [{ name: 'Mặc định' }],
    });
    await fixture.whenStable();

    expect(TestBed.inject(CartService).getItems()).toEqual([]);
    expect(TestBed.inject(Router).url).toBe('/checkout');
    expect(TestBed.inject(CheckoutSelectionService).get()).toEqual([
      { productId: 'buy-now-product', variant: 'Mặc định', quantity: 1 },
    ]);
    expect(TestBed.inject(CheckoutSelectionService).shouldRemoveFromCartAfterCheckout()).toBe(false);
  });

  it('should load product documents from the MongoDB API', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{
        _id: 'mongo-product-1',
        name: 'Sản phẩm MongoDB',
        category: 'kit',
        image: 'assets/product/7.png',
        originalPrice: 100000,
        currentPrice: 80000,
        stock: 5,
        variants: [{ name: 'Mặc định' }],
      }]), { status: 200 }),
    );

    await component.loadProducts();

    expect(fetchSpy).toHaveBeenCalledWith('/api/products');
    expect(component.allProducts).toHaveLength(1);
    expect(component.allProducts[0]).toMatchObject({
      id: 'mongo-product-1',
      name: 'Sản phẩm MongoDB',
      originalPrice: 100000,
      currentPrice: 80000,
      isSale: true,
    });
    component.category = 'kit';
    component.setRatingFilter('all');
    expect(component.filteredProducts.map((product) => product.id)).toEqual(['mongo-product-1']);
    fetchSpy.mockRestore();
  });

  it('should render filled rating stars from MongoDB review records', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{
        id: 'reviewed-product',
        name: 'Sản phẩm có đánh giá',
        category: 'KIT',
        originalPrice: 50000,
        rating: 4.5,
        reviewCount: 2,
      }]), { status: 200 }),
    );

    await component.loadProducts();
    fixture.detectChanges();

    expect(component.pageProducts[0].rating).toBe(4.5);
    expect(component.pageProducts[0].reviews).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('.product-rating .star.filled').length).toBe(4);
    expect(fixture.nativeElement.querySelectorAll('.product-rating .star.half').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('.product-rating .star.empty').length).toBe(0);

    fetchSpy.mockRestore();
  });

  it('should prefer API products over cached products', async () => {
    window.localStorage.setItem('products', JSON.stringify([{
      id: 'cached-product',
      name: 'Sản phẩm cũ',
      category: 'KIT',
      originalPrice: 50000,
    }]));
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{
        id: 'api-product',
        name: 'Sản phẩm mới từ API',
        category: 'KIT',
        originalPrice: 75000,
      }]), { status: 200 }),
    );
    component.allProducts = [];
    component.filteredProducts = [];

    const loadPromise = component.loadProducts();
    expect(component.allProducts).toEqual([]);
    await loadPromise;

    expect(component.allProducts.map((product) => product.name)).toEqual(['Sản phẩm mới từ API']);

    fetchSpy.mockRestore();
    window.localStorage.removeItem('products');
  });

  it('should show cached products while the API is unavailable', async () => {
    window.localStorage.setItem('products', JSON.stringify([{
      id: 'cached-product',
      name: 'Sản phẩm đã lưu',
      category: 'KIT',
      originalPrice: 50000,
    }]));
    const fetchSpy = vi.spyOn(window, 'fetch').mockRejectedValue(new Error('API unavailable'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await component.loadProducts();

    expect(component.loading).toBe(false);
    expect(component.pageProducts[0]?.name).toBe('Sản phẩm đã lưu');
    expect(component.refreshFailed).toBe(true);

    fetchSpy.mockRestore();
    consoleSpy.mockRestore();
    window.localStorage.removeItem('products');
  });

  it('should require login before saving a favorite product', () => {
    const dialogService = TestBed.inject(DialogService);
    const promptSpy = vi.spyOn(dialogService, 'promptLogin');
    const alertSpy = vi.spyOn(dialogService, 'alert').mockResolvedValue(undefined);
    const product = {
      id: 'favorite-product',
      name: 'Sản phẩm yêu thích',
      category: 'KIT',
      description: '',
      image: '',
      originalPrice: 50000,
      isSale: false,
      isHot: false,
      rating: 0,
      reviews: 0,
      stock: 1,
      variants: [],
    };

    component.toggleFavorite(product);
    expect(promptSpy).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('Đăng nhập'),
    }));
    expect(window.localStorage.getItem('favoriteProducts')).toBeNull();

    window.localStorage.setItem('isLoggedIn', 'true');
    component.toggleFavorite(product);
    expect(window.localStorage.getItem('favoriteProducts')).toBe('["favorite-product"]');
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Đã lưu'), expect.any(String), 'success');

    window.localStorage.removeItem('isLoggedIn');
    window.localStorage.removeItem('favoriteProducts');
  });
});
