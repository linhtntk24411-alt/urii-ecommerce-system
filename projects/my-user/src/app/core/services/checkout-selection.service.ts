import { Injectable } from '@angular/core';
import { CartItem } from './cart.service';

@Injectable({ providedIn: 'root' })
export class CheckoutSelectionService {
  private selectedItems: CartItem[] | null = null;
  private removeFromCartAfterCheckout = true;

  set(items: CartItem[], removeFromCartAfterCheckout = true): void {
    this.selectedItems = items.map((item) => ({ ...item }));
    this.removeFromCartAfterCheckout = removeFromCartAfterCheckout;
  }

  get(): CartItem[] | null {
    return this.selectedItems?.map((item) => ({ ...item })) ?? null;
  }

  shouldRemoveFromCartAfterCheckout(): boolean {
    return this.removeFromCartAfterCheckout;
  }

  clear(): void {
    this.selectedItems = null;
    this.removeFromCartAfterCheckout = true;
  }
}
