import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common'; // Kích hoạt pipe number, @for, @if
import { RouterModule } from '@angular/router'; // Kích hoạt routerLink

@Component({
  selector: 'app-homepage',
  templateUrl: './homepage.html',
  styleUrls: ['./homepage.css'], // Thêm chữ s và ngoặc vuông ở đây
  standalone: true, 
  imports: [CommonModule, RouterModule] 
})
export class HomepageComponent implements OnInit {
  // Dữ liệu từ file JS cũ
  valuesData = [
    { icon: 'bi-shield-check', title: 'Chất liệu an toàn', desc: 'Hạt nhựa nguyên sinh không độc hại, an toàn cho mọi lứa tuổi' },
    { icon: 'bi-truck', title: 'Giao hàng nhanh chóng', desc: 'Ship COD toàn quốc, kiểm hàng trước khi nhận' },
    { icon: 'bi-headset', title: 'Hỗ trợ 24/7', desc: 'Tặng map mẫu và hướng dẫn ủi nhiệt miễn phí' }
  ];

  categoriesData = [
    { name: 'Bộ KIT DIY', image: 'assets/index/kit.jpg', category: 'kit' },
    { name: 'Dụng Cụ', image: 'assets/index/dungcu.png', category: 'tool' },
    { name: 'Hạt Lẻ Các Loại', image: 'assets/index/hatrefill.png', category: 'bead' },
    { name: 'Phụ Kiện Handmade', image: 'assets/index/handmade.jpg', category: 'accessory' }
  ];

  stepsData = [
    { number: '01', image: 'assets/index/step1.png', title: 'Xếp hạt lên bảng đinh', desc: 'Chọn màu sắc và xếp hạt nhựa lên bảng đinh theo map mẫu' },
    { number: '02', image: 'assets/index/step2.png', title: 'Phủ giấy nến & Ủi nhiệt', desc: 'Đặt giấy nến lên trên và ủi ở nhiệt độ phù hợp' },
    { number: '03', image: 'assets/index/step3.png', title: 'Hoàn thành tác phẩm', desc: 'Tháo sản phẩm hoàn thiện ra khỏi bảng đinh' }
  ];

  galleryData = [
    'assets/index/stcd1.png', 'assets/index/stcd2.png', 'assets/index/stcd3.png',
    'assets/index/stcd4.png', 'assets/index/stcd5.png', 'assets/index/stcd6.png'
  ];

  bestSellers = [
    { id: 1, name: 'Set Cơ Bản 24 Màu', image: 'assets/index/banchay.png', isSale: true, badge: '-20%', originalPrice: 86000, currentPrice: 69000, stock: 15, stockPercent: 30 },
    { id: 2, name: 'Móc Khóa Worldcup', image: 'assets/index/worldcup.jpg', isSale: true, badge: '-15%', originalPrice: 41000, currentPrice: 35000, stock: 8, stockPercent: 16 }
  ];

  ngOnInit(): void {
  }
}