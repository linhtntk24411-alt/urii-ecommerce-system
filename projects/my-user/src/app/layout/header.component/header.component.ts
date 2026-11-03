import { Component, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
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
  userName: string = '';
  userEmail: string = '';
  userAvatar: string = '';
  cartCount: number = 0;
  notificationCount: number = 0; 
  
  isMobileMenuOpen: boolean = false;
  isMobileProductOpen: boolean = true;
  isLogoutModalOpen: boolean = false;
  
  private storageListener: any;

  constructor(
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.checkAuthStatus();
      this.updateCartBadge();

      this.storageListener = (e: StorageEvent) => {
        if (e.key === 'isLoggedIn' || e.key === 'userName' || e.key === 'userEmail' || e.key === 'userAvatar' || e.key === 'cart_count') {
          this.checkAuthStatus();
          this.updateCartBadge();
        }
      };
      window.addEventListener('storage', this.storageListener);
    }
  }

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.platformId) && this.storageListener) {
      window.removeEventListener('storage', this.storageListener);
    }
  }

  checkAuthStatus(): void {
    const logged = localStorage.getItem('isLoggedIn') === 'true';
    this.isLoggedIn = logged;
    if (logged) {
      this.userName = localStorage.getItem('userName') || 'Khách hàng';
      this.userEmail = localStorage.getItem('userEmail') || '';
      this.userAvatar = localStorage.getItem('userAvatar') || '';
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
    this.isLoggedIn = false;
    this.isLogoutModalOpen = false;
    this.router.navigate(['/login']);
  }
}