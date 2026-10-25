import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { Product } from '../../../../../my-user/src/app/models/uri.model';

@Injectable({
  providedIn: 'root'
})
export class AdminApiService {
  private apiUrl = 'http://localhost:3002/api/products'; // Trỏ tới my-server-mongodb
  private productsSubject = new BehaviorSubject<Product[]>([]);
  public products$ = this.productsSubject.asObservable();

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.loadProducts();
  }

  public loadProducts(): void {
    this.http.get<any>(this.apiUrl).subscribe({
      next: (res) => {
        const productList = res.products || res;
        this.productsSubject.next(productList);
      },
      error: (err) => {
        console.error('Lỗi khi gọi API lấy sản phẩm:', err);
        // Fallback dữ liệu từ localStorage nếu không kết nối được server
        if (isPlatformBrowser(this.platformId)) {
          const cached = localStorage.getItem('urii_admin_products');
          if (cached) {
            this.productsSubject.next(JSON.parse(cached));
          }
        }
      }
    });
  }

  public updateProduct(id: string | number, productData: Partial<Product>): Observable<any> {
    return this.http.put(`${this.apiUrl}/${id}`, productData);
  }

  public deleteProduct(id: string | number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${id}`);
  }
}