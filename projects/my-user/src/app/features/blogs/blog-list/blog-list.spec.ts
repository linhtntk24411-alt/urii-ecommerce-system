import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { BlogPost, BlogService } from '../../../core/services/blog.service';
import { BlogListComponent } from './blog-list';

describe('BlogList', () => {
  let component: BlogListComponent;
  let fixture: ComponentFixture<BlogListComponent>;
  let blogs: BlogPost[] = [];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BlogListComponent],
      providers: [
        provideRouter([]),
        { provide: BlogService, useValue: { getBlogs: () => of(blogs) } },
      ],
    }).compileComponents();

    blogs = [];
    fixture = TestBed.createComponent(BlogListComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should order fetched blogs newest first', () => {
    blogs = [
      createBlog('older', '2026-01-01T00:00:00.000Z'),
      createBlog('newer', '2026-02-01T00:00:00.000Z'),
    ];

    component.loadBlogs();

    expect(component.allBlogs.map((blog) => blog.id)).toEqual(['newer', 'older']);
  });

  it('filters blogs using the selected search query', () => {
    component.allBlogs = [
      { ...createBlog('match', '2026-02-01T00:00:00.000Z'), title: 'Hướng dẫn làm móc khóa' },
      { ...createBlog('other', '2026-01-01T00:00:00.000Z'), title: 'Mẹo phối màu' },
    ];
    component.searchTerm = 'huong dan lam moc khoa';

    component.applyFilters();

    expect(component.filteredBlogs.map((blog) => blog.id)).toEqual(['match']);
  });
});

function createBlog(id: string, date: string): BlogPost {
  return {
    id,
    slug: id,
    title: id,
    summary: '',
    excerpt: '',
    content: '',
    author: 'Urii',
    avatar: '',
    date,
    image: '',
    category: '',
    categorySlug: '',
    likes: 0,
    comments: 0,
    views: 0,
    isFeatured: false,
    tags: [],
  };
}
