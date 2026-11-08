import { Component, OnDestroy, OnInit } from '@angular/core';
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
  activeTab = 'support-center';
  activeFaqIndex: number | null = null;
  private queryParamsSubscription?: Subscription;
  readonly faqs: FaqItem[] = [
    {
      question: 'Tôi có thể đặt hàng như thế nào?',
      answer: 'Bạn có thể đặt hàng trực tiếp trên website bằng cách chọn sản phẩm, thêm vào giỏ hàng và tiến hành thanh toán. Nếu cần hỗ trợ, hãy gọi hotline 1900 1234.',
    },
    {
      question: 'Thời gian giao hàng là bao lâu?',
      answer: 'Thời gian giao hàng nội thành TP.HCM là 1-2 ngày, các tỉnh thành khác từ 3-5 ngày làm việc.',
    },
    {
      question: 'Phí vận chuyển được tính như thế nào?',
      answer: 'Phí vận chuyển được tính dựa trên trọng lượng đơn hàng và địa chỉ giao hàng. Miễn phí ship cho đơn hàng từ 500.000đ.',
    },
    {
      question: 'Tôi có thể hủy đơn hàng không?',
      answer: 'Bạn có thể hủy đơn hàng trong vòng 2 giờ sau khi đặt nếu đơn hàng chưa được xử lý.',
    },
    {
      question: 'Sản phẩm có được bảo hành không?',
      answer: 'Chúng tôi bảo hành 1 đổi 1 trong vòng 3 ngày nếu sản phẩm bị lỗi từ nhà sản xuất.',
    },
  ];

  constructor(private router: Router) {}

  ngOnInit(): void {
    this.updateActiveTab(this.router.url);
    this.queryParamsSubscription = this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    ).subscribe((event) => this.updateActiveTab(event.urlAfterRedirects));
  }

  ngOnDestroy(): void {
    this.queryParamsSubscription?.unsubscribe();
  }

  toggleFaq(index: number): void {
    this.activeFaqIndex = this.activeFaqIndex === index ? null : index;
  }

  private isSupportTab(tab: string | null): tab is 'support-center' | 'faq' | 'privacy-policy' | 'terms-of-service' | 'community-standards' {
    return tab === 'support-center'
      || tab === 'faq'
      || tab === 'privacy-policy'
      || tab === 'terms-of-service'
      || tab === 'community-standards';
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