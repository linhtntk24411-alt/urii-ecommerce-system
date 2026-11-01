import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';

@Component({
  selector: 'app-sample-maps-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './sample-maps-detail.html',
  styleUrls: ['./sample-maps-detail.css']
})
export class SampleMapsDetailComponent implements OnInit {
  mapId: string = '';
  
  // Dữ liệu giả lập
  mapDetail = {
    id: '1',
    name: 'Map mẫu: Cá heo xanh tinh nghịch',
    image: 'assets/gallery_assets/mau-ca-heo.webp',
    difficulty: 'Dễ',
    gridSize: '25 x 22 ô',
    totalBeads: 198,
    time: '15 phút',
    pegboard: 'Bàn ủi 15x15cm',
    description: 'Mẫu Cá heo xanh được thiết kế với phối màu Gradient xanh dương tươi sáng, rất thích hợp để làm móc khóa hoặc trang trí góc học tập. Mẫu này sử dụng hạt Perler 5mm tiêu chuẩn.'
  };

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      if (params['id']) {
        this.mapId = params['id'];
      }
    });
  }

  saveMap() {
    let savedMaps = JSON.parse(localStorage.getItem('savedMaps') || '[]');
    const isExist = savedMaps.some((item: any) => item.id === this.mapDetail.id);

    if (!isExist) {
      savedMaps.push({
        id: this.mapDetail.id,
        title: this.mapDetail.name,
        author: "Urii Thiết kế",
        image: this.mapDetail.image,
        rating: 5.0,
        liked: true
      });
      localStorage.setItem('savedMaps', JSON.stringify(savedMaps));
      alert(`Đã lưu "${this.mapDetail.name}" vào danh sách của bạn!`);
    } else {
      alert(`Mẫu "${this.mapDetail.name}" đã tồn tại trong danh sách lưu.`);
    }
  }
  scrollToGuide() {
    const element = document.getElementById('guideSection');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  }
}