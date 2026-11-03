import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ProductDetail } from './product-detail';

describe('ProductDetail', () => {
  let component: ProductDetail;
  let fixture: ComponentFixture<ProductDetail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductDetail],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductDetail);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
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
});
