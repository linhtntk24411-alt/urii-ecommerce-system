import { Injectable, PLATFORM_ID, Inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, firstValueFrom, from, map, mergeMap, switchMap, tap, timeout, toArray } from 'rxjs';

export interface AdminUser {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  joinDate?: string;
  orders?: number;
  maps?: number;
  birth?: string;
  address?: string;
  role: 'user' | 'admin';
  status?: 'active' | 'pending_verify' | 'locked';
  createdAt?: string;
}

export interface UserPayload {
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  joinDate?: string;
  address?: string;
  role: 'user' | 'admin';
  password?: string;
}

export interface Promotion {
  _id: string;
  id: string;
  code: string;
  name: string;
  description?: string;
  type: 'shipping' | 'percent' | 'fixed';
  discountValue: number;
  minOrder: number;
  maxDiscount?: number | null;
  startDate?: string;
  endDate?: string;
  quantity?: number | null;
  used: number;
  isActive: boolean;
  createdAt?: string;
}

export type PromotionPayload = Omit<Promotion, '_id' | 'id' | 'used'>;

export interface DashboardStats {
  products: number;
  orders: number;
  users: number;
  promotions: number;
  activePromotions: number;
  pendingOrders: number;
}

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
}

export interface AdminOrder {
  _id?: string;
  id: string;
  userName: string;
  date: string;
  status: string;
  statusType: string;
  total: string;
  icon?: string;
  items: OrderItem[];
  payment?: { method: string; status: string };
  shipping?: { carrier: string; method: string; trackingNumber: string; fee: number };
  address?: { name: string; phone: string; address: string };
  createdAt?: string;
}

export interface AdminProduct {
  _id?: string;
  id: string;
  name: string;
  slug: string;
  category: string;
  image: string;
  isSale?: boolean;
  originalPrice?: number;
  currentPrice: number;
  stock: number;
  description?: string;
}

export interface AdminBlog {
  _id?: string;
  id: number;
  title: string;
  slug: string;
  excerpt?: string;
  content?: string;
  image?: string;
  author: string;
  avatar?: string;
  date: string;
  category?: string;
  likes?: number;
  comments?: number;
  views?: number;
  thumbnail?: string;
  status?: 'pending' | 'approved' | 'rejected' | 'violated';
  visible?: boolean;
  createdAt?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
}

export interface AdminComment {
  id: number;
  blogId: number;
  author: string;
  avatar?: string;
  content: string;
  time?: string;
  createdAt?: string;
}

export interface AdminReview {
  id: string;
  productId: string;
  userId: string;
  productName: string;
  userName: string;
  userAvatar?: string;
  rating: number;
  content: string;
  createdAt?: string;
}

interface LoginResponse {
  token: string;
  user: { id: string; name: string; email: string; role: string };
}

const FALLBACK_USERS: AdminUser[] = [
  {
    _id: 'u1',
    name: 'Nguyễn Minh Anh',
    joinDate: '15/03/2024',
    avatar: 'images/avatar_user.jpeg',
    orders: 6,
    maps: 45,
    phone: '0901 234 567',
    email: 'minhanh.uri@gmail.com',
    birth: '12/08/1998',
    address: '123 Đường Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh',
    role: 'user',
    status: 'active'
  },
  {
    _id: 'u2',
    name: 'Trần Thị Bảo Ngọc',
    joinDate: '10/05/2024',
    avatar: 'images/avatar_user1.jpeg',
    orders: 6,
    maps: 18,
    phone: '0912 345 678',
    email: 'baongoc.uri@gmail.com',
    birth: '25/03/1999',
    address: '45 Lê Lợi, Phường Bến Thành, Quận 1, TP. Hồ Chí Minh',
    role: 'user',
    status: 'active'
  },
  {
    _id: 'u3',
    name: 'Lê Hoàng Nam',
    joinDate: '12/04/2024',
    avatar: 'images/avatar_user3.jpeg',
    orders: 6,
    maps: 27,
    phone: '0987 654 321',
    email: 'hoangnam.uri@gmail.com',
    birth: '07/11/1997',
    address: '78 Nguyễn Trãi, Phường 3, Quận 5, TP. Hồ Chí Minh',
    role: 'user',
    status: 'pending_verify'
  },
  {
    _id: 'u4',
    name: 'Phạm Thu Hà',
    joinDate: '20/03/2024',
    avatar: 'images/avatar_user2.jpeg',
    orders: 6,
    maps: 12,
    phone: '0938 111 222',
    email: 'thuha.uri@gmail.com',
    birth: '18/06/2000',
    address: '12 Phan Xích Long, Phường 2, Quận Phú Nhuận, TP. Hồ Chí Minh',
    role: 'user',
    status: 'active'
  },
  {
    _id: 'u5',
    name: 'Đỗ Quang Huy',
    joinDate: '05/02/2024',
    avatar: 'images/avatar-non.jpg',
    orders: 6,
    maps: 33,
    phone: '0967 888 999',
    email: 'quanghuy.uri@gmail.com',
    birth: '30/09/1996',
    address: '256 Cách Mạng Tháng 8, Phường 10, Quận 3, TP. Hồ Chí Minh',
    role: 'user',
    status: 'locked'
  },
  {
    _id: 'u6',
    name: 'Vũ Khánh Linh',
    joinDate: '01/05/2024',
    avatar: 'images/avatar-non.jpg',
    orders: 6,
    maps: 9,
    phone: '0909 333 444',
    email: 'khanhlinh.uri@gmail.com',
    birth: '14/02/2001',
    address: '88 Hoàng Diệu, Phường 6, Quận 4, TP. Hồ Chí Minh',
    role: 'user',
    status: 'active'
  },
  {
    _id: 'u7',
    name: 'Urii Admin',
    joinDate: '01/01/2024',
    avatar: 'images/avatar-non.jpg',
    orders: 0,
    maps: 0,
    phone: '0909 888 777',
    email: 'admin@gmail.com',
    birth: '15/05/1990',
    address: 'Số 1, Đường Nguyễn Du, Phường Bến Thành, Quận 1, TP. Hồ Chí Minh',
    role: 'admin',
    status: 'active'
  }
];

const FALLBACK_PROMOTIONS: Promotion[] = [
  {
    _id: 'v1',
    id: 'FREESHIP',
    code: 'FREESHIP',
    name: 'Miễn phí vận chuyển',
    description: 'Giảm tối đa 30.000đ phí vận chuyển cho đơn từ 100.000đ',
    type: 'shipping',
    discountValue: 30000,
    minOrder: 100000,
    maxDiscount: 30000,
    startDate: '01/05/2024',
    endDate: '31/12/2027',
    quantity: 500,
    used: 123,
    isActive: true
  },
  {
    _id: 'v2',
    id: 'WELCOME10',
    code: 'WELCOME10',
    name: 'Chào mừng thành viên mới',
    description: 'Giảm 10% cho đơn đầu tiên, tối đa 20.000đ (đơn từ 50.000đ)',
    type: 'percent',
    discountValue: 10,
    minOrder: 50000,
    maxDiscount: 20000,
    startDate: '01/01/2024',
    endDate: '31/12/2027',
    quantity: 1000,
    used: 456,
    isActive: true
  },
  {
    _id: 'v3',
    id: 'GIAM10K',
    code: 'GIAM10K',
    name: 'Giảm ngay 10.000đ',
    description: 'Giảm 10.000đ cho đơn từ 50.000đ',
    type: 'fixed',
    discountValue: 10000,
    minOrder: 50000,
    maxDiscount: 10000,
    startDate: '01/06/2024',
    endDate: '31/12/2027',
    quantity: 300,
    used: 87,
    isActive: true
  },
  {
    _id: 'v4',
    id: 'SALE15',
    code: 'SALE15',
    name: 'Sale 15% toàn bộ',
    description: 'Giảm 15% tối đa 30.000đ cho đơn từ 70.000đ',
    type: 'percent',
    discountValue: 15,
    minOrder: 70000,
    maxDiscount: 30000,
    startDate: '01/07/2024',
    endDate: '31/12/2027',
    quantity: 200,
    used: 34,
    isActive: true
  },
  {
    _id: 'v5',
    id: 'HAPPYDAY',
    code: 'HAPPYDAY',
    name: 'Ngày vui giảm 30k',
    description: 'Giảm 30.000đ cho đơn từ 200.000đ',
    type: 'fixed',
    discountValue: 30000,
    minOrder: 200000,
    maxDiscount: 30000,
    startDate: '01/05/2024',
    endDate: '30/06/2024',
    quantity: 150,
    used: 67,
    isActive: false
  }
];

const FALLBACK_ORDERS: AdminOrder[] = [
  {
    id: 'UR-82901',
    userName: 'Nguyễn Minh Anh',
    date: '20/05/2024',
    status: 'Chờ xác nhận',
    statusType: 'pending',
    total: '15.000đ',
    items: [
      {
        productId: '1075483767',
        name: 'Bút Đặt Hạt Tự Động 2.6mm',
        price: 15000,
        quantity: 1,
        image: 'https://cdn.hstatic.net/products/200001193910/sg-11134201-81zut-mmzv8ahrn6kg08_310c94be477d4ca4a635bb252881a2f8.webp'
      }
    ],
    payment: { method: 'Thanh toán khi nhận hàng (COD)', status: 'Chưa thanh toán' },
    address: { name: 'Nguyễn Minh Anh', phone: '0901 234 567', address: '123 Đường Nguyễn Huệ, Q.1, TP.HCM' }
  },
  {
    id: 'UR-82906',
    userName: 'Vũ Khánh Linh',
    date: '25/05/2024',
    status: 'Chờ xác nhận',
    statusType: 'pending',
    total: '58.000đ',
    items: [
      {
        productId: '1075486180',
        name: 'Bộ Hạt Xếp Hình - Combo Handmade DIY Nhẵn Mịn',
        price: 68000,
        quantity: 1,
        image: 'https://cdn.hstatic.net/products/200001193910/screenshot_2026-07-09_030756_fc41e98c92554127b69b389763080b5f.png'
      }
    ],
    payment: { method: 'Chuyển khoản ngân hàng', status: 'Đã thanh toán' },
    address: { name: 'Vũ Khánh Linh', phone: '0909 333 444', address: '88 Hoàng Diệu, Q.4, TP.HCM' }
  },
  {
    id: 'UR-83011',
    userName: 'Nguyễn Minh Anh',
    date: '01/06/2024',
    status: 'Chờ lấy hàng',
    statusType: 'processing',
    total: '68.000đ',
    items: [
      {
        productId: '1075486180',
        name: 'Bộ Hạt Xếp Hình - Combo Handmade DIY Nhẵn Mịn',
        price: 68000,
        quantity: 1,
        image: 'https://cdn.hstatic.net/products/200001193910/screenshot_2026-07-09_030756_fc41e98c92554127b69b389763080b5f.png'
      }
    ],
    payment: { method: 'Chuyển khoản ngân hàng', status: 'Đã thanh toán' },
    address: { name: 'Nguyễn Minh Anh', phone: '0901 234 567', address: '123 Đường Nguyễn Huệ, Q.1, TP.HCM' }
  },
  {
    id: 'UR-83022',
    userName: 'Trần Thị Bảo Ngọc',
    date: '03/07/2024',
    status: 'Đã giao',
    statusType: 'completed',
    total: '61.200đ',
    items: [
      {
        productId: '1075486180',
        name: 'Bộ Hạt Xếp Hình - Combo Handmade DIY Nhẵn Mịn',
        price: 68000,
        quantity: 1,
        image: 'https://cdn.hstatic.net/products/200001193910/screenshot_2026-07-09_030756_fc41e98c92554127b69b389763080b5f.png'
      }
    ],
    payment: { method: 'Chuyển khoản ngân hàng', status: 'Đã thanh toán' },
    address: { name: 'Trần Thị Bảo Ngọc', phone: '0912 345 678', address: '45 Lê Lợi, Q.1, TP.HCM' }
  },
  {
    id: 'UR-83026',
    userName: 'Vũ Khánh Linh',
    date: '11/07/2024',
    status: 'Đã giao',
    statusType: 'completed',
    total: '68.000đ',
    items: [
      {
        productId: '1075486180',
        name: 'Bộ Hạt Xếp Hình - Combo Handmade DIY Nhẵn Mịn',
        price: 68000,
        quantity: 1,
        image: 'https://cdn.hstatic.net/products/200001193910/screenshot_2026-07-09_030756_fc41e98c92554127b69b389763080b5f.png'
      }
    ],
    payment: { method: 'Thanh toán khi nhận hàng (COD)', status: 'Đã thanh toán' },
    address: { name: 'Vũ Khánh Linh', phone: '0909 333 444', address: '88 Hoàng Diệu, Q.4, TP.HCM' }
  }
];

const FALLBACK_PRODUCTS: AdminProduct[] = [
  {
    id: '1075483768',
    name: 'DIY KIT Rainbow 48 Màu',
    slug: 'products-kit',
    category: 'KIT',
    image: 'https://cdn.hstatic.net/products/200001193910/set_h_t_nh_a_urii_rainbow_48_m_u_4ce5db5cf38d45a68edca10c15bf227e.png',
    currentPrice: 69000,
    stock: 12
  },
  {
    id: '1075486161',
    name: 'Mô Hình Hạt Nhựa Ủi Thành Phẩm Sakabooon',
    slug: 'mo-hinh-hat-nhua-ui-thuc-pham-sakabooon',
    category: 'TP',
    image: 'https://cdn.hstatic.net/products/200001193910/12_ea1aea881164402a91baa18fb750921b.jpg',
    currentPrice: 12000,
    stock: 40
  },
  {
    id: '1075483767',
    name: 'Bút Đặt Hạt Tự Động 2.6mm (Pro)',
    slug: 'products-but',
    category: 'DC',
    image: 'https://cdn.hstatic.net/products/200001193910/sg-11134201-81zut-mmzv8ahrn6kg08_310c94be477d4ca4a635bb252881a2f8.webp',
    currentPrice: 15000,
    stock: 5
  }
];

const FALLBACK_BLOGS: AdminBlog[] = [
  {
    id: 1,
    title: 'Chiều cuối tuần trốn thế giới bên góc bàn nhỏ',
    slug: 'chieu-cuoi-tuan-tron-the-gioi-ben-goc-ban-nho',
    image: 'images/index/stcd1.png',
    author: 'Minh Anh',
    avatar: 'images/avatar_user.jpeg',
    date: '24 Tháng 5, 2024',
    category: 'Hướng dẫn DIY',
    views: 1024,
    likes: 128
  },
  {
    id: 2,
    title: 'Em cáo cam siêu chữa lành cho ngày mệt mỏi',
    slug: 'em-cao-cam-sieu-chua-lanh-cho-ngay-met-moi',
    image: 'images/index/stcd2.png',
    author: 'Minh Anh',
    avatar: 'images/avatar_user.jpeg',
    date: '22 Tháng 5, 2024',
    category: 'Ý tưởng thiết kế',
    views: 512,
    likes: 86
  },
  {
    id: 3,
    title: 'Khi bạn khóc nhưng trông vẫn... buồn cười',
    slug: 'khi-ban-khoc-nhung-trong-van-buon-cuoi',
    image: 'images/index/stcd3.png',
    author: 'Đỗ Quang Huy',
    avatar: 'images/avatar-non.jpg',
    date: '20 Tháng 5, 2024',
    category: 'Góc nghệ thuật',
    views: 2048,
    likes: 215
  }
];

@Injectable({
  providedIn: 'root'
})
export class AdminApiService {
  private baseUrl = 'http://localhost:3002/api';
  private backendOrigin = 'http://localhost:3002';

  readonly token = signal<string | null>(null);

  // Token được truyền trực tiếp từ trang đăng nhập
  private currentAuthToken = '';

  private productsSubject = new BehaviorSubject<any[]>([]);
  public products$ = this.productsSubject.asObservable();

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    // Hiển thị dữ liệu cache trước để giao diện không bị trống
    this.productsSubject.next(this.readCachedProducts());

    // Khôi phục phiên đăng nhập và tải dữ liệu từ API
    this.restoreSession();
    this.loadProducts();
  }

  // --- 1. QUẢN LÝ TOKEN VÀ ĐĂNG NHẬP ---

  public setToken(token: string): void {
    this.currentAuthToken = token;
    this.token.set(token);
  }

  private getAuthHeaders(): HttpHeaders {
    let authToken = this.currentAuthToken || this.token() || '';

    if (!authToken && isPlatformBrowser(this.platformId)) {
      authToken =
        localStorage.getItem('adminToken') ||
        localStorage.getItem('token') ||
        localStorage.getItem('urii-admin-token') ||
        '';
    }

    return new HttpHeaders({
      Authorization: `Bearer ${authToken}`
    });
  }

  restoreSession(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const saved =
      localStorage.getItem('urii-admin-token') ||
      localStorage.getItem('token') ||
      localStorage.getItem('adminToken');

    if (saved && !saved.startsWith('fake-')) {
      this.currentAuthToken = saved;
      this.token.set(saved);
    }
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await this.requestWithFallback<LoginResponse>(
      'POST',
      '/api/auth/login',
      { email, password }
    );

    if (response.user.role !== 'admin') {
      throw new Error('Tài khoản này không có quyền quản trị.');
    }

    this.setToken(response.token);

    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('urii-admin-token', response.token);
      localStorage.setItem('token', response.token);
    }

    return response;
  }

  logout(): void {
    this.currentAuthToken = '';
    this.token.set(null);

    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('urii-admin-token');
      localStorage.removeItem('token');
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminUser');
    }
  }

  // --- 2. HỖ TRỢ ĐƯỜNG DẪN HÌNH ẢNH ---

  resolveImageUrl(
    imagePath?: string | null,
    fallback = 'assets/avatar-non.jpg'
  ): string {
    if (!imagePath || !imagePath.trim()) {
      return fallback;
    }

    const clean = imagePath.trim();

    if (
      clean.startsWith('http://') ||
      clean.startsWith('https://') ||
      clean.startsWith('data:') ||
      clean.startsWith('assets/')
    ) {
      return clean;
    }

    return clean.replace(/^\/+/, '');
  }

  resolveBackendImageUrl(
    imagePath?: string | null,
    fallback = 'images/avatar_user.jpeg'
  ): string {
    if (!imagePath || !imagePath.trim()) {
      return fallback;
    }

    const clean = imagePath.trim();

    if (
      clean.startsWith('http://') ||
      clean.startsWith('https://') ||
      clean.startsWith('data:')
    ) {
      return clean;
    }

    if (clean.includes('avatar1.png')) {
      return '/images/avatar_user1.jpeg';
    }

    if (clean.includes('avatar2.png')) {
      return '/images/avatar_user2.jpeg';
    }

    if (clean.startsWith('assets/') || clean.startsWith('images/')) {
      return clean.startsWith('/') ? clean : `/${clean}`;
    }

    const normalized = clean.replace(/^\/+/, '');
    return `/${normalized}`;
  }

  // --- 3. QUẢN LÝ SẢN PHẨM ---

  public loadProducts(): void {
    // Không truy cập localStorage khi chạy SSR
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const headers = this.getAuthHeaders();

    this.http.get<any>(`${this.baseUrl}/products`, { headers }).subscribe({
      next: (res) => {
        const productList = Array.isArray(res)
          ? res
          : res?.products;

        if (!Array.isArray(productList)) {
          console.error('API sản phẩm trả về dữ liệu không hợp lệ:', res);
          return;
        }

        this.productsSubject.next(productList);

        try {
          localStorage.setItem(
            'urii_admin_products',
            JSON.stringify(productList)
          );
        } catch (error) {
          console.error('Không thể lưu cache sản phẩm:', error);
        }
      },
      error: (err) => {
        console.error('Lỗi tải sản phẩm:', err);
        this.productsSubject.next(this.readCachedProducts());
      }
    });
  }

  private readCachedProducts(): any[] {
    if (!isPlatformBrowser(this.platformId)) {
      return [];
    }

    try {
      const cached = localStorage.getItem('urii_admin_products');

      if (!cached) {
        return [];
      }

      const products = JSON.parse(cached);

      if (Array.isArray(products)) {
        return products;
      }

      console.error('Cache sản phẩm không đúng định dạng.');
    } catch (error) {
      console.error('Không thể đọc cache sản phẩm:', error);
    }

    return [];
  }

  public addProduct(productData: any): Observable<any> {
    const headers = this.getAuthHeaders();

    return this.http.post(
      `${this.baseUrl}/products`,
      productData,
      { headers }
    ).pipe(
      tap(() => this.loadProducts())
    );
  }

  public updateProduct(
    id: string | number,
    productData: any
  ): Observable<any> {
    const headers = this.getAuthHeaders();

    return this.http.put(
      `${this.baseUrl}/products/${id}`,
      productData,
      { headers }
    ).pipe(
      tap(() => this.loadProducts())
    );
  }

  public deleteProduct(id: string | number): Observable<any> {
    const headers = this.getAuthHeaders();

    return this.http.delete(
      `${this.baseUrl}/products/${id}`,
      { headers }
    ).pipe(
      tap(() => this.loadProducts())
    );
  }

  // --- 4. LOCAL CACHE HELPERS ---

  getCached<T>(key: string, fallback: T): T {
    if (isPlatformBrowser(this.platformId)) {
      try {
        const item = localStorage.getItem(key);

        if (item) {
          const parsed = JSON.parse(item);

          if (Array.isArray(parsed) ? parsed.length > 0 : parsed) {
            return parsed;
          }
        }
      } catch {
        // Dùng dữ liệu fallback nếu cache lỗi
      }
    }

    return fallback;
  }

  setCached<T>(key: string, data: T): void {
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch {
        // Không làm gián đoạn chức năng chính nếu không lưu được cache
      }
    }
  }

  getInitialPromotions(): Promotion[] {
    return this.getCached<Promotion[]>(
      'urii_admin_promotions',
      FALLBACK_PROMOTIONS
    );
  }

  getInitialUsers(): AdminUser[] {
    return this.getCached<AdminUser[]>(
      'urii_admin_users',
      FALLBACK_USERS
    );
  }

  getInitialOrders(): AdminOrder[] {
    return this.getCached<AdminOrder[]>(
      'urii_admin_orders',
      FALLBACK_ORDERS
    );
  }

  getInitialProducts(): AdminProduct[] {
    return this.getCached<AdminProduct[]>(
      'urii_admin_products',
      FALLBACK_PRODUCTS
    );
  }

  getInitialBlogs(): AdminBlog[] {
    return this.getCached<AdminBlog[]>(
      'urii_admin_blogs',
      FALLBACK_BLOGS
    );
  }

  getComments(): Observable<AdminComment[]> {
    return this.http
      .get<AdminComment[]>(`${this.baseUrl}/comments?page=1&limit=100`)
      .pipe(timeout(8000));
  }

  getAdminReviews(): Observable<AdminReview[]> {
    return this.http
      .get<AdminProduct[]>(`${this.baseUrl}/products?page=1&limit=100`)
      .pipe(
        timeout(8000),
        switchMap((products) => from(products).pipe(
          mergeMap((product) => this.http
            .get<{
              productName: string;
              reviews: Array<Omit<AdminReview, 'productName' | 'userAvatar'>>;
            }>(`${this.baseUrl}/reviews/product/${encodeURIComponent(product.id)}?page=1&limit=100`)
            .pipe(
              timeout(8000),
              map((response) => response.reviews.map((review) => ({
                ...review,
                productName: response.productName || product.name
              })))
            ),
          8),
          toArray(),
          map((reviewsByProduct) => reviewsByProduct.flat().sort(
            (left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || '')
          )),
          switchMap((reviews) => this.http
            .get<AdminUser[]>(`${this.baseUrl}/users?page=1&limit=100`, {
              headers: this.getAuthHeaders()
            })
            .pipe(
              timeout(8000),
              map((users) => {
                const avatarsByUserId = new Map(
                  users.map((user) => [user._id, user.avatar || ''])
                );
                return reviews.map((review) => ({
                  ...review,
                  userAvatar: avatarsByUserId.get(review.userId) || ''
                }));
              })
            ))
        ))
      );
  }

  getInitialDashboard(): DashboardStats {
    const users = this.getInitialUsers();
    const promos = this.getInitialPromotions();

    const defaultStats: DashboardStats = {
      products: 34,
      orders: 30,
      users: users.length,
      promotions: promos.length,
      activePromotions: promos.filter((p) => p.isActive).length,
      pendingOrders: 6
    };

    return this.getCached<DashboardStats>(
      'urii_admin_dashboard',
      defaultStats
    );
  }

  // --- 5. API SẢN PHẨM DẠNG PROMISE ---

  async getProducts(): Promise<AdminProduct[]> {
    try {
      const data = await this.requestWithFallback<any>(
        'GET',
        '/api/products?page=1&limit=100'
      );

      const list = Array.isArray(data)
        ? data
        : (data?.products || data?.data || []);

      if (list.length > 0) {
        this.setCached('urii_admin_products', list);
        return list;
      }
    } catch (error) {
      console.error('Lỗi tải sản phẩm từ API, sử dụng dữ liệu cache:', error);
    }

    return this.getInitialProducts();
  }

  async createProduct(
    payload: Partial<AdminProduct>
  ): Promise<AdminProduct> {
    return this.requestWithFallback<AdminProduct>(
      'POST',
      '/api/products',
      payload
    );
  }

  // --- 6. QUẢN LÝ ĐƠN HÀNG ---

  public getOrders(): Observable<any> {
    let authToken = this.currentAuthToken || this.token() || '';

    if (!authToken && isPlatformBrowser(this.platformId)) {
      authToken =
        localStorage.getItem('token') ||
        localStorage.getItem('adminToken') ||
        '';
    }

    const headers = new HttpHeaders({
      Authorization: `Bearer ${authToken}`
    });

    return this.http.get<any>(
      `${this.baseUrl}/orders`,
      { headers }
    );
  }

  public getCustomOrders(): Observable<any> {
    return this.http.get<any>(
      `${this.baseUrl}/custom-orders?page=1&limit=100`,
      { headers: this.getAuthHeaders() }
    );
  }

  public updateOrder(id: string, data: any): Observable<any> {
    const headers = this.getAuthHeaders();

    return this.http.patch(
      `${this.baseUrl}/orders/${encodeURIComponent(id)}`,
      data,
      { headers }
    );
  }

  public deleteOrder(id: string): Observable<any> {
    const headers = this.getAuthHeaders();

    return this.http.delete(
      `${this.baseUrl}/orders/${encodeURIComponent(id)}`,
      { headers }
    );
  }

  async getOrdersAsync(): Promise<AdminOrder[]> {
    try {
      const data = await this.requestWithFallback<any>(
        'GET',
        '/api/orders?page=1&limit=100'
      );

      const list = Array.isArray(data)
        ? data
        : (data?.orders || data?.data || []);

      if (list.length > 0) {
        this.setCached('urii_admin_orders', list);
        return list;
      }
    } catch {
      // Trả về cache nếu API lỗi
    }

    return this.getInitialOrders();
  }

  // --- 7. QUẢN LÝ THƯ VIỆN MAP MẪU ---
  // Tạm giữ endpoint /maps theo code hiện tại sau khi Pull.

  public getLibraryMaps(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/maps`);
  }

  public getLibraryMapImageUrl(imagePath: string): string {
    const normalizedPath = imagePath
      .replace(/^(\.\.\/)+/, '')
      .replace(/^\/+/, '');

    return `${this.baseUrl.replace(/\/api$/, '')}/${normalizedPath}`;
  }

  public saveLibraryMap(mapData: any): Observable<any> {
    return this.http.post(
      `${this.baseUrl}/maps`,
      mapData
    );
  }

  public deleteLibraryMap(id: string): Observable<any> {
    return this.http.delete(
      `${this.baseUrl}/maps/${encodeURIComponent(id)}`
    );
  }

  // --- 8. DASHBOARD STATS ---

  async getDashboard(): Promise<DashboardStats> {
    try {
      const stats = await this.requestWithFallback<DashboardStats>(
        'GET',
        '/api/dashboard'
      );

      if (stats && typeof stats.products === 'number') {
        this.setCached('urii_admin_dashboard', stats);
        return stats;
      }
    } catch {
      // Trả về dữ liệu cache nếu API lỗi
    }

    return this.getInitialDashboard();
  }

  // --- 9. BLOGS ---

  async getBlogs(): Promise<AdminBlog[]> {
    try {
      const data = await this.requestWithFallback<any>(
        'GET',
        '/api/blogs?page=1&limit=100'
      );

      const list = Array.isArray(data)
        ? data
        : (data?.blogs ?? data?.data);

      if (Array.isArray(list)) {
        this.setCached('urii_admin_blogs', list);
        return list;
      }

      console.error('API bài viết trả về dữ liệu không hợp lệ:', data);
    } catch (error) {
      console.error('Lỗi tải bài viết từ API, sử dụng dữ liệu cache:', error);
    }

    return this.getInitialBlogs();
  }

  // --- 10. QUẢN LÝ NGƯỜI DÙNG ---

  async getUsers(): Promise<AdminUser[]> {
    try {
      const data = await this.requestWithFallback<any>(
        'GET',
        '/api/users?page=1&limit=100'
      );

      const list = Array.isArray(data)
        ? data
        : (data?.users || data?.data || []);

      if (list.length > 0) {
        this.setCached('urii_admin_users', list);
        return list;
      }
    } catch {
      // Trả về cache nếu API lỗi
    }

    return this.getInitialUsers();
  }

  async createUser(payload: UserPayload): Promise<AdminUser> {
    return this.requestWithFallback<AdminUser>(
      'POST',
      '/api/users',
      payload
    );
  }

  async updateUser(
    id: string,
    payload: Partial<UserPayload>
  ): Promise<AdminUser> {
    return this.requestWithFallback<AdminUser>(
      'PATCH',
      `/api/users/${encodeURIComponent(id)}`,
      payload
    );
  }

  async deleteUser(id: string): Promise<void> {
    await this.requestWithFallback<void>(
      'DELETE',
      `/api/users/${encodeURIComponent(id)}`
    );
  }

  // --- 11. QUẢN LÝ KHUYẾN MÃI ---

  async getPromotions(): Promise<Promotion[]> {
    try {
      const data = await this.requestWithFallback<any>(
        'GET',
        '/api/vouchers/manage?page=1&limit=100'
      );

      const list = Array.isArray(data)
        ? data
        : (data?.vouchers || data?.promotions || data?.data || []);

      if (list.length > 0) {
        this.setCached('urii_admin_promotions', list);
        return list;
      }
    } catch {
      try {
        const active = await this.requestWithFallback<any>(
          'GET',
          '/api/vouchers?page=1&limit=100'
        );

        const list = Array.isArray(active)
          ? active
          : (active?.vouchers || active?.data || []);

        if (list.length > 0) {
          this.setCached('urii_admin_promotions', list);
          return list;
        }
      } catch {
        // Trả về cache nếu cả hai API lỗi
      }
    }

    return this.getInitialPromotions();
  }

  async createPromotion(
    payload: PromotionPayload
  ): Promise<Promotion> {
    return this.requestWithFallback<Promotion>(
      'POST',
      '/api/vouchers',
      payload
    );
  }

  async updatePromotion(
    id: string,
    payload: Partial<PromotionPayload>
  ): Promise<Promotion> {
    return this.requestWithFallback<Promotion>(
      'PATCH',
      `/api/vouchers/${encodeURIComponent(id)}`,
      payload
    );
  }

  async deletePromotion(id: string): Promise<void> {
    await this.requestWithFallback<void>(
      'DELETE',
      `/api/vouchers/${encodeURIComponent(id)}`
    );
  }

  // --- 12. HTTP HELPER ---

  private async requestWithFallback<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
    const fullUrl =
      path.startsWith('http://') || path.startsWith('https://')
        ? path
        : `${this.backendOrigin}${path.startsWith('/') ? path : '/' + path}`;

    try {
      return await this.sendRequest<T>(method, fullUrl, body);
    } catch (error) {
      throw error;
    }
  }

  private sendRequest<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown
  ): Promise<T> {
    const opts = this.options();
    const TIMEOUT_MS = 2500;

    switch (method) {
      case 'GET':
        return firstValueFrom(
          this.http.get<T>(url, opts).pipe(timeout(TIMEOUT_MS))
        );

      case 'POST':
        return firstValueFrom(
          this.http.post<T>(url, body, opts).pipe(timeout(TIMEOUT_MS))
        );

      case 'PATCH':
        return firstValueFrom(
          this.http.patch<T>(url, body, opts).pipe(timeout(TIMEOUT_MS))
        );

      case 'PUT':
        return firstValueFrom(
          this.http.put<T>(url, body, opts).pipe(timeout(TIMEOUT_MS))
        );

      case 'DELETE':
        return firstValueFrom(
          this.http.delete<T>(url, opts).pipe(timeout(TIMEOUT_MS))
        );
    }
  }

  private options(): { headers: HttpHeaders } {
    let authToken = this.currentAuthToken || this.token() || '';

    if (!authToken && isPlatformBrowser(this.platformId)) {
      authToken =
        localStorage.getItem('urii-admin-token') ||
        localStorage.getItem('token') ||
        localStorage.getItem('adminToken') ||
        '';
    }

    return {
      headers: new HttpHeaders({
        'Content-Type': 'application/json',
        ...(authToken
          ? { Authorization: `Bearer ${authToken}` }
          : {})
      })
    };
  }
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.message;
    return typeof message === 'string' ? message : fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
