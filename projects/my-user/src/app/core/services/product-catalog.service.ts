import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';

export interface CatalogVariant {
  name: string;
  price?: number;
  stock?: number;
}

export interface CatalogProduct {
  id: string;
  name: string;
  image: string;
  price: number;
  stock?: number;
  variants: CatalogVariant[];
}

@Injectable({ providedIn: 'root' })
export class ProductCatalogService {
  private readonly http = inject(HttpClient);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  getProducts(): Observable<CatalogProduct[]> {
    return this.http.get<unknown>('/api/products').pipe(map((response) => this.parseProducts(response)));
  }

  getCachedProducts(): CatalogProduct[] {
    if (!this.isBrowser) return [];

    try {
      const cached = window.localStorage.getItem('products');
      return cached ? this.parseProducts(JSON.parse(cached)) : [];
    } catch (error) {
      console.error('Không thể đọc bộ nhớ đệm sản phẩm:', error);
      return [];
    }
  }

  private parseProducts(response: unknown): CatalogProduct[] {
    const rows = Array.isArray(response)
      ? response
      : this.isRecord(response) && Array.isArray(response['products'])
        ? response['products']
        : null;
    if (!rows) throw new Error('Máy chủ trả về danh sách sản phẩm không hợp lệ.');

    return rows.flatMap((row): CatalogProduct[] => {
      if (!this.isRecord(row)) return [];
      const rawId = row['id'] ?? row['_id'];
      const rawName = row['name'] ?? row['productName'];
      if ((typeof rawId !== 'string' && typeof rawId !== 'number') || typeof rawName !== 'string') return [];

      const rawImage = row['image'] ?? row['imageUrl'] ?? row['images'];
      const image = typeof rawImage === 'string'
        ? rawImage
        : Array.isArray(rawImage) && typeof rawImage[0] === 'string'
          ? rawImage[0]
          : '';
      const variants = Array.isArray(row['variants'])
        ? row['variants'].flatMap((variant): CatalogVariant[] => {
          if (!this.isRecord(variant) || typeof variant['name'] !== 'string') return [];
          return [{
            name: variant['name'],
            price: this.optionalNumber(variant['price']),
            stock: this.optionalNumber(variant['stock']),
          }];
        })
        : [];
      return [{
        id: String(rawId),
        name: rawName,
        image,
        price: this.toNumber(row['currentPrice'] ?? row['salePrice'] ?? row['originalPrice'] ?? row['price']),
        stock: this.optionalNumber(row['stock'] ?? row['quantity']),
        variants,
      }];
    });
  }

  private toNumber(value: unknown): number {
    return this.optionalNumber(value) ?? 0;
  }

  private optionalNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
