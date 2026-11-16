import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ChangeDetectorRef, Component, inject, OnInit, PLATFORM_ID } from '@angular/core';
import { RouterLink } from '@angular/router';

interface CustomerReview {
  id: string;
  orderId: string;
  productId: string;
  productSlug: string;
  productName: string;
  productImage: string;
  rating: number;
  variantName: string;
  content: string;
  createdAt: string;
  media: ReviewMedia[];
  replies?: ReviewReply[];
}

interface ReviewReply {
  author: string;
  content: string;
  createdAt: string;
}

interface ReviewMedia {
  type: 'image' | 'video';
  url: string;
}

@Component({
  imports: [CommonModule, RouterLink],
  selector: 'app-my-reviews',
  styleUrl: './my-reviews.css',
  templateUrl: './my-reviews.html',
})
export class MyReviews implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly ratingStars = [1, 2, 3, 4, 5];
  reviews: CustomerReview[] = [];
  isLoading = true;
  requiresLogin = false;
  errorMessage = '';

  // Bộ lọc đánh giá
  activeFilter: 'all' | 5 | 4 | 3 | 'low' | 'media' = 'all';

  // Lightbox xem ảnh/video phóng to
  activeMediaModal: ReviewMedia | null = null;

  ngOnInit(): void {
    if (!this.isBrowser) return;
    const token = this.getToken();
    if (!token) {
      this.requiresLogin = true;
      this.isLoading = false;
      return;
    }

    this.http.get<unknown>('/api/reviews/mine', {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
    }).subscribe({
      next: (response) => {
        if (!Array.isArray(response)) {
          this.errorMessage = 'Dữ liệu đánh giá nhận được không hợp lệ.';
        } else {
          this.reviews = response.flatMap((record): CustomerReview[] => {
            if (!this.isRecord(record)) return [];
            const product = this.isRecord(record['product']) ? record['product'] : {};
            const id = this.text(record['id'] ?? record['_id']);
            const rating = record['rating'];
            if (!id || typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) return [];

            const rawReplies = Array.isArray(record['replies']) ? record['replies'] : [];
            const replies: ReviewReply[] = rawReplies
              .filter((r) => this.isRecord(r))
              .map((r) => ({
                author: this.text(r['author']) || 'Urii Official Store',
                content: this.text(r['content']),
                createdAt: this.text(r['createdAt']),
              }));

            return [{
              id,
              orderId: this.text(record['orderId']),
              productId: this.text(record['productId']),
              productSlug: this.text(product['slug'] || record['productId']),
              productName: this.text(product['name']) || 'Sản phẩm Urii',
              productImage: this.normalizeImage(this.text(product['image'])),
              rating,
              variantName: this.text(record['variantName']),
              content: this.text(record['content']),
              createdAt: this.text(record['createdAt']),
              media: this.parseMedia(record['media']),
              replies,
            }];
          });
        }
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => this.handleError(error),
    });
  }

  get filteredReviews(): CustomerReview[] {
    if (this.activeFilter === 'all') return this.reviews;
    if (this.activeFilter === 'media') {
      return this.reviews.filter((r) => r.media && r.media.length > 0);
    }
    if (this.activeFilter === 'low') {
      return this.reviews.filter((r) => r.rating <= 2);
    }
    return this.reviews.filter((r) => r.rating === this.activeFilter);
  }

  get averageRating(): string {
    if (!this.reviews.length) return '5.0';
    const sum = this.reviews.reduce((acc, r) => acc + r.rating, 0);
    return (sum / this.reviews.length).toFixed(1);
  }

  getStarCount(star: number): number {
    return this.reviews.filter((r) => r.rating === star).length;
  }

  getMediaReviewCount(): number {
    return this.reviews.filter((r) => r.media && r.media.length > 0).length;
  }

  getLowStarCount(): number {
    return this.reviews.filter((r) => r.rating <= 2).length;
  }

  setFilter(filter: 'all' | 5 | 4 | 3 | 'low' | 'media'): void {
    this.activeFilter = filter;
  }

  ratingLabel(rating: number): string {
    switch (rating) {
      case 5: return 'Tuyệt vời';
      case 4: return 'Hài lòng';
      case 3: return 'Bình thường';
      case 2: return 'Chưa hài lòng';
      case 1: return 'Rất tệ';
      default: return '';
    }
  }

  openMedia(media: ReviewMedia): void {
    this.activeMediaModal = media;
  }

  closeMedia(): void {
    this.activeMediaModal = null;
  }

  private getToken(): string {
    const token = localStorage.getItem('authToken');
    return localStorage.getItem('isLoggedIn') === 'true' ? token || '' : '';
  }

  private handleError(error: unknown): void {
    console.error('Không thể tải đánh giá của khách hàng:', error);
    this.errorMessage = error instanceof HttpErrorResponse && error.status === 401
      ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
      : 'Không thể tải đánh giá của bạn.';
    this.isLoading = false;
    this.changeDetectorRef.markForCheck();
  }

  private text(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  }

  private normalizeImage(value: string): string {
    if (value.startsWith('/images/')) return `/api${value}`;
    if (value.startsWith('images/')) return `/api/${value}`;
    return value;
  }

  private parseMedia(value: unknown): ReviewMedia[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): ReviewMedia[] => {
      if (!this.isRecord(item)) return [];
      const type = item['type'];
      const url = this.normalizeImage(this.text(item['url']));
      return (type === 'image' || type === 'video') && url ? [{ type, url }] : [];
    });
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
