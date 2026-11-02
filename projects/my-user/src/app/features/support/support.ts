import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-support',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './support.html',
  styleUrls: ['./support.css']
})
export class SupportComponent implements OnInit {
  activeTab: string = 'support-center';
  activeFaqIndex: number | null = null;

  constructor() {}

  ngOnInit(): void {
    const urlParams = new URLSearchParams(window.location.search);
    const tabFromUrl = urlParams.get('tab');
    if (tabFromUrl && ['support-center', 'faq', 'privacy-policy', 'terms-of-service'].includes(tabFromUrl)) {
      this.activeTab = tabFromUrl;
    }
  }

  selectTab(tabKey: string): void {
    this.activeTab = tabKey;
    this.activeFaqIndex = null;
  }

  toggleFaq(index: number): void {
    this.activeFaqIndex = this.activeFaqIndex === index ? null : index;
  }
}