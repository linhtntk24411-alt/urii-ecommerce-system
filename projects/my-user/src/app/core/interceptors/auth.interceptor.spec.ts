import { HttpClient, HttpHeaders, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { authInterceptor } from './auth.interceptor';
import { StorageService } from '../services/storage.service';

describe('authInterceptor', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('does not replace a request-specific authorization token', () => {
    TestBed.inject(StorageService).setToken('stale-token');
    let response: unknown;

    TestBed.inject(HttpClient)
      .get('/api/cart', { headers: new HttpHeaders({ Authorization: 'Bearer current-token' }) })
      .subscribe((value) => response = value);

    const request = http.expectOne('/api/cart');
    expect(request.request.headers.get('Authorization')).toBe('Bearer current-token');
    request.flush({ items: [] });
    expect(response).toEqual({ items: [] });
  });

  it('adds the stored token when the request does not specify one', () => {
    TestBed.inject(StorageService).setToken('stored-token');
    TestBed.inject(HttpClient).get('/api/cart').subscribe();

    const request = http.expectOne('/api/cart');
    expect(request.request.headers.get('Authorization')).toBe('Bearer stored-token');
    request.flush({ items: [] });
  });
});
