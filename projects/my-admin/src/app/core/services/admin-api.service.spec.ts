import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminApiService } from './admin-api.service';

describe('AdminApiService', () => {
  let httpTestingController: HttpTestingController;

  beforeEach(() => {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('token');
    localStorage.removeItem('urii_admin_products');

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });

    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTestingController.verify();
    localStorage.removeItem('adminToken');
    localStorage.removeItem('token');
    localStorage.removeItem('urii_admin_products');
  });

  it('loads products when no admin token is available', () => {
    const service = TestBed.inject(AdminApiService);
    const products = [{ id: 'product-1', name: 'Test product' }];
    let receivedProducts: unknown;

    service.products$.subscribe((items) => {
      receivedProducts = items;
    });
    service.loadProducts();

    const request = httpTestingController.expectOne('http://localhost:3002/api/products');
    expect(request.request.method).toBe('GET');
    request.flush(products);

    expect(receivedProducts).toEqual(products);
    expect(localStorage.getItem('urii_admin_products')).toBe(JSON.stringify(products));
  });

  it('publishes cached products immediately after reload', () => {
    const products = [{ id: 'product-1', name: 'Cached product' }];
    localStorage.setItem('urii_admin_products', JSON.stringify(products));

    const service = TestBed.inject(AdminApiService);
    let receivedProducts: unknown;

    service.products$.subscribe((items) => {
      receivedProducts = items;
    });

    expect(receivedProducts).toEqual(products);
    httpTestingController.expectNone('http://localhost:3002/api/products');
  });
});
