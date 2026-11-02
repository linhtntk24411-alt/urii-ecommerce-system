import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AdminApiService {
  private baseUrl = 'http://localhost:3002/api'; // Trỏ tới server Node.js tổng

  private productsSubject = new BehaviorSubject<any[]>([]);
  public products$ = this.productsSubject.asObservable();

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.productsSubject.next(this.readCachedProducts());
  }

// Thêm biến giữ token trong bộ nhớ RAM
private currentAuthToken = '';

// Hàm nhận token trực tiếp từ trang login truyền qua
public setToken(token: string) {
  this.currentAuthToken = token;
}

// Cập nhật lại hàm lấy header để ưu tiên lấy biến RAM này trước, nếu không có mới tìm localStorage
private getAuthHeaders(): HttpHeaders {
  let token = this.currentAuthToken; // Lấy từ RAM nếu vừa đăng nhập
  
  if (!token && isPlatformBrowser(this.platformId)) {
    // Nếu F5 lại, bắt buộc lùng sục trong localStorage
    token = localStorage.getItem('adminToken') || localStorage.getItem('token') || '';
  }

  return new HttpHeaders({
    'Authorization': `Bearer ${token}`
  });
}

  // --- 1. QUẢN LÝ SẢN PHẨM ---
 public loadProducts(): void {
  // Chỉ chạy trên trình duyệt để tránh lỗi SSR không đọc được localStorage
  if (!isPlatformBrowser(this.platformId)) {
    return;
  }

  let token = this.currentAuthToken;
  if (!token) {
    token = localStorage.getItem('adminToken') || localStorage.getItem('token') || '';
  }

  const headers = new HttpHeaders({
    'Authorization': `Bearer ${token}`
  });

  this.http.get<any>(`${this.baseUrl}/products`, { headers }).subscribe({
    next: (res) => {
      const productList = Array.isArray(res) ? res : res?.products;
      if (!Array.isArray(productList)) {
        console.error('API sản phẩm trả về dữ liệu không hợp lệ:', res);
        return;
      }

      this.productsSubject.next(productList);
      try {
        localStorage.setItem('urii_admin_products', JSON.stringify(productList));
      } catch (error) {
        console.error('Không thể lưu cache sản phẩm:', error);
      }
    },
    error: (err) => {
      console.error('Lỗi tải sản phẩm:', err);
      this.productsSubject.next(this.readCachedProducts());
    }
  });
}

private readCachedProducts(): any[] {
  if (!isPlatformBrowser(this.platformId)) {
    return [];
  }

  try {
    const cached = localStorage.getItem('urii_admin_products');
    if (!cached) {
      return [];
    }

    const products = JSON.parse(cached);
    if (Array.isArray(products)) {
      return products;
    }
    console.error('Cache sản phẩm không đúng định dạng.');
  } catch (error) {
    console.error('Không thể đọc cache sản phẩm:', error);
  }

  return [];
}

  // Thêm sản phẩm mới (Đã có gắn Token)
  public addProduct(productData: any): Observable<any> {
    const headers = this.getAuthHeaders();
    return this.http.post(`${this.baseUrl}/products`, productData, { headers }).pipe(
      tap(() => this.loadProducts())
    );
  }

  // Cập nhật sản phẩm (Đã có gắn Token)
  public updateProduct(id: string | number, productData: any): Observable<any> {
    const headers = this.getAuthHeaders();
    return this.http.put(`${this.baseUrl}/products/${id}`, productData, { headers }).pipe(
      tap(() => this.loadProducts()) 
    );
  }
  public deleteProduct(id: string | number): Observable<any> {
  const headers = this.getAuthHeaders();
  return this.http.delete(`${this.baseUrl}/products/${id}`, { headers }).pipe(
    tap(() => this.loadProducts()) 
  );
}

  // --- 2. QUẢN LÝ ĐƠN HÀNG ---
  // Lấy danh sách đơn hàng từ MongoDB
public getOrders(): Observable<any> {
  let token = this.currentAuthToken;

  if (!token && isPlatformBrowser(this.platformId)) {
    token = localStorage.getItem('adminToken') || localStorage.getItem('token') || '';
  }

  const headers = new HttpHeaders({
    Authorization: `Bearer ${token}`
  });

  return this.http.get<any>(`${this.baseUrl}/orders`, { headers });
}
  // Cập nhật đơn hàng trên MongoDB
public updateOrder(id: string, data: any): Observable<any> {
  let token = this.currentAuthToken;

  if (!token && isPlatformBrowser(this.platformId)) {
    token = localStorage.getItem('adminToken') || localStorage.getItem('token') || '';
  }

  const headers = new HttpHeaders({
    Authorization: `Bearer ${token}`
  });

  return this.http.patch(
    `${this.baseUrl}/orders/${encodeURIComponent(id)}`,
    data,
    { headers }
  );
}

// Xóa đơn hàng trên MongoDB
public deleteOrder(id: string): Observable<any> {
  let token = this.currentAuthToken;

  if (!token && isPlatformBrowser(this.platformId)) {
    token = localStorage.getItem('adminToken') || localStorage.getItem('token') || '';
  }

  const headers = new HttpHeaders({
    Authorization: `Bearer ${token}`
  });

  return this.http.delete(
    `${this.baseUrl}/orders/${encodeURIComponent(id)}`,
    { headers }
  );
}
  // --- 3. QUẢN LÝ THƯ VIỆN MAP MẪU ---
  public getLibraryMaps(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/maps`);
  }

  public getLibraryMapImageUrl(imagePath: string): string {
    const normalizedPath = imagePath.replace(/^(\.\.\/)+/, '').replace(/^\/+/, '');
    return `${this.baseUrl.replace(/\/api$/, '')}/${normalizedPath}`;
  }

  public saveLibraryMap(mapData: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/maps`, mapData);
  }

  public deleteLibraryMap(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/maps/${encodeURIComponent(id)}`);
  }
}