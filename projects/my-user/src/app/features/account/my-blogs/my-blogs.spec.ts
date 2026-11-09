import '@angular/compiler';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { BlogPost, BlogService } from '../../../core/services/blog.service';
import { ToastService } from '../../../core/services/toast.service';
import { MyBlogsComponent } from './my-blogs';

describe('MyBlogsComponent', () => {
  let fixture: ComponentFixture<MyBlogsComponent>;
  let component: MyBlogsComponent;
  let httpTestingController: HttpTestingController;
  let getBlogsByUser: ReturnType<typeof vi.fn>;
  let deleteBlog: ReturnType<typeof vi.fn>;
  let toastService: ToastService;

  beforeEach(async () => {
    localStorage.clear();
    getBlogsByUser = vi.fn(() => of([createBlog('published-post')]));
    deleteBlog = vi.fn(() => of({ message: 'Đã xóa bài viết.' }));
    await TestBed.configureTestingModule({
      imports: [MyBlogsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: BlogService, useValue: { getBlogsByUser, deleteBlog } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MyBlogsComponent);
    component = fixture.componentInstance;
    httpTestingController = TestBed.inject(HttpTestingController);
    toastService = TestBed.inject(ToastService);
  });

  afterEach(() => {
    httpTestingController.verify();
    localStorage.clear();
  });

  it('shows this user published posts and the saved local draft', () => {
    localStorage.setItem('authToken', 'user-token');
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('blogDraft', JSON.stringify({
      title: 'Bản nháp của tôi',
      category: 'huong-dan-diy',
      content: '<p>Nội dung đang viết</p>',
      imagePreviewUrls: [],
    }));

    fixture.detectChanges();
    httpTestingController.expectOne('/api/auth/me').flush({ id: 'user-id' });
    fixture.detectChanges();

    expect(getBlogsByUser).toHaveBeenCalledWith('user-token', 'user-id');
    expect(component.publishedBlogs.map((blog) => blog.slug)).toEqual(['published-post']);
    expect(component.draft?.title).toBe('Bản nháp của tôi');
    expect(fixture.nativeElement.textContent).toContain('Bài viết của tôi');
    expect(fixture.nativeElement.textContent).toContain('Bản nháp của tôi');
    expect(fixture.nativeElement.textContent).toContain('published-post');
  });

  it('allows user to delete a published blog', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const toastSpy = vi.spyOn(toastService, 'show');

    localStorage.setItem('authToken', 'user-token');
    localStorage.setItem('isLoggedIn', 'true');

    fixture.detectChanges();
    httpTestingController.expectOne('/api/auth/me').flush({ id: 'user-id' });
    fixture.detectChanges();

    const blogToDelete = component.publishedBlogs[0];
    const deleteBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.my-blog-delete-btn');
    expect(deleteBtn).toBeTruthy();

    deleteBtn.click();
    fixture.detectChanges();

    expect(deleteBlog).toHaveBeenCalledWith(blogToDelete.id, 'user-token');
    expect(component.publishedBlogs.length).toBe(0);
    expect(toastSpy).toHaveBeenCalledWith(`Đã xóa bài viết "${blogToDelete.title}".`, 'success');
  });

  it('allows user to delete local draft', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const toastSpy = vi.spyOn(toastService, 'show');

    localStorage.setItem('authToken', 'user-token');
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('blogDraft', JSON.stringify({
      title: 'Bản nháp',
      category: 'huong-dan-diy',
      content: 'Nội dung',
      imagePreviewUrls: [],
    }));

    fixture.detectChanges();
    httpTestingController.expectOne('/api/auth/me').flush({ id: 'user-id' });
    fixture.detectChanges();

    const draftSection = fixture.nativeElement.querySelector('.my-blog-card--draft');
    const deleteDraftBtn: HTMLButtonElement = draftSection.querySelector('.my-blog-delete-btn');
    expect(deleteDraftBtn).toBeTruthy();

    deleteDraftBtn.click();
    fixture.detectChanges();

    expect(component.draft).toBeNull();
    expect(localStorage.getItem('blogDraft')).toBeNull();
    expect(toastSpy).toHaveBeenCalledWith('Đã xóa bản nháp thành công.', 'success');
  });

  it('asks visitors to sign in without requesting private posts', () => {
    fixture.detectChanges();

    expect(component.authRequired).toBe(true);
    expect(getBlogsByUser).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Vui lòng đăng nhập');
  });
});

function createBlog(slug: string): BlogPost {
  return {
    id: slug,
    slug,
    title: slug,
    summary: '',
    excerpt: '',
    content: '',
    author: 'Người dùng',
    avatar: '',
    date: '2026-11-05',
    image: 'assets/gallery_assets/mau-ca-heo.webp',
    userId: 'user-id',
    category: 'Hướng dẫn DIY',
    categorySlug: 'huong-dan-diy',
    likes: 0,
    comments: 0,
    views: 0,
    isFeatured: false,
    tags: [],
  };
}
