import { afterNextRender, ChangeDetectorRef, Component, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

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

  constructor(
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object,
    private readonly changeDetectorRef: ChangeDetectorRef
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
      window.addEventListener('storage', this.storageListener);
      window.addEventListener('auth:changed', this.authChangeListener);
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
    const cart = JSON.parse(localStorage.getItem('cart') || '[]');
    this.cartCount = cart.reduce((sum: number, item: any) => sum + (item.quantity || 1), 0);
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