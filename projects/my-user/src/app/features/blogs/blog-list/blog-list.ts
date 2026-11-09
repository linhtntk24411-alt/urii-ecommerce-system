import { ChangeDetectorRef, Component, inject, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { BlogPost, BlogService } from '../../../core/services/blog.service';
import { DialogService } from '../../../core/services/dialog.service';

@Component({
  selector: 'app-blog-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './blog-list.html',
  styleUrl: './blog-list.css'
})
export class BlogListComponent implements OnInit {
  private readonly blogService = inject(BlogService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogService = inject(DialogService);

  allBlogs: BlogPost[] = [];

  filteredBlogs: BlogPost[] = [];
  currentCategory: string = 'all';
  currentSort: string = 'newest';
  currentPage: number = 1;
  perPage: number = 6;
  searchTerm = '';
  bookmarks: Record<string, boolean> = {};
  isLoading = true;
  errorMessage = '';

  constructor(
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.searchTerm = params.get('search')?.trim() ?? '';
      this.currentPage = 1;
      this.applyFilters();
    });

    if (isPlatformBrowser(this.platformId)) {
      const savedBookmarks = localStorage.getItem('bookmarks');
      if (savedBookmarks) {
        this.bookmarks = JSON.parse(savedBookmarks);
      }
      this.loadBlogs();
    if (isPlatformBrowser(this.platformId)) {
      const token = localStorage.getItem('authToken') || '';
      if (token) {
        this.blogService.getMyLikedBlogs(token).subscribe({
          next: (ids) => {
            ids.forEach(id => this.bookmarks[id] = true);
          }
        });
      }
    }
    }
  }

  loadBlogs(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.blogService.getBlogs().subscribe({
      next: (blogs) => {
        this.allBlogs = [...blogs].sort((a, b) => this.dateValue(b.date) - this.dateValue(a.date));
        this.applyFilters();
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Lỗi tải danh sách blog:', error);
        this.allBlogs = [];
        this.filteredBlogs = [];
        this.errorMessage = 'Không thể tải bài viết. Vui lòng thử lại.';
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
    });
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

    const searchTerm = this.normalize(this.searchTerm);
    if (searchTerm) {
      result = result.filter((blog) =>
        [blog.title, blog.summary, blog.excerpt, blog.content, ...blog.tags]
          .some((value) => this.normalize(value).includes(searchTerm)),
      );
    }

    if (this.currentSort === 'newest') {
      result.sort((a, b) => this.dateValue(b.date) - this.dateValue(a.date));
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

  private isLoggedIn(): boolean {
    return isPlatformBrowser(this.platformId) && localStorage.getItem('isLoggedIn') === 'true';
  }

  goToCreateBlog(): void {
    if (!this.isLoggedIn()) {
      this.dialogService.promptLogin({
        title: 'Đăng nhập để tạo bài viết blog',
        description: 'Vui lòng đăng nhập tài khoản Urii để chia sẻ bài viết, kỹ thuật và cảm hứng sáng tạo cùng cộng đồng.',
        returnUrl: '/blog-create'
      });
      return;
    }
    this.router.navigate(['/blog-create']);
  }

  toggleBookmark(blogId: string | number, event: Event): void {
    event.stopPropagation();
    if (!this.isLoggedIn()) {
      this.dialogService.promptLogin({
        title: 'Đăng nhập để lưu bài viết',
        description: 'Vui lòng đăng nhập để lưu bài viết vào danh sách quan tâm của bạn.',
        returnUrl: this.router.url
      });
      return;
    }
    if (this.bookmarks[blogId]) {
      delete this.bookmarks[blogId];
    } else {
      this.bookmarks[blogId] = true;
    }
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('bookmarks', JSON.stringify(this.bookmarks));
    }
  }

  isBookmarked(blogId: string | number): boolean {
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

  private dateValue(value: string): number {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  private normalize(value: string): string {
    return value.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('vi');
  }
}