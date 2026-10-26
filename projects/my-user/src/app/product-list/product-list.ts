import { isPlatformBrowser } from '@angular/common';
import { Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';

type ProductId = number | string;
type RatingFilter = 'all' | '4.5' | '4.0' | '3.5' | '3.0' | 'below-3';
type SaleFilter = 'sale' | 'hot';
type SortOrder = 'popular' | 'price-asc' | 'price-desc' | 'sale';

interface Product {
  id: ProductId;
  name?: string;
  category?: string;
  description?: string;
  image?: string;
  originalPrice?: number;
  currentPrice?: number | null;
  isSale?: boolean;
  isHot?: boolean;
  rating?: number;
  reviews?: number;
  stock?: number;
  variants?: Array<{ name?: string }>;
}

interface CartItem {
  productId: ProductId;
  variant?: string | null;
  quantity: number;
}

interface RatingOption {
  value: RatingFilter;
  label: string;
  stars?: string;
}

const RATING_OPTIONS: RatingOption[] = [
  { value: 'all', label: 'Tất cả' },
  { value: '4.5', label: '4.5+', stars: '★★★★★' },
  { value: '4.0', label: '4.0+', stars: '★★★★' },
  { value: '3.5', label: '3.5+', stars: '★★★☆' },
  { value: '3.0', label: '3.0+', stars: '★★★' },
  { value: 'below-3', label: 'Dưới 3.0', stars: '★★☆' },
];

function isProduct(value: unknown): value is Product {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const product = value as Record<string, unknown>;
  const hasValidField = (
    key: string,
    predicate: (field: unknown) => boolean,
  ): boolean => product[key] === undefined || predicate(product[key]);

  return (
    (typeof product['id'] === 'string' || typeof product['id'] === 'number') &&
    hasValidField('name', (field) => typeof field === 'string') &&
    hasValidField('category', (field) => typeof field === 'string') &&
    hasValidField('description', (field) => typeof field === 'string') &&
    hasValidField('image', (field) => typeof field === 'string') &&
    hasValidField('originalPrice', (field) => typeof field === 'number') &&
    hasValidField('currentPrice', (field) => field === null || typeof field === 'number') &&
    hasValidField('isSale', (field) => typeof field === 'boolean') &&
    hasValidField('isHot', (field) => typeof field === 'boolean') &&
    hasValidField('rating', (field) => typeof field === 'number') &&
    hasValidField('reviews', (field) => typeof field === 'number') &&
    hasValidField('stock', (field) => typeof field === 'number') &&
    hasValidField(
      'variants',
      (field) =>
        Array.isArray(field) &&
        field.every(
          (variant) =>
            typeof variant === 'object' &&
            variant !== null &&
            ((variant as Record<string, unknown>)['name'] === undefined ||
              typeof (variant as Record<string, unknown>)['name'] === 'string'),
        ),
    )
  );
}

function isCartItem(value: unknown): value is CartItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    (typeof item['productId'] === 'string' || typeof item['productId'] === 'number') &&
    (typeof item['variant'] === 'string' ||
      item['variant'] === null ||
      item['variant'] === undefined) &&
    typeof item['quantity'] === 'number'
  );
}

@Component({
  selector: 'app-product-list',
  styleUrl: './product-list.css',
  templateUrl: './product-list.html',
})
export class ProductList implements OnInit {
  readonly ratingOptions = RATING_OPTIONS;
  readonly itemsPerPage = 9;
  readonly selectedPrices = new Set<string>();
  readonly selectedSales = new Set<SaleFilter>();

  allProducts: Product[] = [];
  filteredProducts: Product[] = [];
  currentPage = 1;
  selectedRating: RatingFilter = 'all';
  sortOrder: SortOrder = 'popular';
  categoryInfo = '';
  isLoading = true;
  loadError = '';

  private baseProducts: Product[] = [];
  private isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    if (this.isBrowser) {
      void this.loadProducts();
    } else {
      this.isLoading = false;
    }
  }

  get pagedProducts(): Product[] {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.filteredProducts.slice(start, start + this.itemsPerPage);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredProducts.length / this.itemsPerPage);
  }

  get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, index) => index + 1);
  }

  get productCountText(): string {
    if (this.isLoading) {
      return 'Đang tải...';
    }
    if (this.filteredProducts.length === 0) {
      return 'Không có sản phẩm';
    }

    const firstItem = (this.currentPage - 1) * this.itemsPerPage + 1;
    const lastItem = Math.min(this.currentPage * this.itemsPerPage, this.filteredProducts.length);
    return `Hiển thị ${firstItem}-${lastItem} trong số ${this.filteredProducts.length} sản phẩm`;
  }

  async loadProducts(): Promise<void> {
    this.isLoading = true;
    this.loadError = '';

    try {
      const response = await fetch('/data/product.json');
      if (!response.ok) {
        throw new Error(`Không thể tải dữ liệu sản phẩm (${response.status})`);
      }

      const data: unknown = await response.json();
      const products = this.extractProducts(data);
      if (!products) {
        throw new Error('Dữ liệu sản phẩm không đúng định dạng');
      }

      this.allProducts = products;
      localStorage.setItem('products', JSON.stringify(products));
      this.applyInitialQuery();
      this.applyFilters();
      this.renderCategoryInfo();
    } catch (error) {
      console.error('Lỗi khi tải sản phẩm:', error);
      this.loadError = 'Có lỗi xảy ra khi tải sản phẩm.';
    } finally {
      this.isLoading = false;
    }
  }

  setPriceFilter(value: string, event: Event): void {
    if ((event.target as HTMLInputElement).checked) {
      this.selectedPrices.add(value);
    } else {
      this.selectedPrices.delete(value);
    }
    this.applyFilters();
  }

  setSaleFilter(value: SaleFilter, event: Event): void {
    if ((event.target as HTMLInputElement).checked) {
      this.selectedSales.add(value);
    } else {
      this.selectedSales.delete(value);
    }
    this.applyFilters();
  }

  selectRating(rating: RatingFilter): void {
    this.selectedRating = rating;
    this.applyFilters();
  }

  setSortOrder(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'popular' || value === 'price-asc' || value === 'price-desc' || value === 'sale') {
      this.sortOrder = value;
      this.applyFilters();
    }
  }

  clearFilters(): void {
    this.selectedPrices.clear();
    this.selectedSales.clear();
    this.selectedRating = 'all';
    this.sortOrder = 'popular';
    this.applyFilters();
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages) {
      return;
    }
    this.currentPage = page;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  hasDiscount(product: Product): boolean {
    return Boolean(product.isSale && product.currentPrice);
  }

  discountPercent(product: Product): number {
    const originalPrice = product.originalPrice ?? 0;
    if (!originalPrice || !product.currentPrice) {
      return 0;
    }
    return Math.round((1 - product.currentPrice / originalPrice) * 100);
  }

  displayPrice(product: Product): number {
    return product.currentPrice || product.originalPrice || 0;
  }

  formatPrice(price: number): string {
    return `${price.toLocaleString('vi-VN')}₫`;
  }

  addToCart(product: Product): void {
    const variant = product.variants?.[0]?.name ?? null;
    const cartItems = this.getStoredCartItems();
    const existingItem = cartItems.find(
      (item) => item.productId === product.id && (item.variant ?? null) === variant,
    );

    if (existingItem) {
      existingItem.quantity += 1;
    } else {
      cartItems.push({ productId: product.id, variant, quantity: 1 });
    }

    this.saveStoredCartItems(cartItems);
    window.alert(`Đã thêm "${product.name ?? 'Sản phẩm'}" vào giỏ hàng!`);
  }

  buyNow(product: Product): void {
    const variant = product.variants?.[0]?.name ?? null;
    const cartItems = this.getStoredCartItems();
    const existingItem = cartItems.find(
      (item) => item.productId === product.id && (item.variant ?? null) === variant,
    );

    if (!existingItem) {
      cartItems.push({ productId: product.id, variant, quantity: 1 });
      this.saveStoredCartItems(cartItems);
    }

    const checkoutItem: CartItem = {
      productId: product.id,
      variant,
      quantity: 1,
    };
    localStorage.setItem('checkoutItems', JSON.stringify([checkoutItem]));
    window.location.href = `checkout.html`;
  }

  private extractProducts(data: unknown): Product[] | null {
    let candidate: unknown = data;
    if (typeof data === 'object' && data !== null && 'products' in data) {
      candidate = data.products;
    }
    return Array.isArray(candidate) && candidate.every(isProduct) ? candidate : null;
  }

  private applyInitialQuery(): void {
    const params = new URLSearchParams(window.location.search);
    const category = params.get('category') ?? '';
    const search = params.get('search') ?? '';
    const normalizedSearch = search.toLocaleLowerCase();

    this.baseProducts = this.allProducts.filter((product) => {
      const matchesCategory = !category || product.category === category;
      const matchesSearch =
        !normalizedSearch ||
        [product.name, product.category, product.description].some((value) =>
          (value ?? '').toLocaleLowerCase().includes(normalizedSearch),
        );
      return matchesCategory && matchesSearch;
    });
  }

  private applyFilters(): void {
    let filtered = this.baseProducts.filter((product) => {
      const price = this.displayPrice(product);
      const matchesPrice =
        this.selectedPrices.size === 0 ||
        [...this.selectedPrices].some((filter) => {
          if (filter === 'under-50') return price < 50000;
          if (filter === '50-200') return price >= 50000 && price <= 200000;
          if (filter === 'over-200') return price > 200000;
          return false;
        });

      const matchesSale =
        this.selectedSales.size === 0 ||
        (this.selectedSales.has('sale') && product.isSale === true) ||
        (this.selectedSales.has('hot') && product.isHot === true);

      const rating = product.rating ?? 0;
      const matchesRating =
        this.selectedRating === 'all' ||
        (this.selectedRating === 'below-3' ? rating < 3 : rating >= Number(this.selectedRating));

      return matchesPrice && matchesSale && matchesRating;
    });

    switch (this.sortOrder) {
      case 'price-asc':
        filtered = filtered.sort((a, b) => this.displayPrice(a) - this.displayPrice(b));
        break;
      case 'price-desc':
        filtered = filtered.sort((a, b) => this.displayPrice(b) - this.displayPrice(a));
        break;
      case 'sale':
        filtered = filtered.sort((a, b) => this.discountRatio(b) - this.discountRatio(a));
        break;
      case 'popular':
        filtered = filtered.sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0));
        break;
    }

    this.filteredProducts = filtered;
    this.currentPage = 1;
  }

  private discountRatio(product: Product): number {
    const originalPrice = product.originalPrice ?? 0;
    return this.hasDiscount(product) && originalPrice > 0
      ? (originalPrice - (product.currentPrice ?? 0)) / originalPrice
      : 0;
  }

  private renderCategoryInfo(): void {
    const params = new URLSearchParams(window.location.search);
    const category = params.get('category') ?? '';
    const search = params.get('search') ?? '';
    const parts: string[] = [];

    if (category) {
      parts.push(`Danh mục: ${this.getCategoryLabel(category)}`);
    }
    if (search) {
      parts.push(`Từ khóa: ${search}`);
    }
    this.categoryInfo = parts.join(' · ');
  }

  private getCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
      kit: 'Bộ KIT DIY',
      tool: 'Dụng cụ',
      bead: 'Hạt lẻ',
      accessory: 'Phụ kiện Handmade',
    };
    return labels[category] ?? 'Tất cả sản phẩm';
  }

  private getStoredCartItems(): CartItem[] {
    const saved = localStorage.getItem('cartItems');
    if (!saved) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed.filter(isCartItem).map((item) => ({
          ...item,
          variant: item.variant ?? null,
        }));
      }
    } catch (error) {
      console.error('Không thể đọc giỏ hàng:', error);
    }
    return [];
  }

  private saveStoredCartItems(items: CartItem[]): void {
    localStorage.setItem('cartItems', JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('cart:updated', { detail: items }));
    window.dispatchEvent(new Event('storage'));

    const cartCount = document.getElementById('cartCount');
    if (cartCount) {
      cartCount.textContent = String(items.length);
      cartCount.style.display = items.length > 0 ? 'flex' : 'none';
    }
  }
}
