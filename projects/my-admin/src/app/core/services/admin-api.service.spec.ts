import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminApiService } from './admin-api.service';

describe('AdminApiService', () => {
  let httpTestingController: HttpTestingController;

  beforeEach(() => {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('token');
    localStorage.removeItem('urii-admin-token');
    localStorage.removeItem('adminUser');
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
    localStorage.removeItem('urii-admin-token');
    localStorage.removeItem('adminUser');
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

    const requests = httpTestingController.match('http://localhost:3002/api/products');
    expect(requests.length).toBe(2);
    for (const request of requests) {
      expect(request.request.method).toBe('GET');
      request.flush(products);
    }

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
    const requests = httpTestingController.match('http://localhost:3002/api/products');
    expect(requests.length).toBe(1);
    requests[0].flush(products);
  });

  it('clears all persisted session data on logout', () => {
    const service = TestBed.inject(AdminApiService);
    const productRequests = httpTestingController.match('http://localhost:3002/api/products');
    expect(productRequests.length).toBe(1);

    localStorage.setItem('adminToken', 'admin-token');
    localStorage.setItem('urii-admin-token', 'legacy-admin-token');
    localStorage.setItem('token', 'shared-token');
    localStorage.setItem('adminUser', '{"role":"admin"}');
    service.setToken('admin-token');

    service.logout();

    expect(service.token()).toBeNull();
    expect(localStorage.getItem('adminToken')).toBeNull();
    expect(localStorage.getItem('urii-admin-token')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('adminUser')).toBeNull();

    productRequests[0].flush([]);
  });

  it('does not create a fake session when an admin token is missing', () => {
    const service = TestBed.inject(AdminApiService);
    const productRequests = httpTestingController.match('http://localhost:3002/api/products');
    expect(productRequests.length).toBe(1);
    productRequests[0].flush([]);

    const request = service.getOrders().subscribe();
    const ordersRequest = httpTestingController.expectOne('http://localhost:3002/api/orders');
    expect(ordersRequest.request.headers.get('Authorization')).toBe('Bearer ');
    expect(localStorage.getItem('token')).toBeNull();
    ordersRequest.flush([]);
    request.unsubscribe();
  });
});
