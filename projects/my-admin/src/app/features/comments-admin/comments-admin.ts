import { ChangeDetectorRef, Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TimeoutError, catchError, forkJoin, of } from 'rxjs';
import { AdminApiService, AdminComment, AdminReview } from '../../core/services/admin-api.service';

interface CommentItem {
  id: string;
  content: string;
  targetName: string;
  targetType: 'product' | 'order' | 'blog';
  authorName: string;
  authorAvatar: string;
  date: string;
  rating?: number;
  // Trạng thái nội dung
  status: 'normal' | 'flagged';

  // Trạng thái trả lời
  reply?: string;
  replyStatus: 'unanswered' | 'replied';
  replies?: { content: string; role?: string; author?: string }[];
}

@Component({
  selector: 'app-comments-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './comments-admin.html',
  styleUrls: ['./comments-admin.css']
})
export class CommentsAdmin implements OnInit {
  constructor(
    private adminApi: AdminApiService,
    private changeDetectorRef: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  allComments: CommentItem[] = [];
  isLoading = false;
  commentsLoadError = '';
  
  // Dữ liệu bộ lọc và tìm kiếm (Two-way binding)
  searchKeyword: string = '';
  filterType: string = '';
  filterStatus: string = '';
  selectedComment: any = null;
  // Dữ liệu trả lời bình luận / đánh giá
  selectedReplyTarget: CommentItem | null = null;
  replyContent: string = '';
  isReplyModalOpen = false;
  isSavingReply = false;
  replySaveError = '';

  // Phân trang
  currentReviewPage: number = 1;
  currentBlogPage: number = 1;
  readonly ITEMS_PER_PAGE: number = 4;

  // Bản đồ trạng thái hiển thị
  statusMap: { [key: string]: { text: string; class: string } } = {
    'normal': {
      text: 'Bình thường',
      class: 'badge-status-approved'
    },
    'flagged': {
      text: 'Vi phạm tiêu chuẩn cộng đồng',
      class: 'badge-status-flagged'
    }
  };

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadComments();
    }
  }

  loadComments(): void {
    this.isLoading = true;
    this.commentsLoadError = '';
    const errors: string[] = [];

    forkJoin({
      comments: this.adminApi.getComments().pipe(
        catchError((error: unknown) => {
          console.error('Lỗi tải bình luận blog từ MongoDB:', error);
          errors.push(this.getLoadErrorMessage(error, 'bình luận blog'));
          return of(null);
        })
      ),
      reviews: this.adminApi.getAdminReviews().pipe(
        catchError((error: unknown) => {
          console.error('Lỗi tải đánh giá sản phẩm từ MongoDB:', error);
          errors.push(this.getLoadErrorMessage(error, 'đánh giá sản phẩm'));
          return of(null);
        })
      )
    }).subscribe(({ comments, reviews }) => {
      const loadedComments: CommentItem[] = [];
      if (Array.isArray(comments)) {
        loadedComments.push(...comments.map((comment) => this.toCommentItem(comment)));
      } else if (comments !== null) {
        errors.push('Máy chủ trả về danh sách bình luận không hợp lệ.');
        console.error('API bình luận trả về dữ liệu không hợp lệ:', comments);
      }

      if (Array.isArray(reviews)) {
        loadedComments.push(...reviews.map((review) => this.toReviewItem(review)));
      } else if (reviews !== null) {
        errors.push('Máy chủ trả về danh sách đánh giá không hợp lệ.');
        console.error('API đánh giá trả về dữ liệu không hợp lệ:', reviews);
      }

      this.allComments = loadedComments;
      this.commentsLoadError = errors.join(' ');
      this.currentReviewPage = 1;
      this.currentBlogPage = 1;
      this.isLoading = false;
      this.changeDetectorRef.markForCheck();
    });
  }

  private getLoadErrorMessage(error: unknown, resource: string): string {
    return error instanceof TimeoutError
      ? `Máy chủ không phản hồi sau 8 giây khi tải ${resource}. Hãy kiểm tra backend tại localhost:3002 rồi thử tải lại.`
      : `Không thể tải ${resource}. Hãy kiểm tra kết nối backend rồi thử tải lại.`;
  }

  private toCommentItem(comment: AdminComment): CommentItem {
    const authorName = comment.author || 'Người dùng';

    return {
      id: String(comment.id),
      content: comment.content || '',
      targetName: `Bài viết #${comment.blogId}`,
      targetType: 'blog',
      authorName,
      authorAvatar: comment.avatar || 'images/avatar-non.jpg',
      date: comment.time || comment.createdAt || '',
      rating: undefined,
      status: 'normal',
      ...this.getReplyState(comment.replies)
    };
  }

  private toReviewItem(review: AdminReview): CommentItem {
    return {
      id: `review:${review.id}`,
      content: review.content || '',
      targetName: review.productName || `Sản phẩm #${review.productId}`,
      targetType: 'product',
      authorName: review.userName || 'Khách hàng',
      authorAvatar: review.userAvatar || 'images/avatar-non.jpg',
      date: review.createdAt || '',
      rating: review.rating,
      status: 'normal',
      ...this.getReplyState(review.replies)
    };
  }

  private getReplyState(replies: any[] | undefined): Pick<CommentItem, 'reply' | 'replyStatus' | 'replies'> {
    const savedReplies = Array.isArray(replies) ? replies : [];
    const latestAdminReply = [...savedReplies].reverse().find(reply => reply.role === 'admin');

    return {
      replies: savedReplies,
      reply: latestAdminReply?.content || '',
      replyStatus: latestAdminReply ? 'replied' : 'unanswered'
    };
  }

  getAuthorAvatarUrl(avatar: string): string {
    if (avatar.startsWith('http://') || avatar.startsWith('https://') || avatar.startsWith('data:')) {
      return avatar;
    }
    return this.adminApi.getLibraryMapImageUrl(avatar || 'images/avatar-non.jpg');
  }

  onAuthorAvatarError(event: Event): void {
    const image = event.target as HTMLImageElement;
    const fallbackUrl = this.getAuthorAvatarUrl('images/avatar-non.jpg');
    if (image.src !== fallbackUrl) {
      image.src = fallbackUrl;
    }
  }

  // Thống kê số lượng
  get totalCount(): number {
    return this.allComments.length;
  }

  get approvedCount(): number {
    return this.allComments.filter(c => c.status === 'normal').length;
  }

  get pendingCount(): number {
    return this.allComments.filter(c => c.replyStatus === 'unanswered').length;
  }

  get flaggedCount(): number {
    return this.allComments.filter(c => c.status === 'flagged').length;
  }

  // Lọc dữ liệu cho Bảng 1 (Sản phẩm & Đơn hàng)
  getFilteredReviews(): CommentItem[] {
    let reviews = this.allComments.filter(c => c.targetType === 'product' || c.targetType === 'order');
    return this.applyCommonFilters(reviews);
  }

  // Lọc dữ liệu cho Bảng 2 (Blog)
  getFilteredBlogs(): CommentItem[] {
    let blogs = this.allComments.filter(c => c.targetType === 'blog');
    return this.applyCommonFilters(blogs);
  }

  private normalizeText(value: any): string {
    return String(value || '')
      .normalize('NFC')
      .toLocaleLowerCase('vi-VN')
      .trim();
  }

  private applyCommonFilters(list: CommentItem[]): CommentItem[] {
    const keyword = this.normalizeText(this.searchKeyword);

    if (keyword) {
      list = list.filter(c => {
        const searchableFields = [
          c.id,
          c.content,
          c.authorName,
          c.targetName,
          c.targetType
        ];

        return searchableFields.some(field =>
          this.normalizeText(field).includes(keyword)
        );
      });
    }

    if (this.filterType) {
      list = list.filter(c => c.targetType === this.filterType);
    }

    if (this.filterStatus) {
      list = list.filter(c => {
        if (this.filterStatus === 'normal' ||
            this.filterStatus === 'flagged') {
          return c.status === this.filterStatus;
        }

        if (this.filterStatus === 'replied' ||
            this.filterStatus === 'unanswered') {
          return c.replyStatus === this.filterStatus;
        }

        return true;
      });
    }

    return list;
  }

  // Phân trang cho Reviews
  getPaginatedReviews(): CommentItem[] {
    const list = this.getFilteredReviews();
    const start = (this.currentReviewPage - 1) * this.ITEMS_PER_PAGE;
    return list.slice(start, start + this.ITEMS_PER_PAGE);
  }

  getReviewTotalPages(): number {
    return Math.ceil(this.getFilteredReviews().length / this.ITEMS_PER_PAGE) || 1;
  }

  // Phân trang cho Blogs
  getPaginatedBlogs(): CommentItem[] {
    const list = this.getFilteredBlogs();
    const start = (this.currentBlogPage - 1) * this.ITEMS_PER_PAGE;
    return list.slice(start, start + this.ITEMS_PER_PAGE);
  }

  getBlogTotalPages(): number {
    return Math.ceil(this.getFilteredBlogs().length / this.ITEMS_PER_PAGE) || 1;
  }

  onFilterClick() {
    this.currentReviewPage = 1;
    this.currentBlogPage = 1;
  }

  // Hàm mở modal chi tiết bình luận khi ấn vào icon con mắt
  viewCommentDetail(comment: any): void {
    this.selectedComment = comment;
    const modalElement = document.getElementById('commentDetailModal');
    if (modalElement) {
      // @ts-ignore
      const modal = new bootstrap.Modal(modalElement);
      modal.show();
    }
  }
  // Mở modal trả lời
  openReplyModal(comment: CommentItem): void {
    this.selectedReplyTarget = comment;
    this.replyContent = '';
    this.replySaveError = '';
    this.isReplyModalOpen = true;
  }

  // Đóng modal trả lời
  closeReplyModal(): void {
    this.isReplyModalOpen = false;
    this.selectedReplyTarget = null;
    this.replyContent = '';
    this.replySaveError = '';
  }

  // Lưu câu trả lời
  saveReply(): void {
    if (!this.selectedReplyTarget || this.isSavingReply) return;

    const content = this.replyContent.trim();

    if (!content) {
      alert('Vui lòng nhập nội dung trả lời.');
      return;
    }

    const target = this.selectedReplyTarget;
    const replyRequest = target.targetType === 'blog'
      ? this.adminApi.replyToComment(target.id, content)
      : this.adminApi.replyToReview(target.id.replace(/^review:/, ''), content);

    this.isSavingReply = true;
    this.replySaveError = '';
    replyRequest.subscribe({
      next: (response: any) => {
        const savedReplies = Array.isArray(response?.replies)
          ? response.replies
          : [...(target.replies || []), { content, role: 'admin' }];
        Object.assign(target, this.getReplyState(savedReplies));
        this.isSavingReply = false;
        this.changeDetectorRef.markForCheck();
        this.closeReplyModal();
        this.loadComments();
      },
      error: (error: unknown) => {
        console.error('Lỗi lưu câu trả lời lên MongoDB:', error);
        this.replySaveError = 'Không thể lưu câu trả lời. Vui lòng kiểm tra kết nối hoặc quyền đăng nhập rồi thử lại.';
        this.isSavingReply = false;
        this.changeDetectorRef.markForCheck();
      }
    });
  }
  // Từ khóa cảnh báo nội dung cần kiểm tra
  private readonly sensitiveKeywords: string[] = [
    'địt', 'đụ', 'đéo', 'lồn', 'cặc',
    'đĩ', 'chó chết', 'con chó', 'ngu',
    'mẹ mày', 'đồ khốn'
  ];

  // Kiểm tra nội dung có chứa từ khóa cảnh báo không
  private containsSensitiveKeyword(content: string): boolean {
    const normalizedContent = content.toLowerCase();

    return this.sensitiveKeywords.some(keyword =>
      normalizedContent.includes(keyword)
    );
  }

  changeStatus(id: string, newStatus: 'normal' | 'flagged'): void {
    const comment = this.allComments.find(c => c.id === id);

    if (comment) {
      comment.status = newStatus;
    }
  }
  deleteComment(id: string) {
    if (confirm('Bạn có chắc chắn muốn xóa bình luận này?')) {
      this.allComments = this.allComments.filter(c => c.id !== id);
    }
  }
  changeReviewPage(page: number) {
    if (page >= 1 && page <= this.getReviewTotalPages()) {
      this.currentReviewPage = page;
    }
  }
  

  changeBlogPage(page: number) {
    if (page >= 1 && page <= this.getBlogTotalPages()) {
      this.currentBlogPage = page;
    }
  }

  mathMin(a: number, b: number): number {
    return Math.min(a, b);
  }
}