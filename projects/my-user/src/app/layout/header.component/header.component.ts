import { afterNextRender, ChangeDetectorRef, Component, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { CartService } from '../../core/services/cart.service';

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

  constructor(
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object,
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly cart: CartService
  ) {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;

      this.checkAuthStatus();
      this.updateCartBadge();
      this.changeDetectorRef.markForCheck();
    });
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.storageListener = (e: StorageEvent) => {
        if (e.key === 'isLoggedIn' || e.key === 'userName' || e.key === 'userEmail' || e.key === 'userAvatar' || e.key === 'userRole' || e.key === 'cart_count') {
          this.checkAuthStatus();
          this.updateCartBadge();
          this.changeDetectorRef.markForCheck();
        }
      };
      this.authChangeListener = () => {
        this.checkAuthStatus();
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
    this.isLoggedIn = false;
    this.userName = '';
    this.userEmail = '';
    this.userAvatar = '';
    this.isLogoutModalOpen = false;
    window.dispatchEvent(new Event('auth:changed'));
    this.router.navigate(['/login']);
  }
}