import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Product } from './product';

describe('Product', () => {
  let component: Product;
  let fixture: ComponentFixture<Product>;

  beforeEach(async () => {
    window.localStorage.removeItem('products');
    await TestBed.configureTestingModule({
      imports: [Product],
      providers: [provideRouter([])],
    }).compileComponents();

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
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
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
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('đăng nhập'));
    expect(window.localStorage.getItem('favoriteProducts')).toBeNull();

    window.localStorage.setItem('isLoggedIn', 'true');
    component.toggleFavorite(product);
    expect(window.localStorage.getItem('favoriteProducts')).toBe('["favorite-product"]');
    expect(alertSpy).toHaveBeenLastCalledWith(expect.stringContaining('Đã lưu'));

    window.localStorage.removeItem('isLoggedIn');
    window.localStorage.removeItem('favoriteProducts');
    alertSpy.mockRestore();
  });
});
