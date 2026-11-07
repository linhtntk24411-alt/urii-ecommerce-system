import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HomepageComponent } from './homepage';

describe('HomepageComponent', () => {
  let fixture: ComponentFixture<HomepageComponent>;
  let component: HomepageComponent;
  let httpTestingController: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomepageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(HomepageComponent);
    component = fixture.componentInstance;
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTestingController.verify());

  it('keeps hero actions clickable and routes them to real destinations', () => {
    fixture.detectChanges();
    httpTestingController.expectOne('/api/products').flush([]);
    httpTestingController.expectOne('/api/blogs').flush([]);

    const hero = fixture.nativeElement.querySelector('#heroCarousel') as HTMLElement;
    const links = Array.from(hero.querySelectorAll<HTMLAnchorElement>('.hero-copy a'));

    expect(hero.hasAttribute('data-bs-ride')).toBe(false);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/products',
      '/sample-maps',
      '/custom-order',
    ]);
    expect(links.some((link) => link.getAttribute('href') === '#')).toBe(false);
  });

  it('loads the newest community posts with images from the shared blogs API', () => {
    fixture.detectChanges();
    httpTestingController.expectOne('/api/products').flush([]);
    httpTestingController.expectOne('/api/blogs').flush([
      {
        id: 1,
        slug: 'old-post',
        title: 'Bài cũ',
        image: 'images/gallery_assets/old.webp',
        date: '22 Tháng 5, 2024',
      },
      {
        id: 2,
        slug: 'new-post',
        title: 'Bài mới',
        image: 'images/gallery_assets/new.webp',
        date: '24 Tháng 5, 2024',
      },
      {
        id: 3,
        slug: 'no-image',
        title: 'Bài chưa có ảnh',
        date: '2026-03-01T00:00:00.000Z',
      },
    ]);
    fixture.detectChanges();

    expect(component.communityPosts.map((post) => post.slug)).toEqual([
      'new-post',
      'old-post',
    ]);
    expect(component.communityPosts[0].image).toBe('/api/images/gallery_assets/new.webp');
    expect(component.communityPosts).toHaveLength(2);
  });
});
