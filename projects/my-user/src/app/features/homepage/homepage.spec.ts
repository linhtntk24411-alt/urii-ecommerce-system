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

  it('loads the newest community posts with images from the shared blogs API', () => {
    fixture.detectChanges();
    httpTestingController.expectOne('/api/products').flush([]);
    httpTestingController.expectOne('/api/blogs').flush([
      {
        id: 1,
        slug: 'old-post',
        title: 'Bài cũ',
        image: 'images/gallery_assets/old.webp',
        date: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 2,
        slug: 'new-post',
        title: 'Bài mới',
        image: 'images/gallery_assets/new.webp',
        date: '2026-02-01T00:00:00.000Z',
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
  });
});
