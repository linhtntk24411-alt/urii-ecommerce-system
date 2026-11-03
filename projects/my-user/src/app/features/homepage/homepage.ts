import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { RouterModule } from '@angular/router'; 
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';

interface HomeProduct {
  id: string | number;
  slug: string;
  name: string;
  image: string;
  isSale: boolean;
  badge: string;
  originalPrice: number;
  currentPrice: number;
  stock: number;
  stockPercent: number;
  reviews: number;
}

@Component({
  selector: 'app-homepage',
  templateUrl: './homepage.html',
  styleUrls: ['./homepage.css'], 
  standalone: true, 
  imports: [CommonModule, RouterModule]
})
export class HomepageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  valuesData = [
    { icon: 'bi-shield-check', title: 'Chất liệu an toàn', desc: 'Hạt nhựa nguyên sinh không độc hại, an toàn cho mọi lứa tuổi' },
    { icon: 'bi-truck', title: 'Giao hàng nhanh chóng', desc: 'Ship COD toàn quốc, kiểm hàng trước khi nhận' },
    { icon: 'bi-headset', title: 'Hỗ trợ 24/7', desc: 'Tặng map mẫu và hướng dẫn ủi nhiệt miễn phí' }
  ];

  categoriesData = [
    { name: 'Bộ KIT DIY', image: 'assets/index/kit.jpg', category: 'kit' },
    { name: 'Dụng Cụ', image: 'assets/index/dungcu.png', category: 'tool' },
    { name: 'Hạt Lẻ Các Loại', image: 'assets/index/hatrefill.png', category: 'bead' },
    { name: 'Phụ Kiện Handmade', image: 'assets/index/handmade.jpg', category: 'accessory' }
  ];

  stepsData = [
    { number: '01', image: 'assets/index/step1.png', title: 'Xếp hạt lên bảng đinh', desc: 'Chọn màu sắc và xếp hạt nhựa lên bảng đinh theo map mẫu' },
    { number: '02', image: 'assets/index/step2.png', title: 'Phủ giấy nến & Ủi nhiệt', desc: 'Đặt giấy nến lên trên và ủi ở nhiệt độ phù hợp' },
    { number: '03', image: 'assets/index/step3.png', title: 'Hoàn thành tác phẩm', desc: 'Tháo sản phẩm hoàn thiện ra khỏi bảng đinh' }
  ];

  galleryData = [
    'assets/index/stcd1.png', 'assets/index/stcd2.png', 'assets/index/stcd3.png',
    'assets/index/stcd4.png', 'assets/index/stcd5.png', 'assets/index/stcd6.png'
  ];

  bestSellers: HomeProduct[] = [];
  isLoading = false;
  errorMessage = '';

  ngOnInit(): void {
    if (this.isBrowser) {
      this.loadBestSellers();
    }
  }

  loadBestSellers(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.http.get<unknown>('/api/products').pipe(
      map((data) => this.parseProducts(data)),
    ).subscribe({
      next: (products) => {
        this.bestSellers = [...products]
          .sort((a, b) => b.reviews - a.reviews)
          .slice(0, 4);
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Lỗi tải sản phẩm trang chủ:', error);
        this.bestSellers = [];
        this.errorMessage = 'Không thể tải sản phẩm. Vui lòng thử lại.';
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  trackProduct(_index: number, product: HomeProduct): string | number {
    return product.id;
  }

  private parseProducts(data: unknown): HomeProduct[] {
    const records = Array.isArray(data)
      ? data
      : this.isRecord(data) && Array.isArray(data['products'])
        ? data['products']
        : [];

    return records.flatMap((record): HomeProduct[] => {
      if (!this.isRecord(record)) return [];

      const rawId = record['id'] ?? record['_id'];
      const id = typeof rawId === 'string' || typeof rawId === 'number'
        ? rawId
        : this.isRecord(rawId) && typeof rawId['$oid'] === 'string'
          ? rawId['$oid']
          : null;
      const name = record['name'] ?? record['productName'];
      if (id === null || typeof name !== 'string') return [];

      const rawImage = record['image'] ?? record['imageUrl'] ?? record['images'];
      const image = typeof rawImage === 'string'
        ? rawImage
        : Array.isArray(rawImage) && typeof rawImage[0] === 'string'
          ? rawImage[0]
          : 'assets/product/7.png';
      const originalPrice = this.toNumber(record['originalPrice'] ?? record['price']);
      const currentPrice = this.toNumber(record['currentPrice'] ?? record['salePrice'] ?? originalPrice);
      const stock = this.toNumber(record['stock'] ?? record['quantity']);
      const discountPercent = originalPrice > currentPrice && originalPrice > 0
        ? Math.round((1 - currentPrice / originalPrice) * 100)
        : 0;

      return [{
        id,
        slug: typeof record['slug'] === 'string' && record['slug'].trim()
          ? record['slug'].trim()
          : this.slugify(name),
        name,
        image,
        isSale: record['isSale'] === true || discountPercent > 0,
        badge: discountPercent > 0 ? `-${discountPercent}%` : 'Ưu đãi',
        originalPrice,
        currentPrice,
        stock,
        stockPercent: this.toNumber(record['stockPercent']) || Math.min(stock, 100),
        reviews: this.toNumber(record['reviews'] ?? record['reviewCount']),
      }];
    });
  }

  private toNumber(value: unknown): number {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : 0;
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}