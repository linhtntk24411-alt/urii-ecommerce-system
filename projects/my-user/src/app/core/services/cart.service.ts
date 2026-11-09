import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  Observable,
  catchError,
  concatMap,
  finalize,
  from,
  last,
  map,
  of,
  shareReplay,
  tap,
  throwError,
} from 'rxjs';

export interface CartItem {
  productId: string;
  variant: string | null;
  quantity: number;
  itemId?: string;
  variantIndex?: number | null;
  selected?: boolean;
}

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly http = inject(HttpClient);
  private readonly pendingUploads = new Map<string, Observable<CartItem[]>>();

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
    return saved === null ? [] : this.readItems(key);
  }

  loadItems(): Observable<CartItem[]> {
    if (!this.isAuthenticatedUser()) return of(this.getItems());
    return this.http.get<unknown>('/api/cart', { headers: this.authorizationHeaders() }).pipe(
      map((response) => this.parseApiCart(response)),
      concatMap((serverItems) => {
        const userId = window.localStorage.getItem('userId')!;
        const migrationKey = `cartItems:migrated:${userId}`;
        const pendingKey = `cartItems:pending:${userId}`;
        if (window.localStorage.getItem(pendingKey) !== null) {
          return this.uploadPendingItems(userId).pipe(
            tap(() => window.localStorage.setItem(migrationKey, 'true')),
          );
        }
        if (serverItems.length > 0) {
          window.localStorage.setItem(migrationKey, 'true');
          return of(serverItems);
        }

        const cachedItems = this.getItems();
        if (cachedItems.length === 0) {
          window.localStorage.setItem(migrationKey, 'true');
          return of(serverItems);
        }

        window.localStorage.setItem(pendingKey, JSON.stringify(cachedItems));
        return this.uploadPendingItems(userId).pipe(
          tap(() => window.localStorage.setItem(migrationKey, 'true')),
        );
      }),
      tap((items) => this.cacheItems(items)),
    );
  }

  addItem(item: CartItem): void {
    const items = this.getItems();
    const existing = items.find(
      (current) => current.productId === item.productId && current.variant === item.variant,
    );
    const quantity = item.quantity;
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      items.push({ ...item });
    }
    this.saveItems(items);
    if (this.isAuthenticatedUser()) {
      this.http.post<unknown>('/api/cart/items', {
        productId: item.productId,
        variantName: item.variant,
        quantity,
      }, { headers: this.authorizationHeaders() }).subscribe({
        next: (response) => this.cacheItems(this.parseApiCart(response)),
        error: (error: unknown) => this.reportSyncError('Không thể đồng bộ giỏ hàng lên máy chủ.', error),
      });
    }
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
    if (item.itemId) {
      this.updateRemoteItem(item.itemId, { quantity });
    }
  }

  updateSelected(productId: string, variant: string | null, selected: boolean): void {
    const items = this.getItems();
    const item = items.find((current) => current.productId === productId && current.variant === variant);
    if (!item) throw new Error('Không tìm thấy sản phẩm trong giỏ hàng.');
    item.selected = selected;
    this.saveItems(items);
    if (item.itemId) this.updateRemoteItem(item.itemId, { selected });
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
    if (current.itemId) {
      this.updateRemoteItem(current.itemId, { variantName: newVariant });
    }
  }

  removeItem(productId: string, variant: string | null): void {
    const items = this.getItems();
    const removed = items.find((item) => item.productId === productId && item.variant === variant);
    this.saveItems(items.filter(
      (item) => item.productId !== productId || item.variant !== variant,
    ));
    if (removed?.itemId) this.deleteRemoteItem(removed.itemId);
  }

  removePurchasedItems(purchased: CartItem[]): void {
    const items = this.getItems();
    const removed: CartItem[] = [];
    const changed: CartItem[] = [];
    const remaining = items.flatMap((item) => {
      const bought = purchased
        .filter((entry) => entry.productId === item.productId && entry.variant === item.variant)
        .reduce((sum, entry) => sum + entry.quantity, 0);
      const quantity = item.quantity - bought;
      if (quantity <= 0) removed.push(item);
      else if (quantity !== item.quantity) changed.push({ ...item, quantity });
      return quantity > 0 ? [{ ...item, quantity }] : [];
    });
    this.saveItems(remaining);
    const remoteOperations = [
      ...removed.flatMap((item) => {
        const itemId = item.itemId;
        return itemId ? [() => this.deleteRemoteItemRequest(itemId)] : [];
      }),
      ...changed.flatMap((item) => {
        const itemId = item.itemId;
        return itemId ? [() => this.updateRemoteItemRequest(itemId, { quantity: item.quantity })] : [];
      }),
    ];
    if (remoteOperations.length === 0) return;

    from(remoteOperations).pipe(
      concatMap((operation) => operation().pipe(
        catchError((error: unknown) => {
          this.reportSyncError('Không thể đồng bộ giỏ hàng sau khi đặt đơn.', error);
          return of(null);
        }),
      )),
      last(),
    ).subscribe();
  }

  getItemCount(): number {
    return this.getItems().reduce((sum, item) => sum + item.quantity, 0);
  }

  moveGuestCartToUser(userId: string): void {
    if (!this.isBrowser || !userId.trim() || window.localStorage.getItem('isLoggedIn') === 'true') return;

    const guestItems = this.getItems();
    if (guestItems.length === 0) return;

    const userKey = `cartItems:user:${userId}`;
    const userItems = this.readItems(userKey);
    for (const guestItem of guestItems) {
      const existing = userItems.find(
        (item) => item.productId === guestItem.productId && item.variant === guestItem.variant,
      );
      if (existing) {
        existing.quantity += guestItem.quantity;
      } else {
        userItems.push({ ...guestItem });
      }
    }

    window.localStorage.setItem(userKey, JSON.stringify(userItems));
    window.localStorage.removeItem('cartItems:guest');
    window.localStorage.removeItem('cartItems');
    window.localStorage.setItem(`cartItems:pending:${userId}`, JSON.stringify(guestItems));
    this.notifyUpdated();
  }

  private uploadPendingItems(userId: string): Observable<CartItem[]> {
    const activeUpload = this.pendingUploads.get(userId);
    if (activeUpload) return activeUpload;

    const pendingKey = `cartItems:pending:${userId}`;
    let pendingItems: CartItem[];
    try {
      pendingItems = this.readItems(pendingKey);
    } catch (error) {
      return throwError(() => error);
    }

    if (pendingItems.length === 0) return of(this.getItems());
    const upload = from(pendingItems).pipe(
      concatMap((item) => this.http.post<unknown>('/api/cart/items', {
        productId: item.productId,
        variantName: item.variant,
        quantity: item.quantity,
      }, { headers: this.authorizationHeaders() }).pipe(
        map((response) => this.parseApiCart(response)),
        tap((response) => {
          this.cacheItems(response);
          const current = this.readItems(pendingKey);
          const index = current.findIndex((entry) => (
            entry.productId === item.productId
            && entry.variant === item.variant
            && entry.quantity === item.quantity
          ));
          if (index >= 0) current.splice(index, 1);
          if (current.length) {
            window.localStorage.setItem(pendingKey, JSON.stringify(current));
          } else {
            window.localStorage.removeItem(pendingKey);
          }
        }),
      )),
      last(),
      finalize(() => this.pendingUploads.delete(userId)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.pendingUploads.set(userId, upload);
    return upload;
  }

  saveItems(items: CartItem[]): void {
    if (!this.isBrowser) return;
    window.localStorage.setItem(this.storageKey(), JSON.stringify(items));
    this.notifyUpdated();
  }

  private updateRemoteItem(
    itemId: string,
    changes: { quantity?: number; selected?: boolean; variantName?: string | null },
  ): void {
    if (!this.isAuthenticatedUser()) return;
    this.updateRemoteItemRequest(itemId, changes).subscribe({
      next: (response) => this.cacheItems(response),
      error: (error: unknown) => this.reportSyncError('Không thể cập nhật giỏ hàng trên máy chủ.', error),
    });
  }

  private updateRemoteItemRequest(
    itemId: string,
    changes: { quantity?: number; selected?: boolean; variantName?: string | null },
  ): Observable<CartItem[]> {
    return this.http.patch<unknown>(`/api/cart/items/${encodeURIComponent(itemId)}`, changes, {
      headers: this.authorizationHeaders(),
    }).pipe(map((response) => this.parseApiCart(response)));
  }

  private deleteRemoteItem(itemId: string): void {
    if (!this.isAuthenticatedUser()) return;
    this.deleteRemoteItemRequest(itemId).subscribe({
      next: (response) => this.cacheItems(response),
      error: (error: unknown) => this.reportSyncError('Không thể xóa sản phẩm khỏi giỏ hàng trên máy chủ.', error),
    });
  }

  private deleteRemoteItemRequest(itemId: string): Observable<CartItem[]> {
    return this.http.delete<unknown>(`/api/cart/items/${encodeURIComponent(itemId)}`, {
      headers: this.authorizationHeaders(),
    }).pipe(map((response) => this.parseApiCart(response)));
  }

  private parseApiCart(response: unknown): CartItem[] {
    if (!this.isRecord(response) || !Array.isArray(response['items'])) {
      throw new Error('Máy chủ trả về giỏ hàng không đúng định dạng.');
    }
    return response['items'].map((value: unknown) => {
      if (!this.isRecord(value)
        || typeof value['itemId'] !== 'string'
        || (typeof value['productId'] !== 'string' && typeof value['productId'] !== 'number')
        || typeof value['quantity'] !== 'number'
        || !Number.isInteger(value['quantity'])
        || value['quantity'] < 1
        || (value['variantName'] !== null && value['variantName'] !== undefined
          && typeof value['variantName'] !== 'string')) {
        throw new Error('Máy chủ trả về sản phẩm trong giỏ hàng không hợp lệ.');
      }
      const variantIndex = value['variantIndex'];
      if (variantIndex !== null && variantIndex !== undefined
        && (typeof variantIndex !== 'number' || !Number.isInteger(variantIndex) || variantIndex < 0)) {
        throw new Error('Máy chủ trả về phân loại sản phẩm không hợp lệ.');
      }
      return {
        itemId: value['itemId'],
        productId: String(value['productId']),
        variant: typeof value['variantName'] === 'string' ? value['variantName'] : null,
        variantIndex: typeof variantIndex === 'number' ? variantIndex : null,
        quantity: value['quantity'],
        selected: value['selected'] === true,
      };
    });
  }

  private cacheItems(items: CartItem[]): void {
    if (!this.isBrowser) return;
    window.localStorage.setItem(this.storageKey(), JSON.stringify(items));
    this.notifyUpdated();
  }

  private isAuthenticatedUser(): boolean {
    return this.isBrowser
      && window.localStorage.getItem('isLoggedIn') === 'true'
      && Boolean(window.localStorage.getItem('authToken')?.trim())
      && Boolean(window.localStorage.getItem('userId')?.trim());
  }

  private authorizationHeaders(token = window.localStorage.getItem('authToken')?.trim() ?? ''): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  private reportSyncError(message: string, error: unknown): void {
    console.error(message, error);
    if (this.isBrowser) {
      window.dispatchEvent(new CustomEvent('cart:error', { detail: message }));
    }
  }

  private storageKey(): string {
    if (window.localStorage.getItem('isLoggedIn') !== 'true') return 'cartItems:guest';
    const userId = window.localStorage.getItem('userId');
    return userId ? `cartItems:user:${userId}` : 'cartItems:guest';
  }

  private readItems(key: string): CartItem[] {
    const saved = window.localStorage.getItem(key);
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
        ...(typeof item['itemId'] === 'string' ? { itemId: item['itemId'] } : {}),
        ...(typeof item['variantIndex'] === 'number' ? { variantIndex: item['variantIndex'] } : {}),
        ...(typeof item['selected'] === 'boolean' ? { selected: item['selected'] } : {}),
      };
    });
  }

  private notifyUpdated(): void {
    window.dispatchEvent(new CustomEvent('cart:updated'));
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
