import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AdminApiService,
  AdminBlog,
  apiErrorMessage
} from '../../core/services/admin-api.service';

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
  // Biến lưu thông tin bài viết đang xem chi tiết
  selectedBlog: BlogAdminItem | null = null;

  constructor(
    private cdr: ChangeDetectorRef,
    private adminApiService: AdminApiService
  ) {}

  ngOnInit(): void {
    this.loadBlogsFromCloud();
  }

  async loadBlogsFromCloud(): Promise<void> {
    this.loadingBlogs = true;
    this.blogsError = '';

    try {
      const blogs = await this.adminApiService.getBlogs();
      this.blogs = blogs.map((blog) => this.toBlogAdminItem(blog));
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

  onFilterChange(): void {
    this.currentPage = 1;
  }

  // Duyệt bài viết
  approveBlog(id: number | string): void {
    const blog = this.blogs.find(b => b.id === id || b._id === id);
    if (blog) {
      blog.status = 'approved';
      // TODO: Gửi API cập nhật trạng thái lên MongoDB Cloud ở đây
      this.cdr.detectChanges();
    }
  }

  // Từ chối / Vi phạm bài viết
  rejectBlog(id: number | string): void {
    const blog = this.blogs.find(b => b.id === id || b._id === id);
    if (blog) {
      blog.status = 'violated';
      // TODO: Gửi API cập nhật trạng thái lên MongoDB Cloud ở đây
      this.cdr.detectChanges();
    }
  }

  // Xóa bài viết
  deleteBlog(id: number | string): void {
    if (confirm("Bạn có chắc chắn muốn xóa bài viết này?")) {
      this.blogs = this.blogs.filter(b => b.id !== id && b._id !== id);
      // TODO: Gửi API xóa trên MongoDB Cloud ở đây
      this.cdr.detectChanges();
    }
  }

  // Thay đổi trạng thái qua Dropdown
  changeStatus(id: number | string, newStatus: BlogStatus): void {
    const blog = this.blogs.find(b => b.id === id || b._id === id);
    if (blog) {
      blog.status = newStatus;
      // TODO: Gửi API cập nhật trạng thái lên MongoDB Cloud ở đây
      this.cdr.detectChanges();
    }
  }

  openCreateModal(): void {
    this.newTitle = '';
    this.newAuthor = '';
    this.newContent = '';
    this.previewThumbnail = null;
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
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        this.previewThumbnail = typeof reader.result === 'string' ? reader.result : null;
        this.cdr.detectChanges();
      };
      reader.readAsDataURL(file);
    }
  }

  // Tạo bài viết mới
  submitNewBlog(): void {
    if (!this.newTitle.trim() || !this.newAuthor.trim() || !this.newContent.trim()) {
      alert("Vui lòng điền đầy đủ thông tin (Tiêu đề, Tác giả, Nội dung)");
      return;
    }

    const newBlog = {
      title: this.newTitle.trim(),
      slug: `blog-${Date.now()}`,
      date: new Date().toLocaleDateString('vi-VN'),
      thumbnail: this.previewThumbnail || 'https://picsum.photos/seed/blog/100/100',
      author: { name: this.newAuthor.trim(), avatar: 'https://i.pravatar.cc/150?u=1' },
      status: 'pending' as const,
      visible: true,
      content: this.newContent.trim()
    };

    // TODO: Gửi request POST lên MongoDB Cloud qua Service
    this.blogs.unshift({ id: Date.now(), ...newBlog });

    const modalElement = document.getElementById('createBlogModal');
    if (modalElement) {
      const modal = bootstrap.Modal.getInstance(modalElement);
      if (modal) modal.hide();
    }

    this.cdr.detectChanges();
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