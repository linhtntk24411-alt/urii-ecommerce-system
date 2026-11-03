import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { MapService, SampleMap } from '../../core/services/map.service';
import { SampleMapsDetailComponent } from './sample-maps-detail';

describe('SampleMapsDetailComponent', () => {
  let fixture: ComponentFixture<SampleMapsDetailComponent>;
  const map: SampleMap = {
    id: 'map-id',
    slug: 'test-map',
    title: 'Mẫu thử',
    category: 'Hướng dẫn DIY',
    categories: ['Hướng dẫn DIY'],
    image: 'assets/gallery_assets/mau-ca-heo.webp',
    difficulty: 'Dễ',
    difficultyClass: 'badge-easy',
    gridSize: '29 x 29',
    totalBeads: 100,
    time: '1 giờ',
    isPopular: false,
    isNew: false,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SampleMapsDetailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ slug: map.slug })),
            queryParamMap: of(convertToParamMap({})),
          },
        },
        {
          provide: MapService,
          useValue: {
            getMapBySlug: () => of(map),
            getMapById: () => of(map),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SampleMapsDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('links the community share action to blog creation', () => {
    const shareLink = fixture.nativeElement.querySelector('.btn-outline') as HTMLAnchorElement;

    expect(shareLink.textContent).toContain('Chia sẻ với cộng đồng');
    expect(shareLink.getAttribute('href')).toBe('/blog-create');
  });
});
