import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';

@Component({
  selector: 'app-blog-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './blog-detail.html',
  styleUrl: './blog-detail.css'
})
export class BlogDetailComponent implements OnInit {
  // Data giả lập bài viết
  blogData = {
    id: 1,
    title: 'Chiều cuối tuần trốn thế giới bên góc bàn nhỏ',
    category: 'Hướng dẫn DIY',
    author: 'Minh Anh',
    avatar: 'assets/gallery_assets/mau-ca-heo.webp', 
    date: '24 Tháng 5, 2024',
    image: 'assets/gallery_assets/mau-ca-heo.webp',
    content: `
      <p>Sau một tuần làm việc bù đầu, chiều thứ Bảy là khoảng thời gian mong đợi nhất để ngồi bên góc bàn đồ handmade. Không vội vã, không deadline, chỉ có những hạt nhựa nhỏ xíu và bản nhạc yêu thích.</p>
      <b>1. Chuẩn bị nguyên liệu</b>
      <p>Để bắt đầu, bạn cần chuẩn bị một bộ kit cơ bản bao gồm: bàn ủi (pegboard), giấy nến, nhíp gắp hạt và các màu hạt theo sở thích. Đừng quên một tách trà nóng để buổi chiều thêm trọn vẹn!</p>
      <blockquote>"Handmade không chỉ là tạo ra sản phẩm, mà còn là quá trình chữa lành tâm hồn."</blockquote>
      <b>2. Bắt đầu xếp hạt</b>
      <p>Hãy bắt đầu từ những chi tiết nhỏ nhất, sau đó mới đến các mảng màu lớn. Kiên nhẫn là chìa khóa. Nếu lỡ xếp sai, đừng lo, bạn chỉ cần dùng nhíp gắp ra và làm lại.</p>
      <img src="assets/gallery_assets/mau-ca-heo.webp" alt="Mẫu xếp hạt" />
    `,
    tags: ['DIY', 'Handmade', 'Chill'],
    likes: 128,
    comments: [
      {
        id: 1,
        author: 'Linh Chi',
        avatar: 'assets/gallery_assets/mau-hellokitty.webp',
        content: 'Nhìn dễ thương quá, cuối tuần này mình cũng phải thử mới được!',
        time: '2 giờ trước',
        replies: [
          {
            id: 2,
            author: 'Minh Anh',
            avatar: 'assets/gallery_assets/mau-cao.webp',
            content: 'Thử đi bạn ơi, làm cái này thư giãn lắm á!',
            time: '1 giờ trước',
            replies: []
          }
        ]
      }
    ]
  };

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      const slug = params['slug'];
      console.log('Đang xem bài viết có slug:', slug);
    });
  }

  toggleLike() { console.log('Đã thích bài viết'); }
  toggleBookmark() { console.log('Đã lưu bài viết'); }
}