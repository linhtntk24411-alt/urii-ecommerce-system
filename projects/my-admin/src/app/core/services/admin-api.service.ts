import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
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
    this.loadProducts();
  }

  // --- 1. QUẢN LÝ SẢN PHẨM ---
  public loadProducts(): void {
    this.http.get<any>(`${this.baseUrl}/products`).subscribe({
      next: (res) => {
        const productList = res.products || res;
        this.productsSubject.next(productList);
        if (isPlatformBrowser(this.platformId)) {
          localStorage.setItem('urii_admin_products', JSON.stringify(productList));
        }
      },
      error: (err) => {
        console.error('Lỗi khi gọi API lấy sản phẩm:', err);
        if (isPlatformBrowser(this.platformId)) {
          const cached = localStorage.getItem('urii_admin_products');
          if (cached) {
            this.productsSubject.next(JSON.parse(cached));
          }
        }
      }
    });
  }

  // Thêm sản phẩm mới
  public addProduct(productData: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/products`, productData).pipe(
      tap(() => this.loadProducts())
    );
  }

  // Cập nhật sản phẩm (hỗ trợ cả id số hoặc _id của MongoDB)
  public updateProduct(id: string | number, productData: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/products/${id}`, productData).pipe(
      tap(() => this.loadProducts()) 
    );
  }

  // Xóa sản phẩm
  public deleteProduct(id: string | number): Observable<any> {
    return this.http.delete(`${this.baseUrl}/products/${id}`).pipe(
      tap(() => this.loadProducts()) 
    );
  }

  // --- 2. QUẢN LÝ ĐƠN HÀNG ---
  public getOrders(): Observable<any> {
    return this.http.get(`${this.baseUrl}/orders`);
  }

  public updateOrderStatus(id: string, status: string): Observable<any> {
    return this.http.put(`${this.baseUrl}/orders/${id}`, { status });
  }

  // --- 3. QUẢN LÝ THƯ VIỆN MAP MẪU ---
  public getLibraryMaps(): Observable<any> {
    return this.http.get(`${this.baseUrl}/library-maps`);
  }

  public saveLibraryMap(mapData: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/library-maps`, mapData);
  }

  public deleteLibraryMap(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/library-maps/${id}`);
  }
}