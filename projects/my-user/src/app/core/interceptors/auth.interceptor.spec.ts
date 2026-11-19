import { HttpClient, HttpHeaders, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { StorageService } from '../services/storage.service';

describe('authInterceptor', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

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

  it('clears the session saved by the login screen when its token is revoked', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    localStorage.setItem('authToken', 'legacy-token');
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('userId', 'customer-id');
    TestBed.inject(HttpClient).get('/api/cart', {
      headers: { Authorization: 'Bearer legacy-token' },
    }).subscribe({ error: () => {} });

    http.expectOne('/api/cart').flush({ code: 'SESSION_REVOKED' }, { status: 401, statusText: 'Unauthorized' });

    expect(localStorage.getItem('authToken')).toBeNull();
    expect(localStorage.getItem('isLoggedIn')).toBeNull();
    expect(localStorage.getItem('userId')).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { sessionError: 'SESSION_REVOKED' } });
  });

  it('clears a locked session and returns the customer to login', () => {
    const storage = TestBed.inject(StorageService);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    storage.setToken('locked-token');
    TestBed.inject(HttpClient).get('/api/cart').subscribe({ error: () => {} });

    http.expectOne('/api/cart').flush({ code: 'ACCOUNT_LOCKED' }, { status: 403, statusText: 'Forbidden' });

    expect(storage.getToken()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { sessionError: 'ACCOUNT_LOCKED' } });
  });
});
