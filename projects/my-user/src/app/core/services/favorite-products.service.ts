import { Injectable } from '@angular/core';

const FAVORITES_KEY = 'favoriteProducts';

@Injectable({ providedIn: 'root' })
export class FavoriteProductsService {
  getProductIds(): string[] {
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

    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
    } catch (error) {
      console.error('Không thể lưu danh sách sản phẩm yêu thích:', error);
      throw error;
    }

    return isSaved;
  }
}
