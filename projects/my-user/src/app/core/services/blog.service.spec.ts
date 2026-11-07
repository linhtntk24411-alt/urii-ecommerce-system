import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BlogComment, BlogPost, BlogService } from './blog.service';

describe('BlogService', () => {
  let service: BlogService;
  let httpTestingController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(BlogService);
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTestingController.verify());

  it('reads blogs from the shared endpoint and maps backend image paths', () => {
    let result: BlogPost[] = [];

    service.getBlogs().subscribe((blogs) => {
      result = blogs;
    });

    const request = httpTestingController.expectOne('/api/blogs');
    expect(request.request.method).toBe('GET');
    request.flush([{
      id: 21,
      slug: 'mau-moi',
      title: 'Mẫu mới',
      image: 'images/gallery_assets/mau-moi.webp',
      date: '2026-10-12T10:00:00.000Z',
    }]);

    expect(result[0].image).toBe('/api/images/gallery_assets/mau-moi.webp');
    expect(result[0].imageAvailable).toBe(true);
  });

  it('filters paginated blogs by the authenticated user', () => {
    let result: BlogPost[] = [];

    service.getBlogsByUser('user-token', 'user-1').subscribe((blogs) => {
      result = blogs;
    });

    const request = httpTestingController.expectOne((candidate) =>
      candidate.url === '/api/blogs'
      && candidate.params.get('page') === '1'
      && candidate.params.get('limit') === '100',
    );
    expect(request.request.headers.get('Authorization')).toBe('Bearer user-token');
    request.flush([
      { id: 21, slug: 'my-post', title: 'Bài của tôi', userId: 'user-1' },
      { id: 22, slug: 'other-post', title: 'Bài người khác', userId: 'user-2' },
    ]);

    expect(result.map((blog) => blog.slug)).toEqual(['my-post']);
  });

  it('reads and filters comments from the paginated comments endpoint', () => {
    let result: BlogComment[] = [];

    service.getBlogComments(42).subscribe((comments) => {
      result = comments;
    });

    const firstPage = httpTestingController.expectOne((request) =>
      request.url === '/api/comments'
      && request.params.get('page') === '1'
      && request.params.get('limit') === '100',
    );
    firstPage.flush([
      { id: 1, blogId: 42, content: 'Bình luận đúng bài' },
      ...Array.from({ length: 99 }, (_, index) => ({
        id: index + 2,
        blogId: 7,
        content: 'Bình luận bài khác',
      })),
    ]);

    const secondPage = httpTestingController.expectOne((request) =>
      request.url === '/api/comments'
      && request.params.get('page') === '2',
    );
    secondPage.flush([{ id: 101, blogId: 42, content: 'Bình luận ở trang sau' }]);

    expect(result.map((comment) => comment.content)).toEqual([
      'Bình luận đúng bài',
      'Bình luận ở trang sau',
    ]);
  });
});
