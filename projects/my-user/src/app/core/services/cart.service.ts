import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface CartItem {
  productId: string;
  variant: string | null;
  quantity: number;
}

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  getItems(): CartItem[] {
    if (!this.isBrowser) return [];

    const key = this.storageKey();
    let saved = window.localStorage.getItem(key);
    if (saved === null && key === 'cartItems:guest') {
      saved = window.localStorage.getItem('cartItems');
      if (saved !== null) {
        window.localStorage.setItem(key, saved);
        window.localStorage.removeItem('cartItems');
      }
    }
    if (saved === null) return [];

    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) {
      throw new Error('Dữ liệu giỏ hàng không đúng định dạng.');
    }

    return parsed.map((item: unknown) => {
      if (!this.isRecord(item)) {
        throw new Error('Dữ liệu một sản phẩm trong giỏ hàng không hợp lệ.');
      }
      const productId = item['productId'] ?? item['id'];
      const quantity = item['quantity'];
      const variant = item['variant'];
      if (
        (typeof productId !== 'string' && typeof productId !== 'number')
        || typeof quantity !== 'number'
        || !Number.isInteger(quantity)
        || quantity < 1
        || (variant !== null && variant !== undefined && typeof variant !== 'string')
      ) {
        throw new Error('Thông tin sản phẩm trong giỏ hàng không hợp lệ.');
      }
      return {
        productId: String(productId),
        variant: typeof variant === 'string' ? variant : null,
        quantity,
      };
    });
  }

  addItem(item: CartItem): void {
    const items = this.getItems();
    const existing = items.find(
      (current) => current.productId === item.productId && current.variant === item.variant,
    );
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      items.push({ ...item });
    }
    this.saveItems(items);
  }

  updateQuantity(productId: string, variant: string | null, quantity: number): void {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error('Số lượng phải lớn hơn 0.');
    }
    const items = this.getItems();
    const item = items.find((current) => current.productId === productId && current.variant === variant);
    if (!item) throw new Error('Không tìm thấy sản phẩm trong giỏ hàng.');
    item.quantity = quantity;
    this.saveItems(items);
  }

  changeVariant(productId: string, currentVariant: string | null, newVariant: string | null): void {
    const items = this.getItems();
    const currentIndex = items.findIndex(
      (item) => item.productId === productId && item.variant === currentVariant,
    );
    if (currentIndex === -1) throw new Error('Không tìm thấy sản phẩm trong giỏ hàng.');
    if (currentVariant === newVariant) return;

    const current = items[currentIndex];
    const matching = items.find(
      (item, index) => index !== currentIndex && item.productId === productId && item.variant === newVariant,
    );
    if (matching) {
      matching.quantity += current.quantity;
      items.splice(currentIndex, 1);
    } else {
      current.variant = newVariant;
    }
    this.saveItems(items);
  }

  removeItem(productId: string, variant: string | null): void {
    this.saveItems(this.getItems().filter(
      (item) => item.productId !== productId || item.variant !== variant,
    ));
  }

  removePurchasedItems(purchased: CartItem[]): void {
    const remaining = this.getItems().flatMap((item) => {
      const bought = purchased
        .filter((entry) => entry.productId === item.productId && entry.variant === item.variant)
        .reduce((sum, entry) => sum + entry.quantity, 0);
      const quantity = item.quantity - bought;
      return quantity > 0 ? [{ ...item, quantity }] : [];
    });
    this.saveItems(remaining);
  }

  getItemCount(): number {
    return this.getItems().reduce((sum, item) => sum + item.quantity, 0);
  }

  saveItems(items: CartItem[]): void {
    if (!this.isBrowser) return;
    window.localStorage.setItem(this.storageKey(), JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('cart:updated'));
  }

  private storageKey(): string {
    if (window.localStorage.getItem('isLoggedIn') !== 'true') return 'cartItems:guest';
    const userId = window.localStorage.getItem('userId');
    return userId ? `cartItems:user:${userId}` : 'cartItems:guest';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
