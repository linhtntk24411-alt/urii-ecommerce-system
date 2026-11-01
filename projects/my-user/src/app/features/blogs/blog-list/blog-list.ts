import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

interface BlogPost {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  content?: string;
  category: string;
  categorySlug: string;
  author: string;
  avatar: string;
  date: string;
  image: string;
  likes: number;
  comments: number;
  views: number;
  isFeatured?: boolean;
  tags?: string[];
}

@Component({
  selector: 'app-blog-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './blog-list.html',
  styleUrl: './blog-list.css'
})
export class BlogListComponent implements OnInit {
  allBlogs: BlogPost[] = [
    {
      id: 1,
      slug: 'chieu-cuoi-tuan-tron-the-gioi-ben-goc-ban-nho',
      title: 'Chiều cuối tuần trốn thế giới bên góc bàn nhỏ',
      excerpt: 'Sau một tuần làm việc bù đầu, chiều thứ Bảy là khoảng thời gian mong đợi nhất để ngồi bên góc bàn đồ handmade.',
      category: 'Hướng dẫn DIY',
      categorySlug: 'huong-dan-diy',
      author: 'Minh Anh',
      avatar: 'assets/avatar-non.jpg',
      date: '24 Tháng 5, 2024',
      image: 'assets/bg.jpg',
      likes: 128,
      comments: 10,
      views: 350,
      isFeatured: true,
      tags: ['DIY', 'PerlerBeads', 'ThuGiang']
    },
    {
      id: 2,
      slug: 'em-cao-cam-sieu-chua-lanh',
      title: 'Em cáo cam siêu \'chữa lành\' cho ngày mệt mỏi',
      excerpt: 'Hì hục nguyên một buổi tối, cuối cùng em cáo này cũng chịu lộ diện với đôi mắt híp và nụ cười thả ga.',
      category: 'Ý tưởng thiết kế',
      categorySlug: 'y-tuong-thiet-ke',
      author: 'Minh Anh',
      avatar: 'assets/avatar-non.jpg',
      date: '22 Tháng 5, 2024',
      image: 'assets/bg.jpg',
      likes: 86,
      comments: 3,
      views: 210,
      tags: ['ThietKe', 'CaoCam']
    },
    {
      id: 3,
      slug: 'khi-ban-khoc-nhung-trong-van-buon-cuoi',
      title: 'Khi bạn khóc nhưng trông vẫn... buồn cười',
      excerpt: 'Trời mưa tâm trạng hơi sụt sịt, mình làm chú mèo khóc nhè, ai ngờ nhìn lại thấy buồn cười và đáng yêu.',
      category: 'Góc nghệ thuật',
      categorySlug: 'goc-nghe-thuat',
      author: 'Linh Chi',
      avatar: 'assets/avatar-non.jpg',
      date: '20 Tháng 5, 2024',
      image: 'assets/bg.jpg',
      likes: 215,
      comments: 3,
      views: 420,
      tags: ['Art', 'MeoKhoc']
    },
    {
      id: 4,
      slug: 'chiec-rem-cua-bon-mua-tu-che-doc-nhat-vo-nhi',
      title: 'Chiếc rèm cửa bốn mùa tự chế độc nhất vô nhị',
      excerpt: 'Tốn gần một tháng ròng rã để làm từng nhân vật nhỏ nổi thành dải treo, F5 cánh cửa phòng ngủ.',
      category: 'Ý tưởng thiết kế',
      categorySlug: 'y-tuong-thiet-ke',
      author: 'Hoàng Nam',
      avatar: 'assets/avatar-non.jpg',
      date: '18 Tháng 5, 2024',
      image: 'assets/bg.jpg',
      likes: 154,
      comments: 2,
      views: 310,
      tags: ['RemCua', 'TrangTri']
    },
    {
      id: 5,
      slug: 'khi-do-handmade-cung-minh-xuong-pho',
      title: 'Khi đồ handmade cùng mình xuống phố',
      excerpt: 'Ai bảo đồ handmade chỉ để trưng bày? Mang charm lên túi tote để dạo phố, ai cũng hỏi mua.',
      category: 'Hướng dẫn DIY',
      categorySlug: 'huong-dan-diy',
      author: 'Linh Chi',
      avatar: 'assets/avatar-non.jpg',
      date: '15 Tháng 5, 2024',
      image: 'assets/bg.jpg',
      likes: 212,
      comments: 2,
      views: 290,
      tags: ['PhuKien', 'ToteBag']
    },
    {
      id: 6,
      slug: 'hai-nguoi-ban-nho-kep-trang-so-tay',
      title: 'Hai người bạn nhỏ kẹp trang sổ tay',
      excerpt: 'Bé tôm chiên giòn và chú cún trắng tai dài - bộ đôi bookmark siêu đáng yêu cho planner mỗi ngày.',
      category: 'Góc nghệ thuật',
      categorySlug: 'goc-nghe-thuat',
      author: 'Thùy Tú',
      avatar: 'assets/avatar-non.jpg',
      date: '12 Tháng 5, 2024',
      image: 'assets/bg.jpg',
      likes: 154,
      comments: 2,
      views: 180,
      tags: ['Bookmark', 'SoTay']
    }
  ];

  filteredBlogs: BlogPost[] = [];
  currentCategory: string = 'all';
  currentSort: string = 'newest';
  currentPage: number = 1;
  perPage: number = 6;
  bookmarks: { [key: number]: boolean } = {};

  constructor(
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    // Chỉ gọi localStorage khi chạy trên trình duyệt (Browser)
    if (isPlatformBrowser(this.platformId)) {
      const savedBookmarks = localStorage.getItem('bookmarks');
      if (savedBookmarks) {
        this.bookmarks = JSON.parse(savedBookmarks);
      }
    }
    this.applyFilters();
  }

  selectCategory(categorySlug: string): void {
    this.currentCategory = categorySlug;
    this.currentPage = 1;
    this.applyFilters();
  }

  onSortChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.currentSort = select.value;
    this.applyFilters();
  }

  applyFilters(): void {
    let result = [...this.allBlogs];

    if (this.currentCategory !== 'all') {
      result = result.filter(b => b.categorySlug === this.currentCategory);
    }

    if (this.currentSort === 'newest') {
      result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } else if (this.currentSort === 'most-viewed') {
      result.sort((a, b) => b.views - a.views);
    } else if (this.currentSort === 'most-liked') {
      result.sort((a, b) => b.likes - a.likes);
    }

    this.filteredBlogs = result;
  }

  get paginatedBlogs(): BlogPost[] {
    const start = (this.currentPage - 1) * this.perPage;
    return this.filteredBlogs.slice(start, start + this.perPage);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredBlogs.length / this.perPage);
  }

  get totalPagesArray(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  get featuredBlog(): BlogPost | undefined {
    return this.allBlogs.find(b => b.isFeatured) || this.allBlogs[0];
  }

  get sidebarBlogs(): BlogPost[] {
    const featured = this.featuredBlog;
    return this.allBlogs.filter(b => b.id !== featured?.id).slice(0, 3);
  }

  viewDetail(slug: string): void {
    this.router.navigate(['/blog-detail'], { queryParams: { slug: slug } });
  }

  goToCreateBlog(): void {
    this.router.navigate(['/blog-create']);
  }

  toggleBookmark(blogId: number, event: Event): void {
    event.stopPropagation();
    if (this.bookmarks[blogId]) {
      delete this.bookmarks[blogId];
    } else {
      this.bookmarks[blogId] = true;
    }
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('bookmarks', JSON.stringify(this.bookmarks));
    }
  }

  isBookmarked(blogId: number): boolean {
    return !!this.bookmarks[blogId];
  }

  getCategoryColor(slug: string): string {
    const colors: { [key: string]: string } = {
      'huong-dan-diy': '#6C5B7B',
      'meo-vat': '#F08A5D',
      'y-tuong-thiet-ke': '#B83B5E',
      'goc-nghe-thuat': '#6A9C89'
    };
    return colors[slug] || '#840001';
  }
}