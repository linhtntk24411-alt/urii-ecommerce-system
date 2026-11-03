import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { BlogComment, BlogPost, BlogService } from '../../../core/services/blog.service';
import { BlogDetailComponent } from './blog-detail';

describe('BlogDetailComponent', () => {
  let component: BlogDetailComponent;
  let fixture: ComponentFixture<BlogDetailComponent>;
  const blog: BlogPost = {
    id: 1,
    slug: 'test-blog',
    title: 'Bài viết thử nghiệm',
    summary: '',
    excerpt: '',
    content: '<p>Nội dung</p>',
    author: 'Urii',
    avatar: '',
    date: '',
    image: '',
    category: 'Hướng dẫn DIY',
    categorySlug: 'huong-dan-diy',
    likes: 0,
    comments: 1,
    views: 0,
    isFeatured: false,
    tags: [],
  };
  const comment: BlogComment = {
    id: 1,
    blogId: 1,
    author: 'Người đọc',
    avatar: 'assets/avatar_user1.jpeg',
    content: 'Bài viết rất hữu ích!',
    createdAt: '2026-11-03T10:00:00.000Z',
    time: '1 giờ trước',
  };

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [BlogDetailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ slug: blog.slug })),
            queryParamMap: of(convertToParamMap({})),
          },
        },
        {
          provide: BlogService,
          useValue: {
            getBlogBySlug: () => of(blog),
            getBlogComments: () => of([comment]),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BlogDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load and render comments for the current blog', () => {
    expect(component.blogComments).toEqual([comment]);
    expect(fixture.nativeElement.textContent).toContain('Bài viết rất hữu ích!');
    expect(fixture.nativeElement.textContent).toContain('Bình luận (1)');
  });

  it('lets a signed-in user like and save the blog', () => {
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('userEmail', 'reader@example.com');
    window.dispatchEvent(new Event('auth:changed'));

    component.toggleLike();
    component.toggleBookmark();

    expect(component.isLiked).toBe(true);
    expect(component.displayedLikeCount).toBe(1);
    expect(localStorage.getItem('blogLikes:reader@example.com')).toBe('["1"]');
    expect(component.isBookmarked).toBe(true);
    expect(JSON.parse(localStorage.getItem('bookmarks') ?? '{}')).toEqual({ '1': true });

    component.toggleLike();
    component.toggleBookmark();

    expect(component.isLiked).toBe(false);
    expect(component.displayedLikeCount).toBe(0);
    expect(component.isBookmarked).toBe(false);
  });

  it('redirects signed-out users to login and includes the blog detail return URL', () => {
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');

    component.toggleLike();

    expect(navigateSpy).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: router.url },
    });
  });
});
