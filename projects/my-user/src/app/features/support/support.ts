import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';

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

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      const tabFromUrl = params['tab'];
      const validTabs = ['support-center', 'faq', 'privacy-policy', 'terms-of-service'];
      
      if (tabFromUrl && validTabs.includes(tabFromUrl)) {
        this.activeTab = tabFromUrl;
      } else {
        this.activeTab = 'support-center';
      }
      this.activeFaqIndex = null;
    });
  }

  toggleFaq(index: number): void {
    this.activeFaqIndex = this.activeFaqIndex === index ? null : index;
  }
}