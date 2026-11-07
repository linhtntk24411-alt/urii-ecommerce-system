import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CartItem, CartService } from '../../core/services/cart.service';
import { CheckoutSelectionService } from '../../core/services/checkout-selection.service';
import { CatalogProduct, ProductCatalogService } from '../../core/services/product-catalog.service';

interface CartLine {
  item: CartItem;
  product: CatalogProduct | null;
  selected: boolean;
}

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './cart.html',
  styleUrl: './cart.css',
})
export class Cart implements OnInit {
  private readonly cart = inject(CartService);
  private readonly catalog = inject(ProductCatalogService);
  private readonly checkoutSelection = inject(CheckoutSelectionService);
  private readonly router = inject(Router);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  lines: CartLine[] = [];
  loading = true;
  errorMessage = '';
  requiresLogin = false;

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.loadCart();
  }

  get selectedLines(): CartLine[] {
    return this.lines.filter((line) => line.selected && line.product !== null);
  }

  get selectedCount(): number {
    return this.selectedLines.reduce((total, line) => total + line.item.quantity, 0);
  }

  get selectedTotal(): number {
    return this.selectedLines.reduce((total, line) => total + this.lineTotal(line), 0);
  }

  loadCart(): void {
    this.loading = true;
    this.errorMessage = '';
    this.cart.loadItems().subscribe({
      next: (items) => this.loadProductDetails(items),
      error: (error: unknown) => {
        console.error('Không thể tải giỏ hàng từ máy chủ:', error);
        const cachedItems = this.cart.getItems();
        this.requiresLogin = error instanceof HttpErrorResponse && error.status === 401;
        this.errorMessage = this.getCartLoadErrorMessage(error);
        this.loadProductDetails(cachedItems);
      },
    });
  }

  loginAgain(): void {
    void this.router.navigate(['/login'], { queryParams: { returnUrl: '/cart' } });
  }

  toggleSelection(line: CartLine): void {
    try {
      this.cart.updateSelected(line.item.productId, line.item.variant, !line.selected);
      line.selected = !line.selected;
    } catch (error) {
      console.error('Không thể cập nhật lựa chọn giỏ hàng:', error);
      this.errorMessage = error instanceof Error ? error.message : 'Không thể cập nhật lựa chọn.';
    }
  }

  updateQuantity(line: CartLine, change: number): void {
    const quantity = line.item.quantity + change;
    const stock = this.stockFor(line);
    if (quantity < 1 || (stock !== undefined && quantity > stock)) return;

    try {
      this.cart.updateQuantity(line.item.productId, line.item.variant, quantity);
      line.item.quantity = quantity;
    } catch (error) {
      console.error('Không thể cập nhật số lượng giỏ hàng:', error);
      this.errorMessage = error instanceof Error ? error.message : 'Không thể cập nhật số lượng.';
    }
  }

  changeVariant(line: CartLine, event: Event): void {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || !line.product) return;
    const newVariant = select.value || null;
    if (newVariant === line.item.variant) return;

    const selectedVariant = line.product.variants.find((variant) => variant.name === newVariant);
    const stock = selectedVariant?.stock ?? line.product.stock;
    const matchingLine = this.lines.find(
      (entry) => entry !== line
        && entry.item.productId === line.item.productId
        && entry.item.variant === newVariant,
    );
    const newQuantity = line.item.quantity + (matchingLine?.item.quantity ?? 0);

    if (stock === 0) {
      this.errorMessage = 'Phân loại này đã hết hàng.';
      select.value = line.item.variant ?? '';
      return;
    }
    if (stock !== undefined && newQuantity > stock) {
      this.errorMessage = `Phân loại này chỉ còn ${stock} sản phẩm, không đủ số lượng trong giỏ.`;
      select.value = line.item.variant ?? '';
      return;
    }

    try {
      this.cart.changeVariant(line.item.productId, line.item.variant, newVariant);
      if (matchingLine) {
        matchingLine.item.quantity = newQuantity;
        matchingLine.selected = matchingLine.selected || line.selected;
        this.lines = this.lines.filter((entry) => entry !== line);
      } else {
        line.item.variant = newVariant;
      }
      this.errorMessage = '';
    } catch (error) {
      console.error('Không thể thay đổi phân loại sản phẩm:', error);
      this.errorMessage = error instanceof Error ? error.message : 'Không thể thay đổi phân loại sản phẩm.';
      select.value = line.item.variant ?? '';
    }
  }

  remove(line: CartLine): void {
    try {
      this.cart.removeItem(line.item.productId, line.item.variant);
      this.lines = this.lines.filter((entry) => entry !== line);
      this.errorMessage = '';
    } catch (error) {
      console.error('Không thể xóa sản phẩm khỏi giỏ hàng:', error);
      this.errorMessage = error instanceof Error ? error.message : 'Không thể xóa sản phẩm.';
    }
  }

  checkout(): void {
    if (this.selectedLines.length === 0) return;
    if (this.selectedLines.some((line) => this.stockFor(line) === 0)) {
      this.errorMessage = 'Có sản phẩm đã hết hàng. Vui lòng kiểm tra lại giỏ hàng.';
      return;
    }

    const selected = this.selectedLines.map((line) => line.item);
    this.checkoutSelection.set(selected);
    void this.router.navigate(['/checkout']);
  }

  lineTotal(line: CartLine): number {
    return this.unitPrice(line) * line.item.quantity;
  }

  unitPrice(line: CartLine): number {
    const variant = line.product?.variants.find((entry) => entry.name === line.item.variant);
    return variant?.price ?? line.product?.price ?? 0;
  }

  stockFor(line: CartLine): number | undefined {
    const variant = line.product?.variants.find((entry) => entry.name === line.item.variant);
    return variant?.stock ?? line.product?.stock;
  }

  trackLine(_index: number, line: CartLine): string {
    return `${line.item.productId}:${line.item.variant ?? ''}`;
  }

  private mapLines(items: CartItem[], products: CatalogProduct[]): CartLine[] {
    return items.map((item) => ({
      item,
      product: products.find((product) => product.id === item.productId) ?? null,
      selected: item.selected ?? true,
    }));
  }

  private loadProductDetails(items: CartItem[]): void {
    if (items.length === 0) {
      this.lines = [];
      this.loading = false;
      this.changeDetectorRef.markForCheck();
      return;
    }

    this.catalog.getProducts().subscribe({
      next: (products) => {
        this.lines = this.mapLines(items, products);
        this.loading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Không thể tải thông tin sản phẩm trong giỏ hàng:', error);
        const cachedProducts = this.catalog.getCachedProducts();
        this.lines = this.mapLines(items, cachedProducts);
        this.errorMessage = cachedProducts.length
          ? 'Máy chủ đang gián đoạn. Giỏ hàng đang hiển thị thông tin đã lưu; thử tải lại để cập nhật.'
          : 'Không thể kết nối máy chủ để tải thông tin sản phẩm. Giỏ hàng vẫn được giữ lại; vui lòng thử tải lại.';
        this.loading = false;
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  private getCartLoadErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401) {
        const serverMessage = this.readServerMessage(error);
        if (serverMessage && /token|đăng nhập|phiên/i.test(serverMessage)) {
          return `${serverMessage} Giỏ hàng đã lưu vẫn được giữ lại; hãy đăng nhập lại để đồng bộ.`;
        }
        if (serverMessage) {
          return `Máy chủ từ chối truy cập giỏ hàng: ${serverMessage} Giỏ hàng đã lưu vẫn được giữ lại.`;
        }
        return 'Máy chủ từ chối truy cập giỏ hàng (HTTP 401). Giỏ hàng đã lưu vẫn được giữ lại; vui lòng kiểm tra tài khoản và phiên đăng nhập.';
      }
      if (error.status === 403) {
        return 'Tài khoản hiện tại không có quyền truy cập giỏ hàng. Giỏ hàng đã lưu vẫn được giữ lại.';
      }
      if (error.status === 0) {
        return 'Không kết nối được máy chủ. Giỏ hàng đã lưu vẫn được giữ lại; hãy kiểm tra backend/MongoDB rồi thử tải lại.';
      }
      const serverMessage = this.readServerMessage(error);
      return serverMessage
        ? `Máy chủ không thể tải giỏ hàng: ${serverMessage} Giỏ hàng đã lưu vẫn được giữ lại.`
        : `Không thể đồng bộ giỏ hàng (HTTP ${error.status}). Giỏ hàng đã lưu vẫn được giữ lại.`;
    }

    return 'Không thể đọc dữ liệu giỏ hàng từ máy chủ. Giỏ hàng đã lưu vẫn được giữ lại; vui lòng thử tải lại.';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private readServerMessage(error: HttpErrorResponse): string {
    return this.isRecord(error.error) && typeof error.error['message'] === 'string'
      ? error.error['message'].trim()
      : '';
  }
}
