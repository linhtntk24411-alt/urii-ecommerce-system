import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { FavoriteProductsService } from './favorite-products.service';

describe('FavoriteProductsService', () => {
  let service: FavoriteProductsService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        FavoriteProductsService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(FavoriteProductsService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    localStorage.clear();
  });

  it('reads empty list when nothing is stored', () => {
    expect(service.getProductIds()).toEqual([]);
    expect(service.has('1075483767')).toBe(false);
  });

  it('synchronizes liked product IDs from MongoDB API /api/liked-products/mine', () => {
    localStorage.setItem('authToken', 'test-token');

    let resolvedIds: string[] = [];
    service.fetchMine().subscribe((ids) => {
      resolvedIds = ids;
    });

    const req = httpTesting.expectOne('/api/liked-products/mine');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe('Bearer test-token');

    req.flush([
      { productId: '1075483767', liked: true, product: { id: '1075483767', name: 'Product 1' } },
      { productId: '1075483768', liked: true, product: { id: '1075483768', name: 'Product 2' } },
    ]);

    expect(resolvedIds).toEqual(['1075483767', '1075483768']);
    expect(service.has('1075483767')).toBe(true);
    expect(service.has('1075483768')).toBe(true);
    expect(service.has('9999999999')).toBe(false);
    expect(localStorage.getItem('favoriteProducts')).toBe(JSON.stringify(['1075483767', '1075483768']));
  });

  it('posts to /api/liked-products/mine when adding a favorite', () => {
    localStorage.setItem('authToken', 'test-token');

    const isSaved = service.toggle('1075483767');
    expect(isSaved).toBe(true);
    expect(service.has('1075483767')).toBe(true);

    const req = httpTesting.expectOne('/api/liked-products/mine');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ productId: '1075483767' });
    req.flush({ id: 'liked-user-1075483767', productId: '1075483767' });
  });

  it('sends DELETE to /api/liked-products/mine/:productId when removing a favorite', () => {
    localStorage.setItem('authToken', 'test-token');
    service.saveProductIds(['1075483767']);

    const isSaved = service.toggle('1075483767');
    expect(isSaved).toBe(false);
    expect(service.has('1075483767')).toBe(false);

    const req = httpTesting.expectOne('/api/liked-products/mine/1075483767');
    expect(req.request.method).toBe('DELETE');
    req.flush({ message: 'Đã bỏ thích sản phẩm.' });
  });
});
