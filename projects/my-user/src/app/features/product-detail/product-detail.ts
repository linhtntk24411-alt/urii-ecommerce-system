import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

interface ProductVariant {
  name: string;
  price?: number;
  stock?: number;
}

interface ProductItem {
  id: string | number;
  slug: string;
  name: string;
  image: string;
  description: string;
  rating: number;
  reviews: number;
  stock: number;
  originalPrice: number;
  currentPrice?: number;
  isSale?: boolean;
  variants?: ProductVariant[];
  images?: string[];
}

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './product-detail.html',
  styleUrl: './product-detail.css',
})
export class ProductDetail implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  product: ProductItem | null = null;
  quantity = 1;
  selectedVariant: ProductVariant | null = null;
  imageIndex = 0;
  isLoading = true;
  errorMessage = '';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
      const slug = params.get('slug');
      if (!slug) {
        this.errorMessage = 'Không tìm thấy slug sản phẩm trong đường dẫn.';
        this.isLoading = false;
        return;
      }

      if (this.isBrowser) {
        void this.loadProduct(slug);
      }
    });
  }

  retryLoad(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (slug) {
      void this.loadProduct(slug);
    }
  }

  get displayPrice(): number {
    return this.selectedVariant?.price ?? this.product?.currentPrice ?? this.product?.originalPrice ?? 0;
  }

  get hasDiscount(): boolean {
    return Boolean(
      this.product?.isSale &&
      this.product?.originalPrice &&
      this.displayPrice < this.product.originalPrice,
    );
  }

  get discountPercent(): number {
    if (!this.product || !this.hasDiscount || this.product.originalPrice <= 0) {
      return 0;
    }
    return Math.round((1 - this.displayPrice / this.product.originalPrice) * 100);
  }

  get productImages(): string[] {
    if (this.product?.images?.length) {
      return this.product.images;
    }
    return this.product?.image ? [this.product.image] : [];
  }

  get availableStock(): number {
    return this.selectedVariant?.stock ?? this.product?.stock ?? 0;
  }

  formatPrice(value: number): string {
    return `${value.toLocaleString('vi-VN')}₫`;
  }

  starIcons(rating: number): string[] {
    const value = Math.max(0, Math.min(5, rating));
    const full = Math.floor(value);
    const half = value - full >= 0.5;
    return Array.from({ length: 5 }, (_, index) => {
      if (index < full) return 'bi bi-star-fill';
      if (index === full && half) return 'bi bi-star-half';
      return 'bi bi-star';
    });
  }

  increaseQuantity(): void {
    this.quantity = Math.min(this.quantity + 1, this.availableStock);
  }

  decreaseQuantity(): void {
    this.quantity = Math.max(1, this.quantity - 1);
  }

  selectVariant(variant: ProductVariant): void {
    this.selectedVariant = variant;
  }

  addToCart(): void {
    if (!this.product) return;

    const saved = this.readCartItems();
    const existing = saved.find(
      (item) => item.productId === this.product!.id && item.variant === (this.selectedVariant?.name ?? null),
    );

    if (existing) {
      existing.quantity += this.quantity;
    } else {
      saved.push({
        productId: this.product.id,
        variant: this.selectedVariant?.name ?? null,
        quantity: this.quantity,
      });
    }

    localStorage.setItem('cartItems', JSON.stringify(saved));
    window.dispatchEvent(new CustomEvent('cart:updated', { detail: saved }));
    window.dispatchEvent(new Event('storage'));
    alert(`Đã thêm "${this.product.name}" vào giỏ hàng!`);
  }

  buyNow(): void {
    if (!this.product) return;

    const item = {
      productId: this.product.id,
      variant: this.selectedVariant?.name ?? null,
      quantity: this.quantity,
    };

    localStorage.setItem('checkoutItems', JSON.stringify([item]));
    this.router.navigate(['/checkout']);
  }

  async loadProduct(slug: string): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      const response = await window.fetch('/api/products');
      if (!response.ok) {
        throw new Error(`Không thể tải sản phẩm từ server (HTTP ${response.status})`);
      }

      const data: unknown = await response.json();
      const products = this.parseProducts(data);
      const found = products.find((item) => item.slug === slug);
      if (!found) {
        this.product = null;
        this.errorMessage = 'Không tìm thấy sản phẩm này.';
        return;
      }

      this.product = found;
      this.selectedVariant = found.variants?.[0] ?? null;
      this.quantity = 1;
      this.imageIndex = 0;
    } catch (error) {
      console.error('Lỗi tải sản phẩm từ MongoDB:', error);
      this.product = null;
      this.errorMessage = error instanceof Error
        ? error.message
        : 'Không thể tải sản phẩm từ server. Vui lòng thử lại.';
    } finally {
      this.isLoading = false;
    }
  }

  private parseProducts(data: unknown): ProductItem[] {
    const records = Array.isArray(data)
      ? data
      : this.isRecord(data) && Array.isArray(data['products'])
        ? data['products']
        : [];

    return records.flatMap((record): ProductItem[] => {
      if (!this.isRecord(record)) return [];

      const rawId = record['id'] ?? record['_id'];
      const id = typeof rawId === 'string' || typeof rawId === 'number'
        ? String(rawId)
        : this.isRecord(rawId) && typeof rawId['$oid'] === 'string'
          ? rawId['$oid']
          : null;
      const name = record['name'] ?? record['productName'];
      if (id === null || typeof name !== 'string') return [];
      const slug = typeof record['slug'] === 'string' && record['slug'].trim()
        ? record['slug'].trim()
        : this.slugify(name);

      const rawImage = record['image'] ?? record['imageUrl'] ?? record['images'];
      const images = Array.isArray(rawImage)
        ? rawImage.filter((image): image is string => typeof image === 'string')
        : typeof rawImage === 'string'
          ? [rawImage]
          : [];
      const variants = Array.isArray(record['variants'])
        ? record['variants'].flatMap((variant): ProductVariant[] => {
          if (!this.isRecord(variant) || typeof variant['name'] !== 'string') return [];
          return [{
            name: variant['name'],
            price: this.toNumber(variant['price']),
            stock: this.toNumber(variant['stock']),
          }];
        })
        : [];
      const originalPrice = this.toNumber(record['originalPrice'] ?? record['price']);
      const currentPrice = this.optionalNumber(record['currentPrice'] ?? record['salePrice']);

      return [{
        id,
        slug,
        name,
        image: images[0] ?? '',
        images,
        description: typeof record['description'] === 'string' ? record['description'] : '',
        rating: this.toNumber(record['rating']),
        reviews: this.toNumber(record['reviews'] ?? record['reviewCount']),
        stock: this.toNumber(record['stock'] ?? record['quantity']),
        originalPrice,
        currentPrice,
        isSale: record['isSale'] === true || (currentPrice !== undefined && currentPrice < originalPrice),
        variants,
      }];
    });
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private slugify(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private optionalNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private toNumber(value: unknown): number {
    return this.optionalNumber(value) ?? 0;
  }

  private readCartItems(): Array<{ productId: string | number; variant: string | null; quantity: number }> {
    try {
      const raw = localStorage.getItem('cartItems');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('Không thể đọc giỏ hàng:', error);
      return [];
    }
  }
}
