import { ChangeDetectorRef, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Inject, PLATFORM_ID } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { BlogComment, BlogPost, BlogService } from '../../../core/services/blog.service';
import { DialogService } from '../../../core/services/dialog.service';
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
  private readonly dialogService = inject(DialogService);
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
        this.errorMessage = 'KhĂ´ng tĂ¬m tháº¥y mĂ£ bĂ i viáº¿t.';
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
        this.errorMessage = blog ? '' : 'KhĂ´ng tĂ¬m tháº¥y bĂ i viáº¿t nĂ y.';
        this.syncAuthAndActions();
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
        if (blog) this.loadComments(blog.id);
      },
      error: (error: unknown) => {
        console.error('Lá»—i táº£i chi tiáº¿t bĂ i viáº¿t:', error);
        this.errorMessage = 'KhĂ´ng thá»ƒ táº£i bĂ i viáº¿t. Vui lĂ²ng thá»­ láº¡i.';
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
        console.error('Lá»—i táº£i bĂ¬nh luáº­n bĂ i viáº¿t:', error);
        this.blogComments = [];
        this.isCommentsLoading = false;
        this.commentsErrorMessage = 'KhĂ´ng thá»ƒ táº£i bĂ¬nh luáº­n. Vui lĂ²ng thá»­ láº¡i sau.';
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
      this.commentErrorMessage = 'KhĂ´ng thá»ƒ xĂ¡c Ä‘á»‹nh bĂ i viáº¿t Ä‘á»ƒ gá»­i bĂ¬nh luáº­n.';
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
        this.commentSuccessMessage = 'BĂ¬nh luáº­n Ä‘Ă£ Ä‘Æ°á»£c Ä‘Äƒng.';
        this.isSubmittingComment = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Lá»—i gá»­i bĂ¬nh luáº­n:', error);
        if (error instanceof HttpErrorResponse && error.status === 401) {
          this.requireLoginToComment();
        } else if (error instanceof HttpErrorResponse && error.error?.message) {
          this.commentErrorMessage = error.error.message;
        } else if (error instanceof TimeoutError) {
          this.commentErrorMessage = 'MĂ¡y chá»§ pháº£n há»“i quĂ¡ lĂ¢u. Vui lĂ²ng thá»­ láº¡i.';
        } else {
          this.commentErrorMessage = 'KhĂ´ng thá»ƒ gá»­i bĂ¬nh luáº­n. Vui lĂ²ng thá»­ láº¡i.';
        }
        this.isSubmittingComment = false;
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  // ================= PHáº¢N Há»’I BĂŒNH LUáº¬N (REPLY) =================
  activeReplyCommentId: string | number | null = null;
  showRepliesMap: Record<string, boolean> = {};
  replyToAuthorMap: Record<string, string> = {};
  replyContentMap: Record<string, string> = {};
  isSubmittingReplyMap: Record<string, boolean> = {};
  replyErrorMessageMap: Record<string, string> = {};

  isRepliesVisible(commentId: string | number): boolean {
    const key = String(commentId);
    // Máº·c Ä‘á»‹nh luĂ´n hiá»‡n reply ngay khi vĂ o blog (trá»« khi ngÆ°á»i dĂ¹ng báº¥m áº©n)
    return this.showRepliesMap[key] !== false;
  }

  toggleReplies(commentId: string | number): void {
    const key = String(commentId);
    this.showRepliesMap[key] = !this.isRepliesVisible(commentId);
    this.changeDetectorRef.markForCheck();
  }

  openReplyForm(commentId: string | number): void {
    if (!this.isLoggedIn) {
      this.requireLoginToComment();
      return;
    }
    const key = String(commentId);
    if (this.activeReplyCommentId === commentId && !this.replyToAuthorMap[key]) {
      this.activeReplyCommentId = null;
    } else {
      this.activeReplyCommentId = commentId;
      this.showRepliesMap[key] = true;
      this.replyToAuthorMap[key] = '';
    }
    this.replyErrorMessageMap[key] = '';
    if (!this.replyContentMap[key]) {
      this.replyContentMap[key] = '';
    }
    this.changeDetectorRef.markForCheck();
  }

  openReplyToReplyForm(comment: BlogComment, reply: any): void {
    if (!this.isLoggedIn) {
      this.requireLoginToComment();
      return;
    }
    const key = String(comment.id);
    this.activeReplyCommentId = comment.id;
    this.showRepliesMap[key] = true;
    this.replyToAuthorMap[key] = reply.author || '';
    this.replyContentMap[key] = `@${reply.author} `;
    this.replyErrorMessageMap[key] = '';
    this.changeDetectorRef.markForCheck();
  }

  cancelReply(commentId: string | number): void {
    const key = String(commentId);
    this.activeReplyCommentId = null;
    this.replyContentMap[key] = '';
    this.replyToAuthorMap[key] = '';
    this.replyErrorMessageMap[key] = '';
    this.changeDetectorRef.markForCheck();
  }

  submitReply(comment: BlogComment): void {
    const key = String(comment.id);
    const content = (this.replyContentMap[key] || '').trim();

    if (!content) {
      this.replyErrorMessageMap[key] = 'Vui lĂ²ng nháº­p ná»™i dung pháº£n há»“i.';
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
    const replyToAuthor = this.replyToAuthorMap[key] || '';

    this.blogService.replyComment(comment.id, content, token, replyToAuthor).subscribe({
      next: (res) => {
        if (!comment.replies) {
          comment.replies = [];
        }
        
        if (res && Array.isArray(res.replies)) {
          comment.replies = res.replies;
        } else {
          const userName = localStorage.getItem('userName') || 'Báº¡n';
          const userAvatar = localStorage.getItem('userAvatar') || 'assets/avatar-non.jpg';
          comment.replies.push({
            id: 'r-' + Date.now(),
            author: userName,
            avatar: userAvatar,
            content: content,
            time: 'Vá»«a xong',
            role: 'user',
            replyToAuthor: replyToAuthor || undefined
          });
        }

        this.replyContentMap[key] = '';
        this.replyToAuthorMap[key] = '';
        this.activeReplyCommentId = null;
        this.showRepliesMap[key] = true;
        this.isSubmittingReplyMap[key] = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (err) => {
        console.error('Lá»—i pháº£n há»“i bĂ¬nh luáº­n:', err);
        this.replyErrorMessageMap[key] = err.error?.message || 'KhĂ´ng thá»ƒ gá»­i pháº£n há»“i lĂºc nĂ y.';
        this.isSubmittingReplyMap[key] = false;
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  private requireLoginToComment(): void {
    this.dialogService.promptLogin({
      title: 'ÄÄƒng nháº­p Ä‘á»ƒ bĂ¬nh luáº­n',
      description: 'Vui lĂ²ng Ä‘Äƒng nháº­p Ä‘á»ƒ gá»­i bĂ¬nh luáº­n vĂ  tháº£o luáº­n cĂ¹ng cá»™ng Ä‘á»“ng Urii.',
      returnUrl: this.router.url
    });
  }

  toggleLike(): void {
    const blog = this.blogData;
    const email = this.requireSignedInUser('ÄÄƒng nháº­p Ä‘á»ƒ thĂ­ch bĂ i viáº¿t', 'Vui lĂ²ng Ä‘Äƒng nháº­p Ä‘á»ƒ tháº£ cáº£m xĂºc vĂ  tÆ°Æ¡ng tĂ¡c vá»›i bĂ i viáº¿t nĂ y.');
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

    const token = localStorage.getItem('authToken') || '';
    if (token) {
      if (this.isLiked) {
        this.blogService.addLikedBlog(blog.id, token).subscribe({ error: (e) => console.error(e) });
      } else {
        this.blogService.removeLikedBlog(blog.id, token).subscribe({ error: (e) => console.error(e) });
      }
    }
  }

  toggleBookmark(): void {
    const blog = this.blogData;
    if (!blog || !this.requireSignedInUser('ÄÄƒng nháº­p Ä‘á»ƒ lÆ°u bĂ i viáº¿t', 'Vui lĂ²ng Ä‘Äƒng nháº­p Ä‘á»ƒ lÆ°u bĂ i viáº¿t vĂ o danh sĂ¡ch quan tĂ¢m cá»§a báº¡n.')) return;

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
      const token = localStorage.getItem('authToken') || '';
      if (token) {
        if (this.isBookmarked) {
          this.blogService.addLikedBlog(blog.id, token).subscribe({ error: (e) => console.error(e) });
        } else {
          this.blogService.removeLikedBlog(blog.id, token).subscribe({ error: (e) => console.error(e) });
        }
      }
    } catch (error: unknown) {
      console.error('KhĂ´ng thá»ƒ lÆ°u danh sĂ¡ch bĂ i viáº¿t:', error);
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

  private requireSignedInUser(title = 'ÄÄƒng nháº­p Ä‘á»ƒ tiáº¿p tá»¥c', description = 'Vui lĂ²ng Ä‘Äƒng nháº­p Ä‘á»ƒ sá»­ dá»¥ng tĂ­nh nÄƒng nĂ y.'): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;

    const email = localStorage.getItem('userEmail')?.trim().toLowerCase() ?? '';
    if (localStorage.getItem('isLoggedIn') === 'true' && email) return email;

    this.dialogService.promptLogin({
      title,
      description,
      returnUrl: this.router.url
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
      console.error(`KhĂ´ng thá»ƒ Ä‘á»c dá»¯ liá»‡u bĂ i viáº¿t Ä‘Ă£ lÆ°u (${key}):`, error);
      return new Set();
    }
  }

  private writeIdSet(key: string, ids: Set<string>): void {
    try {
      localStorage.setItem(key, JSON.stringify([...ids]));
    } catch (error: unknown) {
      console.error('KhĂ´ng thá»ƒ lÆ°u tráº¡ng thĂ¡i yĂªu thĂ­ch bĂ i viáº¿t:', error);
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
      console.error('KhĂ´ng thá»ƒ Ä‘á»c danh sĂ¡ch bĂ i viáº¿t Ä‘Ă£ lÆ°u:', error);
      return {};
    }
  }

  private showStorageError(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.dialogService.alert('KhĂ´ng thá»ƒ lÆ°u thay Ä‘á»•i trĂªn thiáº¿t bá»‹ nĂ y. Vui lĂ²ng kiá»ƒm tra bá»™ nhá»› trĂ¬nh duyá»‡t.', 'Lá»—i lÆ°u trá»¯', 'error');
    }
  }
}
