import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject, NEVER, of } from 'rxjs';
import { BlogsAdmin } from './blogs-admin';
import { AdminApiService } from '../../core/services/admin-api.service';
import { AdminSocketService } from '../../core/services/admin-socket.service';

describe('BlogsAdmin', () => {
  let component: BlogsAdmin;
  let fixture: ComponentFixture<BlogsAdmin>;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let getBlogBySlug: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({}));
    getBlogBySlug = vi.fn();
    await TestBed.configureTestingModule({
      imports: [BlogsAdmin],
      providers: [{
        provide: ActivatedRoute, useValue: { queryParamMap: params.asObservable() },
      }, {
        provide: AdminSocketService, useValue: { onCrudChange: () => NEVER },
      }, {
        provide: AdminApiService,
        useValue: {
          getBlogBySlug,
          getBlogsForAdmin: () => Promise.resolve([{
            id: 1,
            title: 'Bài viết kiểm thử',
            slug: 'bai-viet-kiem-thu',
            image: 'images/index/stcd1.png',
            author: 'Tác giả kiểm thử',
            date: '02 Tháng 11, 2026'
          }]),
          getLibraryMapImageUrl: (path: string) => `http://localhost:3002/${path}`
        }
      }]
    }).compileComponents();

    fixture = TestBed.createComponent(BlogsAdmin);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load and display blogs returned by the API', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.blogs[0].author.name).toBe('Tác giả kiểm thử');
    expect(fixture.nativeElement.textContent).toContain('Bài viết kiểm thử');
  });

  it('should load relative blog images from the backend static server', () => {
    expect(component.formatImagePath('images/index/stcd1.png'))
      .toBe('http://localhost:3002/images/index/stcd1.png');
  });

  it('loads and highlights a Dashboard-linked article outside the initial list', async () => {
    const scroll = vi.fn();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
    try {
      getBlogBySlug.mockReturnValue(of({
        id: 102, _id: 'mongo-blog-id', slug: 'bai-moi', title: 'Bài mới',
        author: 'Tác giả', date: '19/11/2026',
      }));
      params.next(convertToParamMap({ searchType: 'blog', searchId: '102', searchSlug: 'bai-moi' }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(getBlogBySlug).toHaveBeenCalledExactlyOnceWith('bai-moi');
      expect(component.blogs.map(blog => blog.id)).toEqual([1, 102]);
      expect(fixture.nativeElement.querySelector('#admin-search-target-blog-102 td').style.backgroundColor).not.toBe('');
      expect(scroll).toHaveBeenCalledTimes(1);
    } finally {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });
});
