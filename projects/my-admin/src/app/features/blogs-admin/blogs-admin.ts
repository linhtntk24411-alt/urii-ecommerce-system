import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
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

  blogs: BlogAdminItem[] = [];
  loadingBlogs = false;
  blogsError = '';
  
  currentPage: number = 1;
  ITEMS_PER_PAGE: number = 4;

  // Bộ lọc
  selectedStatus: string = '';
  selectedAuthor: string = '';

  // Form tạo bài viết mới
  newTitle: string = '';
  newAuthor: string = '';
  newContent: string = '';
  previewThumbnail: string | null = null;
  savingBlog = false;
  createError = '';
  createSuccess = '';
  private selectedImage: File | null = null;
  private uploadedImage: string | null = null;
  private imageError = '';
  private createSlug = '';
  // Biến lưu thông tin bài viết đang xem chi tiết
  selectedBlog: BlogAdminItem | null = null;

  constructor(
    private cdr: ChangeDetectorRef,
    private adminApiService: AdminApiService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(params => {
      this.pendingSearchId = params.get('searchType') === 'blog'
        ? params.get('searchId')
        : null;
      this.applySearchTarget();
    });
    this.loadBlogsFromCloud();
    this.socket.onCrudChange('blogs').subscribe(() => this.loadBlogsFromCloud());
  }
  private pendingSearchId: string | null = null;
  showDeleteConfirm = false;
  deletingBlogId: number | string | null = null;
  deletingBlogTitle = '';

  async loadBlogsFromCloud(): Promise<void> {
    this.loadingBlogs = true;
    this.blogsError = '';

    try {
      const blogs = await this.adminApiService.getBlogs();
      this.blogs = blogs.map((blog) => this.toBlogAdminItem(blog));
      this.applySearchTarget();
    } catch (error) {
      this.blogsError = apiErrorMessage(error, 'Không thể tải danh sách bài viết.');
      console.error('Lỗi tải bài viết:', error);
    } finally {
      this.loadingBlogs = false;
      this.cdr.detectChanges();
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
    return this.blogs.filter(b => {
      const matchStatus = this.selectedStatus === '' || b.status === this.selectedStatus;
      const matchAuthor = this.selectedAuthor === '' || b.author.name === this.selectedAuthor;
      return matchStatus && matchAuthor;
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

  private applySearchTarget(): void {
    const id = this.pendingSearchId;
    if (!id) return;

    this.selectedStatus = '';
    this.selectedAuthor = '';

    const targetIndex = this.blogs.findIndex(
      blog => String(blog._id || blog.id) === String(id)
    );

    if (targetIndex === -1) {
      return;
    }

    this.currentPage = Math.floor(targetIndex / this.ITEMS_PER_PAGE) + 1;
    this.cdr.detectChanges();

    const targetElementId = this.searchTargetId(id);
    this.pendingSearchId = null;

    window.setTimeout(() => {
      const row = document.getElementById(targetElementId);
      if (!row) {
        return;
      }

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
    });
  }

  onFilterChange(): void {
    this.currentPage = 1;
  }

  // Duyệt bài viết
  approveBlog(id: number | string): void {
    const blog = this.blogs.find(b => b.id === id || b._id === id);
    if (blog) {
      blog.status = 'approved';
      const targetId = blog._id || blog.id;
      this.adminApiService.updateBlog(targetId, { status: 'approved' })
        .then(() => this.loadBlogsFromCloud())
        .catch(err => console.error('Lỗi duyệt blog qua API:', err));
      this.cdr.detectChanges();
    }
  }

  // Từ chối / Vi phạm bài viết
  rejectBlog(id: number | string): void {
    const blog = this.blogs.find(b => b.id === id || b._id === id);
    if (blog) {
      blog.status = 'violated';
      const targetId = blog._id || blog.id;
      this.adminApiService.updateBlog(targetId, { status: 'violated' })
        .then(() => this.loadBlogsFromCloud())
        .catch(err => console.error('Lỗi từ chối blog qua API:', err));
      this.cdr.detectChanges();
    }
  }

  // Xóa bài viết
  deleteBlog(id: number | string): void {
    const blog = this.blogs.find(item => item.id === id || item._id === id);
    this.deletingBlogId = id;
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
      .then(() => this.loadBlogsFromCloud())
      .catch(err => console.error('Lỗi xóa blog qua API:', err));

    this.blogs = this.blogs.filter(blog => blog.id !== id && blog._id !== id);
    this.closeDeleteConfirm();
    this.cdr.detectChanges();
  }

  // Thay đổi trạng thái qua Dropdown
  changeStatus(id: number | string, newStatus: BlogStatus): void {
    const blog = this.blogs.find(b => b.id === id || b._id === id);
    if (blog) {
      blog.status = newStatus;
      const targetId = blog._id || blog.id;
      this.adminApiService.updateBlog(targetId, { status: newStatus })
        .then(() => this.loadBlogsFromCloud())
        .catch(err => console.error('Lỗi cập nhật trạng thái blog qua API:', err));
      this.cdr.detectChanges();
    }
  }

  openCreateModal(): void {
    if (this.savingBlog) return;
    this.newTitle = '';
    this.newAuthor = '';
    this.newContent = '';
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
      const modal = new bootstrap.Modal(modalElement);
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

  // Tạo bài viết mới
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
    const newBlog = {
      title: this.newTitle.trim(),
      slug: this.createSlug || (this.createSlug = `blog-${Date.now()}`),
      date: new Date().toLocaleDateString('vi-VN'),
      image: 'https://picsum.photos/seed/blog/100/100',
      author: this.newAuthor.trim(),
      avatar: 'https://i.pravatar.cc/150?u=1',
      category: 'Mẹo vặt',
      content: this.newContent.trim()
    };
    this.savingBlog = true;
    let uploading = false;
    try {
      if (this.selectedImage) {
        uploading = true;
        this.uploadedImage ||= await firstValueFrom(this.adminApiService.uploadProductImage(this.selectedImage));
        newBlog.image = this.uploadedImage;
        uploading = false;
      }
      await this.adminApiService.createBlog(newBlog);
      this.createSuccess = 'Đã tạo bài viết thành công.';
      const modalElement = document.getElementById('createBlogModal');
      if (modalElement) bootstrap.Modal.getInstance(modalElement)?.hide();
      await this.loadBlogsFromCloud();
    } catch (error) {
      this.createError = apiErrorMessage(error, uploading ? 'Không thể tải ảnh lên.' : 'Không thể tạo bài viết.');
    } finally {
      this.savingBlog = false;
      this.cdr.markForCheck();
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
