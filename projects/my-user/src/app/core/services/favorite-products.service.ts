import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { catchError, firstValueFrom, map, Observable, of, tap } from 'rxjs';
import { StorageService } from './storage.service';

const FAVORITES_KEY = 'favoriteProducts';

export interface LikedProductResponse {
  id?: string;
  _id?: string;
  userId?: string;
  productId: string;
  liked?: boolean;
  product?: unknown;
}

@Injectable({ providedIn: 'root' })
export class FavoriteProductsService {
  private readonly http = inject(HttpClient, { optional: true });
  private readonly storage = inject(StorageService, { optional: true });
  private readonly platformId = inject(PLATFORM_ID);

  private isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  private getToken(): string {
    if (!this.isBrowser()) return '';
    return (
      localStorage.getItem('authToken') ||
      localStorage.getItem('urii.auth.token') ||
      this.storage?.getToken() ||
      ''
    );
  }

  getProductIds(): string[] {
    if (!this.isBrowser()) return [];
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
      return Array.isArray(saved)
        ? saved.filter((id): id is string => typeof id === 'string')
        : [];
    } catch (error) {
      console.error('Không thể đọc danh sách sản phẩm yêu thích:', error);
      return [];
    }
  }

  has(productId: string | number): boolean {
    return this.getProductIds().includes(String(productId));
  }

  saveProductIds(ids: string[]): void {
    if (!this.isBrowser()) return;
    const uniqueIds = Array.from(new Set(ids.map((id) => String(id)).filter(Boolean)));
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(uniqueIds));
    } catch (error) {
      console.error('Không thể lưu danh sách sản phẩm yêu thích:', error);
      throw error;
    }
  }

  /**
   * Đồng bộ danh sách yêu thích từ API backend MongoDB (/api/liked-products/mine).
   * Dữ liệu ban đầu xuất phát từ liked_products.json được seed vào MongoDB.
   */
  fetchMine(): Observable<string[]> {
    if (!this.isBrowser()) return of(this.getProductIds());
    const token = this.getToken();
    if (!this.http || !token) {
      return of(this.getProductIds());
    }

    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    return this.http.get<LikedProductResponse[]>('/api/liked-products/mine', { headers }).pipe(
      map((records) => {
        if (!Array.isArray(records)) return [];
        return records
          .map((record) => {
            if (!record) return '';
            const prod = record.product as { id?: string | number } | undefined;
            return String(record.productId || prod?.id || '');
          })
          .filter(Boolean);
      }),
      tap((ids) => {
        this.saveProductIds(ids);
      }),
      catchError((error) => {
        console.error('Lỗi khi tải danh sách sản phẩm yêu thích từ server:', error);
        return of(this.getProductIds());
      })
    );
  }

  async syncWithServer(): Promise<string[]> {
    if (!this.isBrowser()) return this.getProductIds();
    const token = this.getToken();
    if (!this.http || !token) return this.getProductIds();
    try {
      return await firstValueFrom(this.fetchMine());
    } catch {
      return this.getProductIds();
    }
  }

  toggle(productId: string | number): boolean {
    const ids = this.getProductIds();
    const normalizedId = String(productId);
    const index = ids.indexOf(normalizedId);
    const isSaved = index < 0;

    if (isSaved) {
      ids.push(normalizedId);
    } else {
      ids.splice(index, 1);
    }

    this.saveProductIds(ids);

    const token = this.getToken();
    if (this.http && token) {
      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
      if (isSaved) {
        this.http
          .post('/api/liked-products/mine', { productId: normalizedId }, { headers })
          .subscribe({
            error: (err) => console.error('Lỗi lưu yêu thích lên server:', err),
          });
      } else {
        this.http
          .delete(`/api/liked-products/mine/${encodeURIComponent(normalizedId)}`, { headers })
          .subscribe({
            error: (err) => console.error('Lỗi xóa yêu thích trên server:', err),
          });
      }
    }

    return isSaved;
  }
}
