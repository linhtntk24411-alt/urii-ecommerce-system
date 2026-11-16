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
  replies?: { content: string; role?: string; author?: string }[];
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
  replies?: { content: string; role?: string; author?: string }[];
}

interface LoginResponse {
  token: string;
  user: { id: string; name: string; email: string; role: string };
}

const FALLBACK_USERS: AdminUser[] = [
  {
    _id: 'u1',
    name: 'Nguyá»…n Minh Anh',
    joinDate: '15/03/2024',
    avatar: 'images/avatar_user.jpeg',
    orders: 6,
    maps: 45,
    phone: '0901 234 567',
    email: 'minhanh.uri@gmail.com',
    birth: '12/08/1998',
    address: '123 ÄÆ°á»ng Nguyá»…n Huá»‡, PhÆ°á»ng Báº¿n NghĂ©, Quáº­n 1, TP. Há»“ ChĂ­ Minh',
    role: 'user',
    status: 'active'
  },
  {
    _id: 'u2',
    name: 'Tráº§n Thá»‹ Báº£o Ngá»c',
    joinDate: '10/05/2024',
    avatar: 'images/avatar_user1.jpeg',
    orders: 6,
    maps: 18,
    phone: '0912 345 678',
    email: 'baongoc.uri@gmail.com',
    birth: '25/03/1999',
    address: '45 LĂª Lá»£i, PhÆ°á»ng Báº¿n ThĂ nh, Quáº­n 1, TP. Há»“ ChĂ­ Minh',
    role: 'user',
    status: 'active'
  },
  {
    _id: 'u3',
    name: 'LĂª HoĂ ng Nam',
    joinDate: '12/04/2024',
    avatar: 'images/avatar_user3.jpeg',
    orders: 6,
    maps: 27,
    phone: '0987 654 321',
    email: 'hoangnam.uri@gmail.com',
    birth: '07/11/1997',
    address: '78 Nguyá»…n TrĂ£i, PhÆ°á»ng 3, Quáº­n 5, TP. Há»“ ChĂ­ Minh',
    role: 'user',
    status: 'pending_verify'
  },
  {
    _id: 'u4',
    name: 'Pháº¡m Thu HĂ ',
    joinDate: '20/03/2024',
    avatar: 'images/avatar_user2.jpeg',
    orders: 6,
    maps: 12,
    phone: '0938 111 222',
    email: 'thuha.uri@gmail.com',
    birth: '18/06/2000',
    address: '12 Phan XĂ­ch Long, PhÆ°á»ng 2, Quáº­n PhĂº Nhuáº­n, TP. Há»“ ChĂ­ Minh',
    role: 'user',
    status: 'active'
  },
  {
    _id: 'u5',
    name: 'Äá»— Quang Huy',
    joinDate: '05/02/2024',
    avatar: 'images/avatar-non.jpg',
    orders: 6,
    maps: 33,
    phone: '0967 888 999',
    email: 'quanghuy.uri@gmail.com',
    birth: '30/09/1996',
    address: '256 CĂ¡ch Máº¡ng ThĂ¡ng 8, PhÆ°á»ng 10, Quáº­n 3, TP. Há»“ ChĂ­ Minh',
    role: 'user',
    status: 'locked'
  },
  {
    _id: 'u6',
    name: 'VÅ© KhĂ¡nh Linh',
    joinDate: '01/05/2024',
    avatar: 'images/avatar-non.jpg',
    orders: 6,
    maps: 9,
    phone: '0909 333 444',
    email: 'khanhlinh.uri@gmail.com',
    birth: '14/02/2001',
    address: '88 HoĂ ng Diá»‡u, PhÆ°á»ng 6, Quáº­n 4, TP. Há»“ ChĂ­ Minh',
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
    address: 'Sá»‘ 1, ÄÆ°á»ng Nguyá»…n Du, PhÆ°á»ng Báº¿n ThĂ nh, Quáº­n 1, TP. Há»“ ChĂ­ Minh',
    role: 'admin',
    status: 'active'
  }
];

const FALLBACK_PROMOTIONS: Promotion[] = [
  {
    _id: 'v1',
    id: 'FREESHIP',
    code: 'FREESHIP',
    name: 'Miá»…n phĂ­ váº­n chuyá»ƒn',
    description: 'Giáº£m tá»‘i Ä‘a 30.000Ä‘ phĂ­ váº­n chuyá»ƒn cho Ä‘Æ¡n tá»« 100.000Ä‘',
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
    name: 'ChĂ o má»«ng thĂ nh viĂªn má»›i',
    description: 'Giáº£m 10% cho Ä‘Æ¡n Ä‘áº§u tiĂªn, tá»‘i Ä‘a 20.000Ä‘ (Ä‘Æ¡n tá»« 50.000Ä‘)',
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
    name: 'Giáº£m ngay 10.000Ä‘',
    description: 'Giáº£m 10.000Ä‘ cho Ä‘Æ¡n tá»« 50.000Ä‘',
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
    name: 'Sale 15% toĂ n bá»™',
    description: 'Giáº£m 15% tá»‘i Ä‘a 30.000Ä‘ cho Ä‘Æ¡n tá»« 70.000Ä‘',
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
    name: 'NgĂ y vui giáº£m 30k',
    description: 'Giáº£m 30.000Ä‘ cho Ä‘Æ¡n tá»« 200.000Ä‘',
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
    userName: 'Nguyá»…n Minh Anh',
    date: '20/05/2024',
    status: 'Chá» xĂ¡c nháº­n',
    statusType: 'pending',
    total: '15.000Ä‘',
    items: [
      {
        productId: '1075483767',
        name: 'BĂºt Äáº·t Háº¡t Tá»± Äá»™ng 2.6mm',
        price: 15000,
        quantity: 1,
        image: 'https://cdn.hstatic.net/products/200001193910/sg-11134201-81zut-mmzv8ahrn6kg08_310c94be477d4ca4a635bb252881a2f8.webp'
      }
    ],
    payment: { method: 'Thanh toĂ¡n khi nháº­n hĂ ng (COD)', status: 'ChÆ°a thanh toĂ¡n' },
    address: { name: 'Nguyá»…n Minh Anh', phone: '0901 234 567', address: '123 ÄÆ°á»ng Nguyá»…n Huá»‡, Q.1, TP.HCM' }
  },
  {
    id: 'UR-82906',
    userName: 'VÅ© KhĂ¡nh Linh',
    date: '25/05/2024',
    status: 'Chá» xĂ¡c nháº­n',
    statusType: 'pending',
    total: '58.000Ä‘',
    items: [
      {
        productId: '1075486180',
        name: 'Bá»™ Háº¡t Xáº¿p HĂ¬nh - Combo Handmade DIY Nháºµn Má»‹n',
        price: 68000,
        quantity: 1,
        image: 'https://cdn.hstatic.net/products/200001193910/screenshot_2026-07-09_030756_fc41e98c92554127b69b389763080b5f.png'
      }
    ],
    payment: { method: 'Chuyá»ƒn khoáº£n ngĂ¢n hĂ ng', status: 'ÄĂ£ thanh toĂ¡n' },
    address: { name: 'VÅ© KhĂ¡nh Linh', phone: '0909 333 444', address: '88 HoĂ ng Diá»‡u, Q.4, TP.HCM' }
  },
  {
    id: 'UR-83011',
    userName: 'Nguyá»…n Minh Anh',
    date: '01/06/2024',
    status: 'Chá» láº¥y hĂ ng',
    statusType: 'processing',
    total: '68.000Ä‘',
    items: [
      {
        productId: '1075486180',
        name: 'Bá»™ Háº¡t Xáº¿p HĂ¬nh - Combo Handmade DIY Nháºµn Má»‹n',
        price: 68000,
        quantity: 1,
        image: 'https://cdn.hstatic.net/products/200001193910/screenshot_2026-07-09_030756_fc41e98c92554127b69b389763080b5f.png'
      }
    ],
    payment: { method: 'Chuyá»ƒn khoáº£n ngĂ¢n hĂ ng', status: 'ÄĂ£ thanh toĂ¡n' },
    address: { name: 'Nguyá»…n Minh Anh', phone: '0901 234 567', address: '123 ÄÆ°á»ng Nguyá»…n Huá»‡, Q.1, TP.HCM' }
  },
  {
    id: 'UR-83022',
    userName: 'Tráº§n Thá»‹ Báº£o Ngá»c',
    date: '03/07/2024',
    status: 'ÄĂ£ giao',
    statusType: 'completed',
    total: '61.200Ä‘',
    items: [
      {
        productId: '1075486180',
        name: 'Bá»™ Háº¡t Xáº¿p HĂ¬nh - Combo Handmade DIY Nháºµn Má»‹n',
        price: 68000,
        quantity: 1,
        image: 'https://cdn.hstatic.net/products/200001193910/screenshot_2026-07-09_030756_fc41e98c92554127b69b389763080b5f.png'
      }
    ],
    payment: { method: 'Chuyá»ƒn khoáº£n ngĂ¢n hĂ ng', status: 'ÄĂ£ thanh toĂ¡n' },
    address: { name: 'Tráº§n Thá»‹ Báº£o Ngá»c', phone: '0912 345 678', address: '45 LĂª Lá»£i, Q.1, TP.HCM' }
  },
  {
    id: 'UR-83026',
    userName: 'VÅ© KhĂ¡nh Linh',
    date: '11/07/2024',
    status: 'ÄĂ£ giao',
    statusType: 'completed',
    total: '68.000Ä‘',
    items: [
      {
        productId: '1075486180',
        name: 'Bá»™ Háº¡t Xáº¿p HĂ¬nh - Combo Handmade DIY Nháºµn Má»‹n',
        price: 68000,
        quantity: 1,
        image: 'https://cdn.hstatic.net/products/200001193910/screenshot_2026-07-09_030756_fc41e98c92554127b69b389763080b5f.png'
      }
    ],
    payment: { method: 'Thanh toĂ¡n khi nháº­n hĂ ng (COD)', status: 'ÄĂ£ thanh toĂ¡n' },
    address: { name: 'VÅ© KhĂ¡nh Linh', phone: '0909 333 444', address: '88 HoĂ ng Diá»‡u, Q.4, TP.HCM' }
  }
];

const FALLBACK_PRODUCTS: AdminProduct[] = [
  {
    id: '1075483768',
    name: 'DIY KIT Rainbow 48 MĂ u',
    slug: 'products-kit',
    category: 'KIT',
    image: 'https://cdn.hstatic.net/products/200001193910/set_h_t_nh_a_urii_rainbow_48_m_u_4ce5db5cf38d45a68edca10c15bf227e.png',
    currentPrice: 69000,
    stock: 12
  },
  {
    id: '1075486161',
    name: 'MĂ´ HĂ¬nh Háº¡t Nhá»±a á»¦i ThĂ nh Pháº©m Sakabooon',
    slug: 'mo-hinh-hat-nhua-ui-thuc-pham-sakabooon',
    category: 'TP',
    image: 'https://cdn.hstatic.net/products/200001193910/12_ea1aea881164402a91baa18fb750921b.jpg',
    currentPrice: 12000,
    stock: 40
  },
  {
    id: '1075483767',
    name: 'BĂºt Äáº·t Háº¡t Tá»± Äá»™ng 2.6mm (Pro)',
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
    title: 'Chiá»u cuá»‘i tuáº§n trá»‘n tháº¿ giá»›i bĂªn gĂ³c bĂ n nhá»',
    slug: 'chieu-cuoi-tuan-tron-the-gioi-ben-goc-ban-nho',
    image: 'images/index/stcd1.png',
    author: 'Minh Anh',
    avatar: 'images/avatar_user.jpeg',
    date: '24 ThĂ¡ng 5, 2024',
    category: 'HÆ°á»›ng dáº«n DIY',
    views: 1024,
    likes: 128
  },
  {
    id: 2,
    title: 'Em cĂ¡o cam siĂªu chá»¯a lĂ nh cho ngĂ y má»‡t má»i',
    slug: 'em-cao-cam-sieu-chua-lanh-cho-ngay-met-moi',
    image: 'images/index/stcd2.png',
    author: 'Minh Anh',
    avatar: 'images/avatar_user.jpeg',
    date: '22 ThĂ¡ng 5, 2024',
    category: 'Ă tÆ°á»Ÿng thiáº¿t káº¿',
    views: 512,
    likes: 86
  },
  {
    id: 3,
    title: 'Khi báº¡n khĂ³c nhÆ°ng trĂ´ng váº«n... buá»“n cÆ°á»i',
    slug: 'khi-ban-khoc-nhung-trong-van-buon-cuoi',
    image: 'images/index/stcd3.png',
    author: 'Äá»— Quang Huy',
    avatar: 'images/avatar-non.jpg',
    date: '20 ThĂ¡ng 5, 2024',
    category: 'GĂ³c nghá»‡ thuáº­t',
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

  // Token Ä‘Æ°á»£c truyá»n trá»±c tiáº¿p tá»« trang Ä‘Äƒng nháº­p
  private currentAuthToken = '';

  private productsSubject = new BehaviorSubject<any[]>([]);
  public products$ = this.productsSubject.asObservable();

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    // Hiá»ƒn thá»‹ dá»¯ liá»‡u cache trÆ°á»›c Ä‘á»ƒ giao diá»‡n khĂ´ng bá»‹ trá»‘ng
    this.productsSubject.next(this.readCachedProducts());

    // KhĂ´i phá»¥c phiĂªn Ä‘Äƒng nháº­p; dá»¯ liá»‡u chá»‰ Ä‘Æ°á»£c táº£i khi trang cáº§n.
    this.restoreSession();
  }

  // --- 1. QUáº¢N LĂ TOKEN VĂ€ ÄÄ‚NG NHáº¬P ---

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
      throw new Error('TĂ i khoáº£n nĂ y khĂ´ng cĂ³ quyá»n quáº£n trá»‹.');
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

  // --- 2. Há»– TRá»¢ ÄÆ¯á»œNG DáºªN HĂŒNH áº¢NH ---

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

  // --- 3. QUáº¢N LĂ Sáº¢N PHáº¨M ---

  public loadProducts(): void {
    // KhĂ´ng truy cáº­p localStorage khi cháº¡y SSR
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
          console.error('API sáº£n pháº©m tráº£ vá» dá»¯ liá»‡u khĂ´ng há»£p lá»‡:', res);
          return;
        }

        this.productsSubject.next(productList);

        try {
          localStorage.setItem(
            'urii_admin_products',
            JSON.stringify(productList)
          );
        } catch (error) {
          console.error('KhĂ´ng thá»ƒ lÆ°u cache sáº£n pháº©m:', error);
        }
      },
      error: (err) => {
        console.error('Lá»—i táº£i sáº£n pháº©m:', err);
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

      console.error('Cache sáº£n pháº©m khĂ´ng Ä‘Ăºng Ä‘á»‹nh dáº¡ng.');
    } catch (error) {
      console.error('KhĂ´ng thá»ƒ Ä‘á»c cache sáº£n pháº©m:', error);
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
        // DĂ¹ng dá»¯ liá»‡u fallback náº¿u cache lá»—i
      }
    }

    return fallback;
  }

  setCached<T>(key: string, data: T): void {
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch {
        // KhĂ´ng lĂ m giĂ¡n Ä‘oáº¡n chá»©c nÄƒng chĂ­nh náº¿u khĂ´ng lÆ°u Ä‘Æ°á»£c cache
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
      .get<AdminComment[]>(`${this.baseUrl}/comments?page=1&limit=100`, {
        headers: this.getAuthHeaders()
      })
      .pipe(timeout(15000));
  }

  replyToComment(id: string | number, content: string): Observable<any> {
    return this.http.post(
      `${this.baseUrl}/comments/${encodeURIComponent(String(id))}/replies`,
      { content },
      { headers: this.getAuthHeaders() }
    );
  }

  replyToReview(id: string, content: string): Observable<any> {
    return this.http.post(
      `${this.baseUrl}/reviews/${encodeURIComponent(id)}/replies`,
      { content },
      { headers: this.getAuthHeaders() }
    );
  }

  deleteComment(id: string | number): Observable<any> {
    return this.http.delete(
      `${this.baseUrl}/comments/${encodeURIComponent(String(id))}`,
      { headers: this.getAuthHeaders() }
    );
  }

  updateCommentStatus(id: string | number, status: string): Observable<any> {
    return this.http.patch(
      `${this.baseUrl}/comments/${encodeURIComponent(String(id))}`,
      { status },
      { headers: this.getAuthHeaders() }
    );
  }

  deleteReview(id: string): Observable<any> {
    return this.http.delete(
      `${this.baseUrl}/reviews/${encodeURIComponent(id)}`,
      { headers: this.getAuthHeaders() }
    );
  }

  getAdminReviews(): Observable<AdminReview[]> {
    return this.http
      .get<AdminReview[]>(`${this.baseUrl}/reviews?page=1&limit=100`, {
        headers: this.getAuthHeaders()
      })
      .pipe(timeout(15000));
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

  // --- 5. API Sáº¢N PHáº¨M Dáº NG PROMISE ---

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
      console.error('Lá»—i táº£i sáº£n pháº©m tá»« API, sá»­ dá»¥ng dá»¯ liá»‡u cache:', error);
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

  // --- 6. QUáº¢N LĂ ÄÆ N HĂ€NG ---

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

  public updateCustomOrder(id: string, payload: any): Observable<any> {
    return this.http.patch<any>(
      `${this.baseUrl}/custom-orders/${encodeURIComponent(id)}`,
      payload,
      { headers: this.getAuthHeaders() }
    );
  }

  public getAdminNotifications(): Observable<any> {
    return this.http.get<any>(
      `${this.baseUrl}/notifications?page=1&limit=100`,
      { headers: this.getAuthHeaders() }
    );
  }

  public markAllNotificationsAsRead(): Observable<any> {
    return this.http.patch(
      `${this.baseUrl}/notifications/read-all`,
      {},
      { headers: this.getAuthHeaders() }
    );
  }

  public markNotificationAsRead(id: string): Observable<any> {
    return this.http.patch(
      `${this.baseUrl}/notifications/${encodeURIComponent(id)}/read`,
      {},
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
        const normalizedList = list.map((item: any) => {
          const amt = Number(item.totalAmount ?? item.total ?? item.pricing?.finalTotal ?? 0);
          const totalStr = typeof item.total === 'string' && item.total.includes('Ä‘')
            ? item.total
            : (amt > 0 ? `${amt.toLocaleString('vi-VN')}Ä‘` : '0Ä‘');
          return { ...item, total: totalStr, totalAmount: amt };
        });
        this.setCached('urii_admin_orders', normalizedList);
        return normalizedList;
      }
    } catch {
      // Tráº£ vá» cache náº¿u API lá»—i
    }

    return this.getInitialOrders();
  }

  // --- 7. QUáº¢N LĂ THÆ¯ VIá»†N MAP MáºªU ---
  // Táº¡m giá»¯ endpoint /maps theo code hiá»‡n táº¡i sau khi Pull.

  public getLibraryMaps(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/maps`, {
      headers: this.getAuthHeaders()
    });
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
      mapData,
      { headers: this.getAuthHeaders() }
    );
  }

  public deleteLibraryMap(id: string): Observable<any> {
    return this.http.delete(
      `${this.baseUrl}/maps/${encodeURIComponent(id)}`,
      { headers: this.getAuthHeaders() }
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
      // Tráº£ vá» dá»¯ liá»‡u cache náº¿u API lá»—i
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

      console.error('API bĂ i viáº¿t tráº£ vá» dá»¯ liá»‡u khĂ´ng há»£p lá»‡:', data);
    } catch (error) {
      console.error('Lá»—i táº£i bĂ i viáº¿t tá»« API, sá»­ dá»¥ng dá»¯ liá»‡u cache:', error);
    }

    return this.getInitialBlogs();
  }

  async createBlog(payload: any): Promise<AdminBlog> {
    return this.requestWithFallback<AdminBlog>('POST', '/api/blogs', payload);
  }

  async updateBlog(id: string | number, payload: any): Promise<AdminBlog> {
    return this.requestWithFallback<AdminBlog>('PATCH', `/api/blogs/${encodeURIComponent(String(id))}`, payload);
  }

  async deleteBlog(id: string | number): Promise<void> {
    await this.requestWithFallback<void>('DELETE', `/api/blogs/${encodeURIComponent(String(id))}`);
  }

  // --- 10. QUáº¢N LĂ NGÆ¯á»œI DĂ™NG ---

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
      // Tráº£ vá» cache náº¿u API lá»—i
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

  // --- 11. QUáº¢N LĂ KHUYáº¾N MĂƒI ---

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
        // Tráº£ vá» cache náº¿u cáº£ hai API lá»—i
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
    const TIMEOUT_MS = 15000;

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
