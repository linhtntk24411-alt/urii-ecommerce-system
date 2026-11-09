import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, Subscription } from 'rxjs';

interface FaqItem {
  question: string;
  answer: string;
}

@Component({
  selector: 'app-support',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './support.html',
  styleUrls: ['./support.css']
})
export class SupportComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  activeTab = 'support-center';
  activeFaqIndex: number | null = null;
  private queryParamsSubscription?: Subscription;
  faqs: FaqItem[] = [
    {
      question: 'TĂ´i cĂ³ thá»ƒ Ä‘áº·t hĂ ng nhÆ° tháº¿ nĂ o?',
      answer: 'Báº¡n cĂ³ thá»ƒ Ä‘áº·t hĂ ng trá»±c tiáº¿p trĂªn website báº±ng cĂ¡ch chá»n sáº£n pháº©m, thĂªm vĂ o giá» hĂ ng vĂ  tiáº¿n hĂ nh thanh toĂ¡n. Náº¿u cáº§n há»— trá»£, hĂ£y gá»i hotline 1900 1234.',
    },
    {
      question: 'Thá»i gian giao hĂ ng lĂ  bao lĂ¢u?',
      answer: 'Thá»i gian giao hĂ ng ná»™i thĂ nh TP.HCM lĂ  1-2 ngĂ y, cĂ¡c tá»‰nh thĂ nh khĂ¡c tá»« 3-5 ngĂ y lĂ m viá»‡c.',
    },
    {
      question: 'PhĂ­ váº­n chuyá»ƒn Ä‘Æ°á»£c tĂ­nh nhÆ° tháº¿ nĂ o?',
      answer: 'PhĂ­ váº­n chuyá»ƒn Ä‘Æ°á»£c tĂ­nh dá»±a trĂªn trá»ng lÆ°á»£ng Ä‘Æ¡n hĂ ng vĂ  Ä‘á»‹a chá»‰ giao hĂ ng. Miá»…n phĂ­ ship cho Ä‘Æ¡n hĂ ng tá»« 500.000Ä‘.',
    },
    {
      question: 'TĂ´i cĂ³ thá»ƒ há»§y Ä‘Æ¡n hĂ ng khĂ´ng?',
      answer: 'Báº¡n cĂ³ thá»ƒ há»§y Ä‘Æ¡n hĂ ng trong vĂ²ng 2 giá» sau khi Ä‘áº·t náº¿u Ä‘Æ¡n hĂ ng chÆ°a Ä‘Æ°á»£c xá»­ lĂ½.',
    },
    {
      question: 'Sáº£n pháº©m cĂ³ Ä‘Æ°á»£c báº£o hĂ nh khĂ´ng?',
      answer: 'ChĂºng tĂ´i báº£o hĂ nh 1 Ä‘á»•i 1 trong vĂ²ng 3 ngĂ y náº¿u sáº£n pháº©m bá»‹ lá»—i tá»« nhĂ  sáº£n xuáº¥t.',
    },
  ];

  constructor(private router: Router) {}

  ngOnInit(): void {
    this.updateActiveTab(this.router.url);
    this.queryParamsSubscription = this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    ).subscribe((event) => this.updateActiveTab(event.urlAfterRedirects));

    this.http.get<any[]>('/api/chat/faqs?limit=50').subscribe({
      next: (data) => {
        const list = Array.isArray(data) ? data : (data as any)?.faqs || [];
        if (list.length > 0) {
          this.faqs = list.map((item: any) => ({
            question: String(item?.question || ''),
            answer: String(item?.answer || '')
          })).filter((f: any) => f.question && f.answer);
        }
      },
      error: (err) => console.warn('Lỗi tải FAQs từ API, dùng dữ liệu mặc định:', err)
    });
  }

  ngOnDestroy(): void {
    this.queryParamsSubscription?.unsubscribe();
  }

  toggleFaq(index: number): void {
    this.activeFaqIndex = this.activeFaqIndex === index ? null : index;
  }

  private isSupportTab(tab: string | null): tab is 'support-center' | 'faq' | 'privacy-policy' | 'terms-of-service' | 'community-standards' | 'return-policy' {
    return tab === 'support-center'
      || tab === 'faq'
      || tab === 'privacy-policy'
      || tab === 'terms-of-service'
      || tab === 'community-standards'
      || tab === 'return-policy';
  }

  private updateActiveTab(url: string): void {
    const urlTree = this.router.parseUrl(url);
    const segments = urlTree.root.children['primary']?.segments ?? [];
    const pathTab = segments[0]?.path === 'support' ? segments[1]?.path : null;
    const queryTab = urlTree.queryParams['tab'];
    const tab = this.isSupportTab(pathTab)
      ? pathTab
      : this.isSupportTab(queryTab)
        ? queryTab
        : null;
    this.activeTab = tab ?? 'support-center';
    this.activeFaqIndex = null;
  }
}