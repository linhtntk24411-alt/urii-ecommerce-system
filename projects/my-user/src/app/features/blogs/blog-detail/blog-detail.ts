import { ChangeDetectorRef, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Inject, PLATFORM_ID } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { BlogComment, BlogPost, BlogService } from '../../../core/services/blog.service';
import { HttpErrorResponse } from '@angular/common/http';
import { combineLatest, map, TimeoutError } from 'rxjs';

@Component({
  selector: 'app-blog-detail',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterLink],
  templateUrl: './blog-detail.html',
  styleUrl: './blog-detail.css'
})
export class BlogDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly blogService = inject(BlogService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly bookmarksStorageKey = 'bookmarks';
  private authChangeListener?: () => void;

  readonly commentForm = this.formBuilder.nonNullable.group({
    content: ['', [Validators.required, Validators.maxLength(2000)]],
  });
  blogData: BlogPost | null = null;
  blogComments: BlogComment[] = [];
  isLoggedIn = false;
  isLiked = false;
  isBookmarked = false;
  isCommentsLoading = false;
  isSubmittingComment = false;
  commentSuccessMessage = '';
  commentErrorMessage = '';
  commentsErrorMessage = '';
  isLoading = true;
  errorMessage = '';

  constructor(@Inject(PLATFORM_ID) private readonly platformId: Object) {}

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.syncAuthAndActions();
      this.authChangeListener = () => {
        this.syncAuthAndActions();
        this.changeDetectorRef.markForCheck();
      };
      window.addEventListener('auth:changed', this.authChangeListener);
    }

    combineLatest([this.route.paramMap, this.route.queryParamMap]).pipe(
      map(([pathParams, queryParams]) =>
        pathParams.get('slug') ?? queryParams.get('slug'),
      ),
    ).subscribe((value) => {
      const slug = value?.trim();
      if (!slug) {
        this.blogData = null;
        this.isLoading = false;
        this.errorMessage = 'Không tìm thấy mã bài viết.';
        this.changeDetectorRef.markForCheck();
        return;
      }

      this.loadBlog(slug);
    });
  }

  ngOnDestroy(): void {
    if (this.authChangeListener) {
      window.removeEventListener('auth:changed', this.authChangeListener);
    }
  }

  private loadBlog(slug: string): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.blogData = null;
    this.blogComments = [];
    this.commentsErrorMessage = '';

    this.blogService.getBlogBySlug(slug).subscribe({
      next: (blog) => {
        this.blogData = blog ?? null;
        this.errorMessage = blog ? '' : 'Không tìm thấy bài viết này.';
        this.syncAuthAndActions();
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
        if (blog) this.loadComments(blog.id);
      },
      error: (error: unknown) => {
        console.error('Lỗi tải chi tiết bài viết:', error);
        this.errorMessage = 'Không thể tải bài viết. Vui lòng thử lại.';
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  private loadComments(blogId: string | number): void {
    this.isCommentsLoading = true;
    this.commentsErrorMessage = '';

    this.blogService.getBlogComments(blogId).subscribe({
      next: (comments) => {
        this.blogComments = comments;
        this.isCommentsLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Lỗi tải bình luận bài viết:', error);
        this.blogComments = [];
        this.isCommentsLoading = false;
        this.commentsErrorMessage = 'Không thể tải bình luận. Vui lòng thử lại sau.';
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  formatCommentDate(value: string): string {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('vi-VN');
  }

  submitComment(): void {
    if (this.isSubmittingComment) return;

    const token = isPlatformBrowser(this.platformId)
      ? localStorage.getItem('authToken')
      : null;
    if (!this.isLoggedIn || !token) {
      this.requireLoginToComment();
      return;
    }

    const blog = this.blogData;
    if (!blog || !Number.isSafeInteger(Number(blog.id)) || Number(blog.id) < 1) {
      this.commentErrorMessage = 'Không thể xác định bài viết để gửi bình luận.';
      return;
    }
    if (this.commentForm.invalid) {
      this.commentForm.markAllAsTouched();
      return;
    }

    this.isSubmittingComment = true;
    this.commentErrorMessage = '';
    this.commentSuccessMessage = '';
    this.blogService.createComment({
      blogId: Number(blog.id),
      content: this.commentForm.controls.content.value.trim(),
    }, token).subscribe({
      next: (comment) => {
        this.blogComments = [...this.blogComments, comment];
        this.commentForm.reset();
        this.commentSuccessMessage = 'Bình luận đã được đăng.';
        this.isSubmittingComment = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Lỗi gửi bình luận:', error);
        if (error instanceof HttpErrorResponse && error.status === 401) {
          this.requireLoginToComment();
        } else if (error instanceof HttpErrorResponse && error.error?.message) {
          this.commentErrorMessage = error.error.message;
        } else if (error instanceof TimeoutError) {
          this.commentErrorMessage = 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.';
        } else {
          this.commentErrorMessage = 'Không thể gửi bình luận. Vui lòng thử lại.';
        }
        this.isSubmittingComment = false;
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  // ================= PHẢN HỒI BÌNH LUẬN (REPLY) =================
  activeReplyCommentId: string | number | null = null;
  replyContentMap: Record<string, string> = {};
  isSubmittingReplyMap: Record<string, boolean> = {};
  replyErrorMessageMap: Record<string, string> = {};

  openReplyForm(commentId: string | number): void {
    if (!this.isLoggedIn) {
      this.requireLoginToComment();
      return;
    }
    const key = String(commentId);
    this.activeReplyCommentId = this.activeReplyCommentId === commentId ? null : commentId;
    this.replyErrorMessageMap[key] = '';
    if (!this.replyContentMap[key]) {
      this.replyContentMap[key] = '';
    }
    this.changeDetectorRef.markForCheck();
  }

  cancelReply(commentId: string | number): void {
    const key = String(commentId);
    this.activeReplyCommentId = null;
    this.replyContentMap[key] = '';
    this.replyErrorMessageMap[key] = '';
    this.changeDetectorRef.markForCheck();
  }

  submitReply(comment: BlogComment): void {
    const key = String(comment.id);
    const content = (this.replyContentMap[key] || '').trim();

    if (!content) {
      this.replyErrorMessageMap[key] = 'Vui lòng nhập nội dung phản hồi.';
      this.changeDetectorRef.markForCheck();
      return;
    }

    const token = isPlatformBrowser(this.platformId)
      ? localStorage.getItem('authToken')
      : null;

    if (!this.isLoggedIn || !token) {
      this.requireLoginToComment();
      return;
    }

    this.isSubmittingReplyMap[key] = true;
    this.replyErrorMessageMap[key] = '';

    this.blogService.replyComment(comment.id, content, token).subscribe({
      next: (res) => {
        // Cập nhật danh sách replies trực tiếp
        if (!comment.replies) {
          comment.replies = [];
        }
        
        // Nếu API trả về comment object đã enrich
        if (res && Array.isArray(res.replies)) {
          comment.replies = res.replies;
        } else {
          // Fallback thêm reply mới vào mảng
          const userName = localStorage.getItem('userName') || 'Bạn';
          const userAvatar = localStorage.getItem('userAvatar') || 'assets/avatar-non.jpg';
          comment.replies.push({
            id: 'r-' + Date.now(),
            author: userName,
            avatar: userAvatar,
            content: content,
            time: 'Vừa xong',
            role: 'user'
          });
        }

        this.replyContentMap[key] = '';
        this.activeReplyCommentId = null;
        this.isSubmittingReplyMap[key] = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (err) => {
        console.error('Lỗi phản hồi bình luận:', err);
        this.replyErrorMessageMap[key] = err.error?.message || 'Không thể gửi phản hồi lúc này.';
        this.isSubmittingReplyMap[key] = false;
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  private requireLoginToComment(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.alert('Hãy đăng nhập để bình luận vào bài viết');
    }
    void this.router.navigate(['/login'], {
      queryParams: { returnUrl: this.router.url },
    });
  }

  toggleLike(): void {
    const blog = this.blogData;
    const email = this.requireSignedInUser();
    if (!blog || !email) return;

    const storageKey = this.likesStorageKey(email);
    const likedBlogIds = this.readIdSet(storageKey);
    const blogId = String(blog.id);
    if (likedBlogIds.has(blogId)) {
      likedBlogIds.delete(blogId);
      this.isLiked = false;
    } else {
      likedBlogIds.add(blogId);
      this.isLiked = true;
    }
    this.writeIdSet(storageKey, likedBlogIds);
  }

  toggleBookmark(): void {
    const blog = this.blogData;
    if (!blog || !this.requireSignedInUser()) return;

    const bookmarks = this.readBookmarks();
    const blogId = String(blog.id);
    if (bookmarks[blogId]) {
      delete bookmarks[blogId];
      this.isBookmarked = false;
    } else {
      bookmarks[blogId] = true;
      this.isBookmarked = true;
    }

    try {
      localStorage.setItem(this.bookmarksStorageKey, JSON.stringify(bookmarks));
    } catch (error: unknown) {
      console.error('Không thể lưu danh sách bài viết:', error);
      this.showStorageError();
      this.syncAuthAndActions();
    }
  }

  get displayedLikeCount(): number {
    return (this.blogData?.likes ?? 0) + (this.isLiked ? 1 : 0);
  }

  private syncAuthAndActions(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const email = localStorage.getItem('userEmail')?.trim().toLowerCase() ?? '';
    this.isLoggedIn = localStorage.getItem('isLoggedIn') === 'true' && email.length > 0;
    if (!this.isLoggedIn || !this.blogData) {
      this.isLiked = false;
      this.isBookmarked = false;
      return;
    }

    this.isLiked = this.readIdSet(this.likesStorageKey(email)).has(String(this.blogData.id));
    this.isBookmarked = this.readBookmarks()[String(this.blogData.id)] === true;
  }

  private requireSignedInUser(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;

    const email = localStorage.getItem('userEmail')?.trim().toLowerCase() ?? '';
    if (localStorage.getItem('isLoggedIn') === 'true' && email) return email;

    void this.router.navigate(['/login'], {
      queryParams: { returnUrl: this.router.url },
    });
    return null;
  }

  private likesStorageKey(email: string): string {
    return `blogLikes:${email}`;
  }

  private readIdSet(key: string): Set<string> {
    const stored = localStorage.getItem(key);
    if (!stored) return new Set();

    try {
      const ids: unknown = JSON.parse(stored);
      if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) {
        return new Set(ids);
      }
      throw new Error('Stored blog IDs are not a string array');
    } catch (error: unknown) {
      console.error(`Không thể đọc dữ liệu bài viết đã lưu (${key}):`, error);
      return new Set();
    }
  }

  private writeIdSet(key: string, ids: Set<string>): void {
    try {
      localStorage.setItem(key, JSON.stringify([...ids]));
    } catch (error: unknown) {
      console.error('Không thể lưu trạng thái yêu thích bài viết:', error);
      this.showStorageError();
      this.syncAuthAndActions();
    }
  }

  private readBookmarks(): Record<string, boolean> {
    const stored = localStorage.getItem(this.bookmarksStorageKey);
    if (!stored) return {};

    try {
      const bookmarks: unknown = JSON.parse(stored);
      if (typeof bookmarks === 'object' && bookmarks !== null && !Array.isArray(bookmarks)) {
        return Object.fromEntries(
          Object.entries(bookmarks).filter(([, value]) => value === true),
        );
      }
      throw new Error('Stored blog bookmarks are not an object');
    } catch (error: unknown) {
      console.error('Không thể đọc danh sách bài viết đã lưu:', error);
      return {};
    }
  }

  private showStorageError(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.alert('Không thể lưu thay đổi trên thiết bị này. Vui lòng kiểm tra bộ nhớ trình duyệt.');
    }
  }
}
