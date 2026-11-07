import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, DestroyRef, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FavoriteProductsService } from '../../core/services/favorite-products.service';
import { CartService } from '../../core/services/cart.service';
import { CheckoutSelectionService } from '../../core/services/checkout-selection.service';
import { ToastService } from '../../core/services/toast.service';
import { DialogService } from '../../core/services/dialog.service';

interface ProductVariant {
  name: string;
  price?: number;
  stock?: number;
  image?: string;
}

interface CustomerReview {
  id: string;
  customerName: string;
  avatar?: string;
  rating: number;
  comment: string;
  variantName: string;
  createdAt?: string;
  images: string[];
  videos: string[];
}

type ReviewMediaFilter = 'all' | 'photos' | 'videos';

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
  customerReviews: CustomerReview[];
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
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  product: ProductItem | null = null;
  quantity = 1;
  selectedVariant: ProductVariant | null = null;
  selectedVariantIndex = 0;
  imageIndex = 0;
  isLoading = true;
  errorMessage = '';
  reviewErrorMessage = '';
  statusMessage = '';
  isFavorite = false;
  readonly ratingOptions = [5, 4, 3, 2, 1];
  reviewMediaFilter: ReviewMediaFilter = 'all';
  reviewRatingFilter: number | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly favorites: FavoriteProductsService,
    private readonly cart: CartService,
    private readonly checkoutSelection: CheckoutSelectionService,
    private readonly toast: ToastService,
    private readonly dialogService: DialogService,
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
    if (this.selectedVariant?.image) {
      return [this.selectedVariant.image];
    }
    if (this.product?.images?.length) {
      return this.product.images;
    }
    return this.product?.image ? [this.product.image] : [];
  }

  get availableStock(): number {
    return this.selectedVariant?.stock ?? this.product?.stock ?? 0;
  }

  get customerReviews(): CustomerReview[] {
    return this.product?.customerReviews ?? [];
  }

  get reviewCount(): number {
    return this.customerReviews.length || this.product?.reviews || 0;
  }

  get averageReviewRating(): number {
    if (this.customerReviews.length) {
      const total = this.customerReviews.reduce((sum, review) => sum + review.rating, 0);
      return total / this.customerReviews.length;
    }
    return this.product?.rating ?? 0;
  }

  get filteredCustomerReviews(): CustomerReview[] {
    return this.customerReviews.filter((review) => {
      const matchesMedia = this.reviewMediaFilter === 'all'
        || (this.reviewMediaFilter === 'photos' && review.images.length > 0)
        || (this.reviewMediaFilter === 'videos' && review.videos.length > 0);
      return matchesMedia && (this.reviewRatingFilter === null || review.rating === this.reviewRatingFilter);
    });
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

  ratingCount(star: number): number {
    return this.customerReviews.filter((review) => review.rating === star).length;
  }

  ratingPercentage(star: number): number {
    return this.customerReviews.length
      ? (this.ratingCount(star) / this.customerReviews.length) * 100
      : 0;
  }

  setReviewMediaFilter(filter: ReviewMediaFilter): void {
    this.reviewMediaFilter = filter;
  }

  setReviewRatingFilter(rating: number | null): void {
    this.reviewRatingFilter = rating;
  }

  resetReviewFilters(): void {
    this.reviewMediaFilter = 'all';
    this.reviewRatingFilter = null;
  }

  increaseQuantity(): void {
    this.quantity = Math.min(this.quantity + 1, this.availableStock);
  }

  decreaseQuantity(): void {
    this.quantity = Math.max(1, this.quantity - 1);
  }

  selectProductVariant(variant: ProductVariant, index: number): void {
    this.selectedVariant = variant;
    this.selectedVariantIndex = index;
    this.imageIndex = 0;
  }

  toggleFavorite(): void {
    if (!this.product) return;
    if (!this.isBrowser || window.localStorage.getItem('isLoggedIn') !== 'true') {
      this.dialogService.alert('Bạn cần đăng nhập để sử dụng chức năng này.', 'Yêu cầu đăng nhập', 'warning');
      return;
    }

    try {
      this.isFavorite = this.favorites.toggle(this.product.id);
      this.dialogService.alert(this.isFavorite ? 'Đã lưu sản phẩm vào danh sách yêu thích.' : 'Đã xóa sản phẩm khỏi danh sách yêu thích.', 'Danh sách yêu thích', 'success');
    } catch {
      this.dialogService.alert('Không thể lưu sản phẩm yêu thích. Vui lòng thử lại.', 'Lỗi', 'error');
    }
  }

  addToCart(): void {
    if (!this.product) return;

    try {
      this.cart.addItem({
        productId: String(this.product.id),
        variant: this.selectedVariant?.name ?? null,
        quantity: this.quantity,
      });
      this.toast.show(`Đã thêm "${this.product.name}" vào giỏ hàng.`);
    } catch (error) {
      console.error('Không thể thêm sản phẩm vào giỏ hàng:', error);
      this.toast.show('Không thể cập nhật giỏ hàng. Vui lòng thử lại.', 'error');
    }
  }

  buyNow(): void {
    if (!this.product) return;

    const item = {
      productId: String(this.product.id),
      variant: this.selectedVariant?.name ?? null,
      quantity: this.quantity,
    };

    try {
      this.checkoutSelection.set([item], false);
      void this.router.navigate(['/checkout']);
    } catch (error) {
      console.error('Không thể chuẩn bị sản phẩm thanh toán:', error);
      this.toast.show('Không thể chuyển đến thanh toán. Vui lòng thử lại.', 'error');
    }
  }

  async loadProduct(slug: string): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    this.reviewErrorMessage = '';
    this.statusMessage = '';
    const cachedProduct = this.readCachedProducts().find((item) => item.slug === slug);

    try {
      const response = await window.fetch('/api/products');
      if (!response.ok) {
        throw new Error(`Không thể tải sản phẩm từ server (HTTP ${response.status})`);
      }

      const data: unknown = await response.json();
      const products = this.parseProducts(data);
      const found = products.find((item) => item.slug === slug);
      if (!found) {
        if (cachedProduct) {
          this.setProduct(cachedProduct);
          this.statusMessage = 'Không tìm thấy sản phẩm trên server. Đang hiển thị dữ liệu đã lưu.';
          return;
        }
        this.product = null;
        this.errorMessage = 'Không tìm thấy sản phẩm này.';
        return;
      }

      this.setProduct(found);
      this.isFavorite = this.favorites.has(found.id);
      await this.loadCustomerReviews(found);
      try {
        window.localStorage.setItem('products', JSON.stringify(products));
      } catch (error) {
        console.error('Không thể lưu bộ nhớ đệm sản phẩm:', error);
      }
    } catch (error) {
      console.error('Lỗi tải sản phẩm từ MongoDB:', error);
      if (cachedProduct) {
        this.setProduct(cachedProduct);
        this.statusMessage = 'Không thể kết nối server. Đang hiển thị dữ liệu đã lưu.';
      } else {
        this.product = null;
        this.errorMessage = error instanceof Error
          ? error.message
          : 'Không thể tải sản phẩm từ server. Vui lòng thử lại.';
      }
    } finally {
      this.isLoading = false;
      this.changeDetectorRef.markForCheck();
    }
  }

  private setProduct(product: ProductItem): void {
    this.product = product;
    this.selectedVariant = product.variants?.[0] ?? null;
    this.selectedVariantIndex = 0;
    this.isFavorite = this.favorites.has(product.id);
    this.quantity = 1;
    this.imageIndex = 0;
  }

  private async loadCustomerReviews(product: ProductItem): Promise<void> {
    try {
      const response = await window.fetch(
        `/api/reviews/product/${encodeURIComponent(String(product.id))}`,
      );
      if (!response.ok) {
        throw new Error(`Không thể tải đánh giá sản phẩm (HTTP ${response.status})`);
      }

      const data: unknown = await response.json();
      const reviews = this.isRecord(data) && Array.isArray(data['reviews'])
        ? data['reviews']
        : Array.isArray(data)
          ? data
          : [];
      product.customerReviews = this.parseCustomerReviews(reviews, String(product.id));
      if (product.customerReviews.length) {
        product.reviews = product.customerReviews.length;
        product.rating = this.averageReviewRating;
      }
    } catch (error) {
      console.error('Lỗi tải đánh giá sản phẩm:', error);
      this.reviewErrorMessage = error instanceof Error
        ? error.message
        : 'Không thể tải đánh giá sản phẩm.';
    }
  }

  private readCachedProducts(): ProductItem[] {
    try {
      const saved = window.localStorage.getItem('products');
      return saved ? this.parseProducts(JSON.parse(saved)) : [];
    } catch (error) {
      console.error('Không thể đọc bộ nhớ đệm sản phẩm:', error);
      return [];
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
            image: typeof variant['image'] === 'string' ? variant['image'] : undefined,
          }];
        })
        : [];
      const rawReviews = Array.isArray(record['customerReviews'])
        ? record['customerReviews']
        : Array.isArray(record['reviews'])
          ? record['reviews']
          : [];
      const customerReviews = this.parseCustomerReviews(rawReviews, id);
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
        reviews: this.toNumber(
          record['reviewCount']
          ?? (Array.isArray(record['reviews']) ? customerReviews.length : record['reviews'])
          ?? record['reviewsCount'],
        ),
        stock: this.toNumber(record['stock'] ?? record['quantity']),
        originalPrice,
        currentPrice,
        isSale: record['isSale'] === true || (currentPrice !== undefined && currentPrice < originalPrice),
        variants,
        customerReviews,
      }];
    });
  }

  private parseCustomerReviews(data: unknown, productId: string): CustomerReview[] {
    if (!Array.isArray(data)) return [];

    return data.flatMap((review, index): CustomerReview[] => {
      if (!this.isRecord(review)) return [];
      const rating = this.toNumber(review['rating'] ?? review['rate'] ?? review['stars']);
      if (rating < 1 || rating > 5) return [];
      const variant = review['variant'] ?? review['variantName'] ?? review['selectedVariant'];
      const media = Array.isArray(review['media']) ? review['media'] : [];
      const mediaUrls = (type: 'image' | 'video'): string[] => media.flatMap((item) => {
        if (!this.isRecord(item)) return [];
        const itemType = this.stringValue(item['type']).toLowerCase();
        const url = this.optionalString(item['url'] ?? item['src']);
        return url && (itemType === type || itemType === `${type}s`) ? [url] : [];
      });
      const variantName = this.isRecord(variant)
        ? this.stringValue(variant['name'] ?? variant['label'])
        : this.stringValue(variant);

      return [{
        id: typeof review['id'] === 'string'
          ? review['id']
          : typeof review['_id'] === 'string'
            ? review['_id']
            : `${productId}-review-${index}`,
        customerName: this.stringValue(
          review['customerName'] ?? review['userName'] ?? review['author'] ?? review['name'],
        ) || 'Khách hàng',
        avatar: this.optionalString(review['avatar'] ?? review['avatarUrl']),
        rating,
        comment: this.stringValue(review['comment'] ?? review['content'] ?? review['text']),
        variantName,
        createdAt: this.optionalString(review['createdAt'] ?? review['date']),
        images: [...this.stringArray(review['images'] ?? review['photos'] ?? review['imageUrls']), ...mediaUrls('image')],
        videos: [...this.stringArray(review['videos'] ?? review['videoUrls']), ...mediaUrls('video')],
      }];
    });
  }

  private stringArray(value: unknown): string[] {
    if (typeof value === 'string' && value.trim()) return [value.trim()];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        .map((item) => item.trim())
      : [];
  }

  private stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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

}
