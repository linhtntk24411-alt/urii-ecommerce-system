import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BlogsAdmin } from './blogs-admin';
import { AdminApiService } from '../../core/services/admin-api.service';

describe('BlogsAdmin', () => {
  let component: BlogsAdmin;
  let fixture: ComponentFixture<BlogsAdmin>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BlogsAdmin],
      providers: [{
        provide: AdminApiService,
        useValue: {
          getBlogs: () => Promise.resolve([{
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
});
