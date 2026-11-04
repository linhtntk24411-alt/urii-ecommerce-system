import { HttpClient, HttpHeaders } from '@angular/common/http';
import { afterNextRender, ChangeDetectorRef, Component, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { CartService } from '../../core/services/cart.service';
import { Subscription, TimeoutError, timeout } from 'rxjs';

interface CurrentUserProfile {
  id?: string;
  _id?: string;
  name: string;
  email: string;
  avatar?: string;
}

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './header.component.html',
  styleUrl: './header.component.css'
})
export class HeaderComponent implements OnInit, OnDestroy {
  isLoggedIn: boolean = false;
  authStatusReady = false;
  userName: string = '';
  userEmail: string = '';
  userAvatar: string = '';
  cartCount: number = 0;
  notificationCount: number = 0; 
  
  isMobileMenuOpen: boolean = false;
  isMobileProductOpen: boolean = true;
  isLogoutModalOpen: boolean = false;
  
  private storageListener: any;
  private authChangeListener: (() => void) | null = null;
  private cartChangeListener: (() => void) | null = null;
  private profileRequest?: Subscription;

  constructor(
    private readonly http: HttpClient,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object,
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly cart: CartService
  ) {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;

      this.checkAuthStatus();
      this.updateCartBadge();
      this.loadCurrentUser();
      this.changeDetectorRef.markForCheck();
    });
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.storageListener = (e: StorageEvent) => {
        if (e.key === 'isLoggedIn' || e.key === 'userName' || e.key === 'userEmail' || e.key === 'userAvatar' || e.key === 'userRole' || e.key === 'authToken' || e.key === 'cart_count') {
          this.checkAuthStatus();
          this.updateCartBadge();
          this.loadCurrentUser();
          this.changeDetectorRef.markForCheck();
        }
      };
      this.authChangeListener = () => {
        this.checkAuthStatus();
        this.loadCurrentUser();
        this.changeDetectorRef.markForCheck();
      };
      this.cartChangeListener = () => {
        this.updateCartBadge();
        this.changeDetectorRef.markForCheck();
      };
      window.addEventListener('storage', this.storageListener);
      window.addEventListener('auth:changed', this.authChangeListener);
      window.addEventListener('cart:updated', this.cartChangeListener);
    }
  }

  ngOnDestroy(): void {
    this.profileRequest?.unsubscribe();
    if (isPlatformBrowser(this.platformId)) {
      if (this.storageListener) {
        window.removeEventListener('storage', this.storageListener);
      }
      if (this.authChangeListener) {
        window.removeEventListener('auth:changed', this.authChangeListener);
      }
      if (this.cartChangeListener) {
        window.removeEventListener('cart:updated', this.cartChangeListener);
      }
    }
  }

  private loadCurrentUser(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.profileRequest?.unsubscribe();
    const token = localStorage.getItem('authToken');
    if (localStorage.getItem('isLoggedIn') !== 'true' || !token) return;

    this.profileRequest = this.http.get<CurrentUserProfile>('/api/auth/me', {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
    }).pipe(
      timeout({ first: 8000 }),
    ).subscribe({
      next: (profile) => {
        if (!profile || typeof profile.email !== 'string' || typeof profile.name !== 'string') {
          console.error('API hồ sơ cá nhân trả về dữ liệu không hợp lệ.');
          return;
        }

        this.userName = profile.name;
        this.userEmail = profile.email;
        this.userAvatar = this.normalizeAvatar(profile.avatar ?? '');
        localStorage.setItem('userName', this.userName);
        localStorage.setItem('userEmail', this.userEmail);
        localStorage.setItem('userAvatar', this.userAvatar);
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        if (error instanceof TimeoutError) {
          console.error('Tải hồ sơ cá nhân quá thời gian chờ.');
        } else {
          console.error('Không thể tải hồ sơ cá nhân từ API:', error);
        }
      },
    });
  }

  private normalizeAvatar(avatar: string): string {
    if (avatar.startsWith('/images/')) return `/api${avatar}`;
    if (avatar.startsWith('images/')) return `/api/${avatar}`;
    return avatar;
  }

  checkAuthStatus(): void {
    const logged = localStorage.getItem('isLoggedIn') === 'true';
    this.isLoggedIn = logged;
    this.authStatusReady = true;
    if (logged) {
      this.userName = localStorage.getItem('userName') || 'Khách hàng';
      this.userEmail = localStorage.getItem('userEmail') || '';
      this.userAvatar = localStorage.getItem('userAvatar') || '';
    } else {
      this.userName = '';
      this.userEmail = '';
      this.userAvatar = '';
    }
  }

  updateCartBadge(): void {
    try {
      this.cartCount = this.cart.getItemCount();
    } catch (error) {
      console.error('Không thể tải số lượng giỏ hàng:', error);
      this.cartCount = 0;
    }
  }

  toggleMobileMenu(): void {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
  }

  closeMobileMenu(): void {
    this.isMobileMenuOpen = false;
  }

  toggleMobileProduct(): void {
    this.isMobileProductOpen = !this.isMobileProductOpen;
  }

  openLogoutModal(): void {
    this.isLogoutModalOpen = true;
  }

  closeLogoutModal(): void {
    this.isLogoutModalOpen = false;
  }

  confirmLogout(): void {
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('userName');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userAvatar');
    localStorage.removeItem('userRole');
    localStorage.removeItem('authToken');
    this.profileRequest?.unsubscribe();
    this.isLoggedIn = false;
    this.userName = '';
    this.userEmail = '';
    this.userAvatar = '';
    this.isLogoutModalOpen = false;
    window.dispatchEvent(new Event('auth:changed'));
    this.router.navigate(['/login']);
  }
}