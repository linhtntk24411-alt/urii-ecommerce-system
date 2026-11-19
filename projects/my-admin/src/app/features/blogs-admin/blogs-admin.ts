import { afterNextRender, Component, OnInit, ChangeDetectorRef, DestroyRef, HostListener, Injector, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  AdminApiService,
  AdminBlog,
  apiErrorMessage
} from '../../core/services/admin-api.service';
import { AdminSocketService } from '../../core/services/admin-socket.service';

declare var bootstrap: any;

type BlogStatus = 'pending' | 'approved' | 'violated';

interface BlogAdminItem extends Omit<AdminBlog, 'author'> {
  author: { name: string; avatar?: string };
  thumbnail: string;
  status: BlogStatus;
  visible: boolean;
}

@Component({
  selector: 'app-blogs-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './blogs-admin.html',
  styleUrls: ['./blogs-admin.css']
})
export class BlogsAdmin implements OnInit {
  private readonly socket = inject(AdminSocketService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  blogs: BlogAdminItem[] = [];
  loadingBlogs = false;
  blogsError = '';
  
  currentPage: number = 1;
  ITEMS_PER_PAGE: number = 4;

  // Bộ lọc
  searchQuery: string = '';
  selectedStatus: string = '';
  selectedAuthor: string = '';

  // Form tạo / chỉnh sửa bài viết
  editingBlogId: number | string | null = null;
  newTitle: string = '';
  newAuthor: string = '';
  newContent: string = '';
  newStatus: BlogStatus = 'approved';
  previewThumbnail: string | null = null;
  savingBlog = false;
  createError = '';
  createSuccess = '';
  activeDropdownId: string | null = null;
  private selectedImage: File | null = null;
  private uploadedImage: string | null = null;
  private imageError = '';
  private createSlug = '';
  // Biến lưu thông tin bài viết đang xem chi tiết
  selectedBlog: BlogAdminItem | null = null;

  toggleDropdown(id: number | string | undefined, event: Event): void {
    event.stopPropagation();
    const key = String(id ?? '');
    this.activeDropdownId = this.activeDropdownId === key ? null : key;
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.activeDropdownId = null;
  }

  constructor(
    private cdr: ChangeDetectorRef,
    private adminApiService: AdminApiService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.loadingBlogs = true;
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.targetLookup?.unsubscribe();
      ++this.targetVersion;
      this.targetLoading = false;
      this.pendingSearchId = params.get('searchType') === 'blog'
        ? params.get('searchId')
        : null;
      this.pendingSearchSlug = this.pendingSearchId ? params.get('searchSlug') : null;
      if (!this.matchesBlogId(this.linkedBlog, this.pendingSearchId)) this.linkedBlog = undefined;
      this.applySearchTarget();
    });
    this.loadBlogsFromCloud();
    this.socket.onCrudChange('blogs').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(event => {
      if (event.action === 'deleted' && this.matchesBlogId(this.linkedBlog, String(event.id))) this.linkedBlog = undefined;
      void this.loadBlogsFromCloud();
    });
  }
  private pendingSearchId: string | null = null;
  private pendingSearchSlug: string | null = null;
  private targetLoading = false;
  private targetVersion = 0;
  private targetLookup?: Subscription;
  private linkedBlog?: BlogAdminItem;
  showDeleteConfirm = false;
  deletingBlogId: number | string | null = null;
  deletingBlogTitle = '';

  async loadBlogsFromCloud(): Promise<void> {
    this.loadingBlogs = true;
    this.blogsError = '';

    try {
      const blogs = await this.adminApiService.getBlogsForAdmin();
      if (this.destroyRef.destroyed) return;
      this.blogs = blogs.map((blog) => this.toBlogAdminItem(blog));
      if (this.linkedBlog && !this.blogs.some(item => item.id === this.linkedBlog?.id)) this.blogs.push(this.linkedBlog);
    } catch (error) {
      this.blogsError = apiErrorMessage(error, 'Không thể tải danh sách bài viết.');
      console.error('Lỗi tải bài viết:', error);
    } finally {
      if (!this.destroyRef.destroyed) {
        this.loadingBlogs = false;
        this.applySearchTarget();
        this.cdr.markForCheck();
      }
    }
  }

  private toBlogAdminItem(blog: AdminBlog): BlogAdminItem {
    const rawStatus = blog.status ?? blog.approvalStatus;
    const status: BlogStatus =
      rawStatus === 'pending'
        ? 'pending'
        : rawStatus === 'rejected' || rawStatus === 'violated'
          ? 'violated'
          : 'approved';

    return {
      ...blog,
      date: blog.date || (blog.createdAt
        ? new Date(blog.createdAt).toLocaleDateString('vi-VN')
        : 'Chưa có ngày đăng'),
      thumbnail: blog.thumbnail || blog.image || '',
      author: {
        name: blog.author || 'Không rõ tác giả',
        avatar: blog.avatar
      },
      status,
      visible: blog.visible ?? true
    };
  }

  get totalBlogs(): number {
    return this.blogs.length;
  }

  get approvedCount(): number {
    return this.blogs.filter(b => b.status === 'approved').length;
  }

  get pendingCount(): number {
    return this.blogs.filter(b => b.status === 'pending').length;
  }

  get violatedCount(): number {
    return this.blogs.filter(b => b.status === 'violated').length;
  }

  get authorsList(): string[] {
    return [...new Set(this.blogs.map(b => b.author.name))];
  }

  get filteredBlogs(): BlogAdminItem[] {
    const q = this.searchQuery.trim().toLowerCase();
    return this.blogs.filter(b => {
      const matchSearch = !q ||
        String(b.title || '').toLowerCase().includes(q) ||
        String(b.author?.name || '').toLowerCase().includes(q) ||
        String(b.content || '').toLowerCase().includes(q) ||
        String(b.excerpt || '').toLowerCase().includes(q) ||
        String(b.category || '').toLowerCase().includes(q);
      const matchStatus = this.selectedStatus === '' || b.status === this.selectedStatus;
      const matchAuthor = this.selectedAuthor === '' || b.author.name === this.selectedAuthor;
      return matchSearch && matchStatus && matchAuthor;
    });
  }

  get totalPages(): number {
    return Math.ceil(this.filteredBlogs.length / this.ITEMS_PER_PAGE) || 1;
  }

  get paginatedBlogs(): BlogAdminItem[] {
    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages || 1;
    }
    const start = (this.currentPage - 1) * this.ITEMS_PER_PAGE;
    return this.filteredBlogs.slice(start, start + this.ITEMS_PER_PAGE);
  }

  get paginationRange(): number[] {
    const pages = [];
    for (let i = 1; i <= this.totalPages; i++) {
      pages.push(i);
    }
    return pages;
  }

  get pendingBlogs(): any[] {
    return this.blogs.filter(b => b.status === 'pending');
  }

  changePage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }

  searchTargetId(id: string | number | undefined | null): string {
    return `admin-search-target-blog-${encodeURIComponent(String(id ?? ''))}`;
  }

  private matchesBlogId(blog: Pick<AdminBlog, 'id' | '_id'> | undefined, id: string | null): boolean {
    return !!blog && !!id && (String(blog.id) === id || blog._id === id);
  }

  private loadSearchBlog(id: string, slug: string): void {
    this.targetLoading = true;
    const version = this.targetVersion;
    this.targetLookup = this.adminApiService.getBlogBySlug(slug).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: blog => {
        if (version !== this.targetVersion) return;
        this.targetLoading = false;
        if (!this.matchesBlogId(blog, id)) {
          this.finishBlogSearch('Không tìm thấy bài viết được liên kết.');
          return;
        }
        const item = this.toBlogAdminItem(blog);
        this.linkedBlog = item;
        if (!this.blogs.some(existing => existing.id === item.id)) this.blogs = [...this.blogs, item];
        this.applySearchTarget();
      },
      error: error => {
        if (version === this.targetVersion) this.finishBlogSearch(apiErrorMessage(error, 'Không thể mở bài viết được liên kết.'));
      },
    });
  }

  private finishBlogSearch(error = ''): void {
    this.pendingSearchId = null;
    this.targetLoading = false;
    if (error) this.blogsError = error;
    this.cdr.markForCheck();
  }

  private applySearchTarget(): void {
    const id = this.pendingSearchId;
    if (!id || this.loadingBlogs || this.targetLoading) return;

    this.searchQuery = '';
    this.selectedStatus = '';
    this.selectedAuthor = '';
    const list = this.filteredBlogs;
    const targetIndex = list.findIndex(blog => this.matchesBlogId(blog, id));
    if (targetIndex === -1) {
      if (this.pendingSearchSlug) this.loadSearchBlog(id, this.pendingSearchSlug);
      return;
    }

    const target = list[targetIndex];
    this.currentPage = Math.floor(targetIndex / this.ITEMS_PER_PAGE) + 1;
    const targetElementId = this.searchTargetId(target.id || target._id);
    const version = this.targetVersion;
    this.targetLoading = true;
    afterNextRender(() => {
      if (version !== this.targetVersion) return;
      const row = document.getElementById(targetElementId);
      if (!row) {
        this.finishBlogSearch('Không thể định vị bài viết trên bảng.');
        return;
      }
      this.finishBlogSearch();
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const cells = Array.from(row.querySelectorAll<HTMLElement>('td, th'));
      const originalStyles = cells.map(cell => ({
        backgroundColor: cell.style.getPropertyValue('background-color'),
        backgroundPriority: cell.style.getPropertyPriority('background-color')
      }));

      cells.forEach(cell => {
        cell.style.setProperty('background-color', '#fffbea', 'important');
      });

      window.setTimeout(() => {
        cells.forEach((cell, index) => {
          const original = originalStyles[index];
          if (original.backgroundColor) {
            cell.style.setProperty('background-color', original.backgroundColor, original.backgroundPriority);
          } else {
            cell.style.removeProperty('background-color');
          }
        });
      }, 3000);
    }, { injector: this.injector });
    this.cdr.markForCheck();
  }

  onFilterChange(): void {
    this.currentPage = 1;
  }

  // Duyệt bài viết
  approveBlog(id: number | string | undefined): void {
    if (id === undefined) return;
    this.changeStatus(id, 'approved');
  }

  // Từ chối / Vi phạm bài viết
  rejectBlog(id: number | string | undefined): void {
    if (id === undefined) return;
    this.changeStatus(id, 'violated');
  }

  // Xóa bài viết
  deleteBlog(id: number | string | undefined): void {
    if (id === undefined) return;
    const blog = this.blogs.find(item => String(item.id) === String(id) || String(item._id) === String(id));
    this.deletingBlogId = blog?._id || blog?.id || id;
    this.deletingBlogTitle = blog?.title || 'bài viết này';
    this.showDeleteConfirm = true;
  }

  closeDeleteConfirm(): void {
    this.showDeleteConfirm = false;
    this.deletingBlogId = null;
    this.deletingBlogTitle = '';
  }

  confirmDeleteBlog(): void {
    const id = this.deletingBlogId;
    if (id === null) return;

    this.adminApiService.deleteBlog(id)
      .then(() => {
        if (this.matchesBlogId(this.linkedBlog, String(id))) this.linkedBlog = undefined;
        this.createSuccess = 'Đã xóa bài viết thành công.';
        return this.loadBlogsFromCloud();
      })
      .catch(err => console.error('Lỗi xóa blog qua API:', err));

    this.blogs = this.blogs.filter(blog => String(blog.id) !== String(id) && String(blog._id) !== String(id));
    this.closeDeleteConfirm();
    this.cdr.detectChanges();
  }

  // Thay đổi trạng thái qua Dropdown
  changeStatus(id: number | string | undefined, newStatus: BlogStatus): void {
    if (id === undefined) return;
    const blog = this.blogs.find(b => String(b.id) === String(id) || String(b._id) === String(id));
    this.activeDropdownId = null;
    if (blog) {
      blog.status = newStatus;
      if (this.selectedBlog && (String(this.selectedBlog.id) === String(id) || String(this.selectedBlog._id) === String(id))) {
        this.selectedBlog.status = newStatus;
      }
      const targetId = blog._id || blog.id;
      this.adminApiService.updateBlog(targetId, { status: newStatus, approvalStatus: newStatus })
        .then((updated) => {
          if (updated) {
            Object.assign(blog, this.toBlogAdminItem({ ...blog, ...updated, author: updated.author || blog.author.name, status: newStatus }));
          }
          this.createSuccess = 'Đã cập nhật trạng thái bài viết.';
          this.cdr.detectChanges();
        })
        .catch(err => {
          console.error('Lỗi cập nhật trạng thái blog qua API:', err);
          this.blogsError = apiErrorMessage(err, 'Không thể cập nhật trạng thái bài viết.');
          this.cdr.detectChanges();
        });
      this.cdr.detectChanges();
    }
  }

  openCreateModal(): void {
    if (this.savingBlog) return;
    this.editingBlogId = null;
    this.newTitle = '';
    this.newAuthor = '';
    this.newContent = '';
    this.newStatus = 'approved';
    this.previewThumbnail = null;
    this.selectedImage = null;
    this.uploadedImage = null;
    this.imageError = '';
    this.createError = '';
    this.createSuccess = '';
    this.createSlug = '';
    const input = document.getElementById('blog-image-file') as HTMLInputElement | null;
    if (input) input.value = '';
    const modalElement = document.getElementById('createBlogModal');
    if (modalElement) {
      const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
      modal.show();
    }
  }

  openEditModal(blog: BlogAdminItem): void {
    if (this.savingBlog) return;
    this.activeDropdownId = null;
    this.editingBlogId = blog._id || blog.id;
    this.newTitle = blog.title || '';
    this.newAuthor = blog.author?.name || '';
    this.newContent = blog.content || blog.excerpt || '';
    this.newStatus = blog.status || 'approved';
    this.previewThumbnail = blog.thumbnail ? this.formatImagePath(blog.thumbnail) : null;
    this.selectedImage = null;
    this.uploadedImage = blog.thumbnail || blog.image || null;
    this.imageError = '';
    this.createError = '';
    this.createSuccess = '';
    this.createSlug = blog.slug || '';
    const input = document.getElementById('blog-image-file') as HTMLInputElement | null;
    if (input) input.value = '';
    const detailModalEl = document.getElementById('blogDetailModal');
    if (detailModalEl) {
      bootstrap.Modal.getInstance(detailModalEl)?.hide();
    }
    const modalElement = document.getElementById('createBlogModal');
    if (modalElement) {
      const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
      modal.show();
    }
  }

  // Mở modal xem chi tiết bài viết
  viewBlogDetail(blog: BlogAdminItem): void {
    this.selectedBlog = blog;
    const modalElement = document.getElementById('blogDetailModal');
    if (modalElement) {
      // @ts-ignore
      const modal = new bootstrap.Modal(modalElement);
      modal.show();
    }
  }

  onFileSelected(event: Event): void {
    if (this.savingBlog) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.selectedImage = null;
    this.uploadedImage = null;
    this.previewThumbnail = null;
    this.imageError = '';
    this.createError = '';
    if (file) {
      if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(file.type) ||
          file.size === 0 || file.size > 8 * 1024 * 1024) {
        this.imageError = 'Chỉ nhận PNG, JPG, WEBP, GIF lớn hơn 0 và tối đa 8 MB.';
        this.createError = this.imageError;
        input.value = '';
        return;
      }
      this.selectedImage = file;
      const reader = new FileReader();
      reader.onload = () => {
        if (this.selectedImage !== file) return;
        this.previewThumbnail = typeof reader.result === 'string' ? reader.result : null;
        this.cdr.detectChanges();
      };
      reader.onerror = () => {
        if (this.selectedImage !== file) return;
        this.imageError = 'Không thể đọc ảnh. Vui lòng chọn lại.';
        this.createError = this.imageError;
        this.cdr.markForCheck();
      };
      reader.readAsDataURL(file);
    }
  }

  // Tạo hoặc cập nhật bài viết
  async submitNewBlog(): Promise<void> {
    if (this.savingBlog) return;
    this.createError = '';
    this.createSuccess = '';
    if (!this.newTitle.trim() || !this.newAuthor.trim() || !this.newContent.trim()) {
      this.createError = 'Vui lòng điền đầy đủ Tiêu đề, Tác giả và Nội dung.';
      return;
    }
    if (this.imageError) {
      this.createError = this.imageError;
      return;
    }
    this.savingBlog = true;
    let uploading = false;
    try {
      let imagePath = this.uploadedImage || 'https://picsum.photos/seed/blog/100/100';
      if (this.selectedImage) {
        uploading = true;
        this.uploadedImage = await firstValueFrom(this.adminApiService.uploadProductImage(this.selectedImage));
        imagePath = this.uploadedImage;
        uploading = false;
      }

      if (this.editingBlogId !== null) {
        const updatePayload = {
          title: this.newTitle.trim(),
          author: this.newAuthor.trim(),
          content: this.newContent.trim(),
          image: imagePath,
          thumbnail: imagePath,
          status: this.newStatus,
          approvalStatus: this.newStatus
        };
        const updated = await this.adminApiService.updateBlog(this.editingBlogId, updatePayload);
        if (this.matchesBlogId(this.linkedBlog, String(this.editingBlogId))) this.linkedBlog = this.toBlogAdminItem(updated);
        this.createSuccess = 'Đã cập nhật bài viết thành công.';
      } else {
        const newBlog = {
          title: this.newTitle.trim(),
          slug: this.createSlug || (this.createSlug = `blog-${Date.now()}`),
          date: new Date().toLocaleDateString('vi-VN'),
          image: imagePath,
          thumbnail: imagePath,
          author: this.newAuthor.trim(),
          avatar: 'https://i.pravatar.cc/150?u=1',
          category: 'Mẹo vặt',
          content: this.newContent.trim(),
          status: this.newStatus,
          approvalStatus: this.newStatus
        };
        await this.adminApiService.createBlog(newBlog);
        this.createSuccess = 'Đã tạo bài viết thành công.';
      }

      const modalElement = document.getElementById('createBlogModal');
      if (modalElement) bootstrap.Modal.getInstance(modalElement)?.hide();
      await this.loadBlogsFromCloud();
    } catch (error) {
      this.createError = apiErrorMessage(
        error,
        uploading
          ? 'Không thể tải ảnh lên.'
          : (this.editingBlogId !== null ? 'Không thể cập nhật bài viết.' : 'Không thể tạo bài viết.')
      );
    } finally {
      this.savingBlog = false;
      this.cdr.detectChanges();
    }
  }

  formatImagePath(path: string | null | undefined): string {
    if (!path) return '';
    if (path.startsWith('http') || path.startsWith('data:')) {
      return path;
    }

    const normalizedPath = path.replace(/^(\.\.\/)?assets\//, '../../user/assets/');
    if (normalizedPath.startsWith('../../user/assets/')) {
      return normalizedPath;
    }

    return this.adminApiService.getLibraryMapImageUrl(normalizedPath);
  }
}
