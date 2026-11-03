import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { MapService, SampleMap } from '../../core/services/map.service';
import { SampleMapsComponent } from './sample-maps';

describe('SampleMapsComponent', () => {
  let component: SampleMapsComponent;
  let fixture: ComponentFixture<SampleMapsComponent>;
  let maps: SampleMap[];

  beforeEach(async () => {
    localStorage.clear();
    maps = Array.from({ length: 13 }, (_, index) => createMap(index + 1));

    await TestBed.configureTestingModule({
      imports: [SampleMapsComponent],
      providers: [
        provideRouter([]),
        { provide: MapService, useValue: { getMaps: () => of(maps) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SampleMapsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('keeps every pagination button visible and updates the current page', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const pageButtons = fixture.nativeElement.querySelectorAll('.page-number-btn') as NodeListOf<HTMLButtonElement>;
    expect(Array.from(pageButtons).map((button) => button.textContent?.trim())).toEqual(['1', '2', '3']);

    pageButtons[1].click();
    fixture.detectChanges();

    expect(component.currentPage).toBe(2);
    expect(component.paginatedMaps[0].id).toBe('7');
    expect(fixture.nativeElement.querySelectorAll('.page-number-btn')).toHaveLength(3);
    expect(fixture.nativeElement.querySelector('.page-number-active')?.textContent?.trim()).toBe('2');
  });

  it('keeps the save button visible and toggles the saved map state', () => {
    const button = fixture.nativeElement.querySelector('.btn-map-action--save') as HTMLButtonElement;

    button.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.btn-map-action--save')).toBe(button);
    expect(button.textContent).toContain('Đã lưu');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(JSON.parse(localStorage.getItem('savedMaps') ?? '[]')).toHaveLength(1);

    button.click();
    fixture.detectChanges();

    expect(button.textContent).toContain('Lưu mẫu');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(JSON.parse(localStorage.getItem('savedMaps') ?? '[]')).toHaveLength(0);
  });
});

function createMap(id: number): SampleMap {
  return {
    id: String(id),
    slug: `map-${id}`,
    title: `Mẫu ${id}`,
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
}
