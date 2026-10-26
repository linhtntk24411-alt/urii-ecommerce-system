import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import { Component, Inject, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

type ProductId = number | string;
type ReviewFilter = 'all' | 1 | 2 | 3 | 4 | 5;
type RelatedCategory = 'all' | 'kit' | 'bead' | 'tool' | 'accessory';

interface ProductVariant {
  name: string;
  price: number;
  stock: number;
}

interface ProductReview {
  user: string;
  avatar?: string;
  rating: number;
  date?: string;
  content: string;
  helpful?: number;
}

interface Product {
  id: ProductId;
  name?: string;
  slug?: string;
  category?: string;
  description?: string;
  image?: string;
  isSale?: boolean;
  isHot?: boolean;
  originalPrice?: number;
  currentPrice?: number | null;
  stock?: number;
  rating?: number;
  reviews?: number;
  timer?: string;
  variants?: ProductVariant[];
  reviews_list?: ProductReview[];
}

interface CartItem {
  productId: ProductId;
  variant: string | null;
  quantity: number;
}

interface CategoryOption {
  value: RelatedCategory;
  label: string;
}

const RELATED_CATEGORIES: CategoryOption[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'kit', label: 'Bộ KIT' },
  { value: 'bead', label: 'Hạt lẻ' },
  { value: 'tool', label: 'Dụng cụ' },
  { value: 'accessory', label: 'Phụ kiện' },
];

const REVIEW_FILTERS: Array<{ value: ReviewFilter; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 5, label: '5 sao' },
  { value: 4, label: '4 sao' },
  { value: 3, label: '3 sao' },
  { value: 2, label: '2 sao' },
  { value: 1, label: '1 sao' },
];

const REVIEW_COLORS = ['danger', 'warning', 'success', 'info', 'primary'];

function isProduct(value: unknown): value is Product {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const product = value as Record<string, unknown>;
  return typeof product['id'] === 'string' || typeof product['id'] === 'number';
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
  imports: [DecimalPipe],
  selector: 'app-product-detail',
  styleUrl: './product-detail.css',
  templateUrl: './product-detail.html',
})
export class ProductDetail implements OnInit, OnDestroy {
  readonly relatedCategories = RELATED_CATEGORIES;
  readonly reviewFilters = REVIEW_FILTERS;

  allProducts: Product[] = [];
  product: Product | null = null;
  reviews: ProductReview[] = [];
  relatedProducts: Product[] = [];
  selectedVariant: ProductVariant | null = null;
  selectedReviewFilter: ReviewFilter = 'all';
  selectedRelatedCategory: RelatedCategory = 'all';
  selectedTab: 'description' | 'reviews' = 'description';
  quantity = 1;
  isLoading = true;
  loadError = '';
  countdownText = '';

  private isBrowser: boolean;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    @Inject(PLATFORM_ID) platformId: object,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    if (this.isBrowser) {
      void this.loadProductData();
    } else {
      this.isLoading = false;
    }
  }

  ngOnDestroy(): void {
    this.clearCountdown();
  }

  get filteredReviews(): ProductReview[] {
    return this.selectedReviewFilter === 'all'
      ? this.reviews
      : this.reviews.filter((review) => review.rating === this.selectedReviewFilter);
  }

  get averageRating(): number {
    if (this.reviews.length === 0) {
      return 0;
    }
    return this.reviews.reduce((sum, review) => sum + review.rating, 0) / this.reviews.length;
  }

  get selectedPrice(): number {
    return this.selectedVariant?.price ?? this.product?.currentPrice ?? this.product?.originalPrice ?? 0;
  }

  get selectedStock(): number {
    return this.selectedVariant?.stock ?? this.product?.stock ?? 0;
  }

  get hasDiscount(): boolean {
    return Boolean(this.product?.isSale && this.product.currentPrice);
  }

  get discountPercent(): number {
    const originalPrice = this.product?.originalPrice ?? 0;
    const currentPrice = this.product?.currentPrice ?? 0;
    return originalPrice > 0 && currentPrice > 0
      ? Math.round((1 - currentPrice / originalPrice) * 100)
      : 0;
  }

  get reviewDistribution(): Array<{ rating: number; percent: number }> {
    const total = this.reviews.length;
    return [5, 4, 3, 2, 1].map((rating) => ({
      rating,
      percent: total
        ? (this.reviews.filter((review) => review.rating === rating).length / total) * 100
        : 0,
    }));
  }

  async loadProductData(): Promise<void> {
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

      const rawId = this.route.snapshot.queryParamMap.get('id');
      const productId = rawId ? Number(rawId) : 12;
      this.product = products.find((item) => String(item.id) === String(productId)) ?? null;
      if (!this.product) {
        throw new Error('Không tìm thấy sản phẩm');
      }

      this.reviews = this.product.reviews_list ?? [];
      this.selectedVariant = this.product.variants?.[0] ?? null;
      this.quantity = 1;
      this.selectedReviewFilter = 'all';
      this.selectedRelatedCategory = 'all';
      this.updateRelatedProducts();
      this.startCountdown();
    } catch (error) {
      console.error('Lỗi khi tải chi tiết sản phẩm:', error);
      this.loadError =
        error instanceof Error ? error.message : 'Có lỗi xảy ra khi tải sản phẩm.';
    } finally {
      this.isLoading = false;
    }
  }

  selectVariant(variant: ProductVariant): void {
    this.selectedVariant = variant;
    this.quantity = 1;
  }

  updateQuantity(change: number): void {
    const nextQuantity = this.quantity + change;
    if (nextQuantity < 1 || nextQuantity > this.selectedStock) {
      return;
    }
    this.quantity = nextQuantity;
  }

  setQuantity(event: Event): void {
    const inputValue = Number((event.target as HTMLInputElement).value);
    this.quantity = Math.min(Math.max(Math.floor(inputValue) || 1, 1), this.selectedStock || 1);
  }

  addCurrentProductToCart(): void {
    if (!this.product || this.selectedStock <= 0) {
      window.alert('Sản phẩm đã hết hàng!');
      return;
    }

    this.addProductToCart(this.product, this.quantity, this.selectedVariant?.name ?? null);
    window.alert(`Đã thêm "${this.product.name ?? 'Sản phẩm'}" vào giỏ hàng!`);
  }

  buyCurrentProductNow(): void {
    if (!this.product || this.selectedStock <= 0) {
      window.alert('Sản phẩm đã hết hàng!');
      return;
    }

    const variant = this.selectedVariant?.name ?? null;
    this.addProductToCart(this.product, this.quantity, variant);
    localStorage.setItem(
      'checkoutItems',
      JSON.stringify([{ productId: this.product.id, variant, quantity: this.quantity }]),
    );
    window.location.href = 'checkout.html';
  }

  setReviewFilter(filter: ReviewFilter): void {
    this.selectedReviewFilter = filter;
  }

  setRelatedCategory(category: RelatedCategory): void {
    this.selectedRelatedCategory = category;
    this.updateRelatedProducts();
  }

  scrollRelated(direction: number): void {
    const relatedContainer = document.querySelector<HTMLElement>('.related-scroll');
    relatedContainer?.scrollBy({ left: direction * 240, behavior: 'smooth' });
  }

  addRelatedProductToCart(product: Product): void {
    this.addProductToCart(product, 1, null);
    window.alert(`Đã thêm "${product.name ?? 'Sản phẩm'}" vào giỏ hàng!`);
  }

  buyRelatedProductNow(product: Product): void {
    const variant = product.variants?.[0]?.name ?? null;
    this.addProductToCart(product, 1, variant);
    localStorage.setItem(
      'checkoutItems',
      JSON.stringify([{ productId: product.id, variant, quantity: 1 }]),
    );
    window.location.href = 'checkout.html';
  }

  productDetailUrl(product: Product): string {
    return `/product-detail?id=${encodeURIComponent(String(product.id))}`;
  }

  formatPrice(price: number): string {
    return `${price.toLocaleString('vi-VN')}₫`;
  }

  formatDate(dateString?: string): string {
    if (!dateString) {
      return '';
    }

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
    if (days <= 0) return 'Hôm nay';
    if (days === 1) return 'Hôm qua';
    if (days < 7) return `${days} ngày trước`;
    if (days < 30) return `${Math.floor(days / 7)} tuần trước`;
    if (days < 365) return `${Math.floor(days / 30)} tháng trước`;
    return `${Math.floor(days / 365)} năm trước`;
  }

  starIndexes(rating: number): number[] {
    return Array.from({ length: Math.min(5, Math.max(0, Math.floor(rating))) }, (_, i) => i);
  }

  hasHalfStar(rating: number): boolean {
    return rating % 1 >= 0.5 && rating < 5;
  }

  emptyStarIndexes(rating: number): number[] {
    const usedStars = Math.min(5, Math.floor(rating) + (this.hasHalfStar(rating) ? 1 : 0));
    return Array.from({ length: 5 - usedStars }, (_, i) => i);
  }

  reviewColor(index: number): string {
    return REVIEW_COLORS[index % REVIEW_COLORS.length];
  }

  private startCountdown(): void {
    this.clearCountdown();
    const timer = this.product?.timer;
    if (!this.product?.isSale || !timer) {
      this.countdownText = '';
      return;
    }

    const endTime = new Date(timer).getTime();
    if (Number.isNaN(endTime)) {
      this.countdownText = '';
      return;
    }

    const update = (): void => {
      const distance = endTime - Date.now();
      if (distance <= 0) {
        this.countdownText = 'Ưu đãi đã kết thúc.';
        this.clearCountdown();
        return;
      }

      const hours = Math.floor(distance / 3_600_000);
      const minutes = Math.floor((distance % 3_600_000) / 60_000);
      const seconds = Math.floor((distance % 60_000) / 1000);
      this.countdownText = `Ưu đãi kết thúc sau: ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    };

    update();
    this.countdownInterval = setInterval(update, 1000);
  }

  private clearCountdown(): void {
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private extractProducts(data: unknown): Product[] | null {
    let candidate: unknown = data;
    if (typeof data === 'object' && data !== null && 'products' in data) {
      candidate = data.products;
    }
    return Array.isArray(candidate) && candidate.every(isProduct) ? candidate : null;
  }

  private updateRelatedProducts(): void {
    if (!this.product) {
      this.relatedProducts = [];
      return;
    }

    let matches = this.allProducts.filter(
      (item) =>
        String(item.id) !== String(this.product?.id) &&
        (this.selectedRelatedCategory === 'all' ||
          item.category === this.selectedRelatedCategory),
    );

    if (matches.length < 6) {
      const additional = this.allProducts
        .filter(
          (item) =>
            String(item.id) !== String(this.product?.id) && !matches.includes(item),
        )
        .slice(0, 6 - matches.length);
      matches = [...matches, ...additional];
    }

    this.relatedProducts = this.shuffle(matches).slice(0, 12);
  }

  private shuffle<T>(items: T[]): T[] {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  private addProductToCart(product: Product, quantity: number, variant: string | null): void {
    const cartItems = this.getStoredCartItems();
    const existingItem = cartItems.find(
      (item) => item.productId === product.id && item.variant === variant,
    );

    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      cartItems.push({ productId: product.id, variant, quantity });
    }

    localStorage.setItem('cartItems', JSON.stringify(cartItems));
    window.dispatchEvent(new CustomEvent('cart:updated', { detail: cartItems }));
    window.dispatchEvent(new Event('storage'));

    const cartCount = document.getElementById('cartCount');
    if (cartCount) {
      cartCount.textContent = String(cartItems.length);
      cartCount.style.display = cartItems.length > 0 ? 'flex' : 'none';
    }
  }

  private getStoredCartItems(): CartItem[] {
    const saved = localStorage.getItem('cartItems');
    if (!saved) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(saved);
      return Array.isArray(parsed)
        ? parsed.filter(isCartItem).map((item) => ({ ...item, variant: item.variant ?? null }))
        : [];
    } catch (error) {
      console.error('Không thể đọc giỏ hàng:', error);
      return [];
    }
  }
}
