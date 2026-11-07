import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { BlogPost, BlogService } from '../../../core/services/blog.service';
import { MyBlogsComponent } from './my-blogs';

describe('MyBlogsComponent', () => {
  let fixture: ComponentFixture<MyBlogsComponent>;
  let component: MyBlogsComponent;
  let httpTestingController: HttpTestingController;
  let getBlogsByUser: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    localStorage.clear();
    getBlogsByUser = vi.fn(() => of([createBlog('published-post')]));
    await TestBed.configureTestingModule({
      imports: [MyBlogsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: BlogService, useValue: { getBlogsByUser } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MyBlogsComponent);
    component = fixture.componentInstance;
    httpTestingController = TestBed.inject(HttpTestingController);
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
