import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ChangeDetectorRef, Component, inject, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { BlogPost, BlogService } from '../../../core/services/blog.service';
import { ToastService } from '../../../core/services/toast.service';

interface CurrentUserProfile {
  id?: string;
  _id?: string;
}

interface SavedBlogDraft {
  title: string;
  category: string;
  content: string;
  imagePreviewUrls: string[];
}

@Component({
  selector: 'app-my-blogs',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './my-blogs.html',
  styleUrl: './my-blogs.css',
})
export class MyBlogsComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly blogService = inject(BlogService);
  private readonly toast = inject(ToastService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private profileRequest?: Subscription;
  private blogsRequest?: Subscription;
  private deleteRequest?: Subscription;

  publishedBlogs: BlogPost[] = [];
  draft: SavedBlogDraft | null = null;
  isLoading = false;
  authRequired = false;
  errorMessage = '';
  deletingBlogId: string | number | null = null;

  ngOnInit(): void {
    if (this.isBrowser) this.loadMyBlogs();
  }

  ngOnDestroy(): void {
    this.profileRequest?.unsubscribe();
    this.blogsRequest?.unsubscribe();
    this.deleteRequest?.unsubscribe();
  }

  loadMyBlogs(): void {
    const token = localStorage.getItem('authToken');
    if (localStorage.getItem('isLoggedIn') !== 'true' || !token) {
      this.authRequired = true;
      this.isLoading = false;
      return;
    }

    this.authRequired = false;
    this.isLoading = true;
    this.errorMessage = '';
    this.loadDraft();
    this.profileRequest?.unsubscribe();
    this.blogsRequest?.unsubscribe();
    this.profileRequest = this.http.get<CurrentUserProfile>('/api/auth/me', {
      headers: new HttpHeaders({ Authorization: 'Bearer ' + token }),
    }).subscribe({
      next: (profile) => {
        const userId = profile.id ?? profile._id;
        if (typeof userId !== 'string' || !userId) {
          console.error('API hồ sơ cá nhân không trả về mã người dùng hợp lệ.');
          this.errorMessage = 'Không thể xác định tài khoản hiện tại. Vui lòng thử lại.';
          this.isLoading = false;
          this.changeDetectorRef.markForCheck();
          return;
        }

        this.blogsRequest = this.blogService.getBlogsByUser(token, userId).subscribe({
          next: (blogs) => {
            this.publishedBlogs = blogs;
            this.isLoading = false;
            this.changeDetectorRef.markForCheck();
          },
          error: (error: unknown) => {
            console.error('Lỗi tải bài viết của tôi:', error);
            this.publishedBlogs = [];
            this.errorMessage = 'Không thể tải bài viết của bạn. Vui lòng thử lại.';
            this.isLoading = false;
            this.changeDetectorRef.markForCheck();
          },
        });
      },
      error: (error: unknown) => {
        console.error('Lỗi tải thông tin tài khoản:', error);
        this.publishedBlogs = [];
        this.errorMessage = 'Không thể xác thực tài khoản. Vui lòng đăng nhập lại.';
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  deleteBlog(blog: BlogPost, event: Event): void {
    event.stopPropagation();
    event.preventDefault();

    if (!confirm(`Bạn có chắc chắn muốn xóa bài viết "${blog.title}"?`)) {
      return;
    }

    const token = localStorage.getItem('authToken');
    if (!token) {
      this.toast.show('Vui lòng đăng nhập lại để thực hiện.', 'error');
      return;
    }

    this.deletingBlogId = blog.id;
    this.changeDetectorRef.markForCheck();

    this.deleteRequest?.unsubscribe();
    this.deleteRequest = this.blogService.deleteBlog(blog.id, token).subscribe({
      next: () => {
        this.publishedBlogs = this.publishedBlogs.filter((b) => b.id !== blog.id);
        this.deletingBlogId = null;
        this.toast.show(`Đã xóa bài viết "${blog.title}".`, 'success');
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Lỗi xóa bài viết:', error);
        this.deletingBlogId = null;
        this.toast.show('Không thể xóa bài viết. Vui lòng thử lại.', 'error');
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  deleteDraft(event: Event): void {
    event.stopPropagation();
    event.preventDefault();

    if (!confirm('Bạn có chắc chắn muốn xóa bản nháp này?')) {
      return;
    }

    try {
      localStorage.removeItem('blogDraft');
      this.draft = null;
      this.toast.show('Đã xóa bản nháp thành công.', 'success');
      this.changeDetectorRef.markForCheck();
    } catch (error) {
      console.error('Lỗi khi xóa bản nháp:', error);
      this.toast.show('Không thể xóa bản nháp.', 'error');
    }
  }

  getDraftExcerpt(): string {
    const text = this.draft?.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
    return text.slice(0, 180) || 'Bản nháp chưa có nội dung.';
  }

  getDraftCategory(): string {
    const categories: Record<string, string> = {
      'huong-dan-diy': 'Hướng dẫn DIY',
      'y-tuong-thiet-ke': 'Ý tưởng thiết kế',
      'goc-nghe-thuat': 'Góc nghệ thuật',
      'meo-vat': 'Mẹo vặt',
    };
    return this.draft ? categories[this.draft.category] ?? 'Khác' : '';
  }

  private loadDraft(): void {
    try {
      const savedDraft = localStorage.getItem('blogDraft');
      if (!savedDraft) {
        this.draft = null;
        return;
      }

      const value: unknown = JSON.parse(savedDraft);
      if (!this.isSavedDraft(value)) {
        console.error('Bản nháp blog đã lưu không đúng định dạng.');
        this.draft = null;
        return;
      }
      this.draft = value;
    } catch (error: unknown) {
      console.error('Không thể tải bản nháp blog:', error);
      this.draft = null;
    }
  }

  private isSavedDraft(value: unknown): value is SavedBlogDraft {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const draft = value as Record<string, unknown>;
    return typeof draft['title'] === 'string'
      && typeof draft['category'] === 'string'
      && typeof draft['content'] === 'string'
      && Array.isArray(draft['imagePreviewUrls'])
      && draft['imagePreviewUrls'].every((image) => typeof image === 'string');
  }
}
