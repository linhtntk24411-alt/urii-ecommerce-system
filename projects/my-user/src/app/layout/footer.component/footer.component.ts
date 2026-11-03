import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.css'
})
export class FooterComponent implements OnInit {
  isAdmin: boolean = false;
  activeCol: string | null = null;

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
  ) {}

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      const role = localStorage.getItem('userRole');
      if (role === 'admin') {
        this.isAdmin = true;
      }
    }
  }

  toggleAccordion(col: string) {
    if (this.activeCol === col) {
      this.activeCol = null;
    } else {
      this.activeCol = col; 
    }
  }
}