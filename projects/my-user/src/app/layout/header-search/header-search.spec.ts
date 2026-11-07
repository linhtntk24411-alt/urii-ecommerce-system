import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { BlogService } from '../../core/services/blog.service';
import { MapService } from '../../core/services/map.service';
import { ProductCatalogService } from '../../core/services/product-catalog.service';
import { of } from 'rxjs';
import { HeaderSearch, SearchHighlightPipe } from './header-search.component';
import { Search } from '../../core/services/search';

describe('HeaderSearch', () => {
  let component: HeaderSearch;
  let fixture: ComponentFixture<HeaderSearch>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderSearch],
      providers: [
        provideRouter([]),
        {
          provide: ProductCatalogService,
          useValue: { getCachedProducts: () => [], getProducts: () => of([]) },
        },
        { provide: BlogService, useValue: { getBlogs: () => of([]) } },
        { provide: MapService, useValue: { getMaps: () => of([]) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HeaderSearch);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('highlights accent-insensitive matches in the original title', () => {
    const parts = new SearchHighlightPipe().transform('Map hoa tulip', 'hoa');

    expect(parts).toEqual([
      { text: 'Map ', match: false },
      { text: 'hoa', match: true },
      { text: ' tulip', match: false },
    ]);
  });

  it('navigates to the selected result destination', () => {
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const result = {
      id: 'map-tulip',
      title: 'Map hoa tulip pixel',
      description: 'Map mẫu hoa tulip.',
      category: 'maps' as const,
      slug: 'hoa-tulip',
      score: 90,
    };

    component.searchControl.setValue('hoa', { emitEvent: false });
    component.isOpen = true;
    component.selectResult(result);

    expect(navigateSpy).toHaveBeenCalledWith('/sample-maps-detail/hoa-tulip');
    expect(component.isOpen).toBe(false);
  });

  it('opens the actual matching product detail by slug', () => {
    const productResult = {
      id: 'actual-id',
      slug: 'ban-ui-mini',
      title: 'Bàn ủi mini',
      description: 'Dụng cụ',
      category: 'products' as const,
      score: 95,
    };

    expect(component.resultRoute(productResult)).toBe('/product-detail/ban-ui-mini');
  });

  it('opens the matching blog detail by its real slug', () => {
    const blogResult = {
      id: 'real-blog-id',
      slug: 'huong-dan-diy-moc-khoa',
      title: 'Hướng dẫn DIY móc khóa',
      description: 'Hướng dẫn',
      category: 'blogs' as const,
      score: 95,
    };

    expect(component.resultRoute(blogResult)).toBe('/blog-detail/huong-dan-diy-moc-khoa');
  });

  it('opens the matching map detail by its real slug', () => {
    const mapResult = {
      id: 'real-map-id',
      slug: 'hoa-tulip-pixel',
      title: 'Hoa tulip pixel',
      description: 'Map hoa quả',
      category: 'maps' as const,
      score: 95,
    };

    expect(component.resultRoute(mapResult)).toBe('/sample-maps-detail/hoa-tulip-pixel');
  });

  it('shows matching suggestions after typing without pressing Enter', async () => {
    const search = TestBed.inject(Search);
    const result = {
      id: 'real-product-id',
      slug: 'ban-ui-mini',
      title: 'Bàn ủi mini',
      description: 'Dụng cụ',
      category: 'products' as const,
      score: 95,
    };
    const searchSpy = vi.spyOn(search, 'search').mockReturnValue(of({
      results: [result],
      loading: false,
    }));

    fixture.detectChanges();
    component.isOpen = true;
    component.searchControl.setValue('ban ui');
    await new Promise((resolve) => setTimeout(resolve, 350));
    fixture.detectChanges();

    expect(searchSpy).toHaveBeenCalledWith('ban ui', 'all');
    expect(component.results).toEqual([result]);
    expect(component.isOpen).toBe(true);
  });

  it('syncs the visible input value to search when typing and focusing', async () => {
    const search = TestBed.inject(Search);
    const result = {
      id: 'real-map-id',
      slug: 'map-m40',
      title: 'Map hoa mẫu',
      description: 'Thư viện map mẫu',
      category: 'maps' as const,
      score: 90,
    };
    const searchSpy = vi.spyOn(search, 'search').mockReturnValue(of({
      results: [result],
      loading: false,
    }));

    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'hoa';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 350));
    fixture.detectChanges();

    expect(component.searchControl.value).toBe('hoa');
    expect(searchSpy).toHaveBeenCalledWith('hoa', 'all');
    expect(component.results).toEqual([result]);
  });

  it('keeps current suggestions when a trailing space is typed', async () => {
    const search = TestBed.inject(Search);
    const result = {
      id: 'real-product-id',
      slug: 'ban-ui-mini',
      title: 'Bàn ủi mini',
      description: 'Dụng cụ',
      category: 'products' as const,
      score: 95,
    };
    const searchSpy = vi.spyOn(search, 'search').mockReturnValue(of({
      results: [result],
      loading: false,
    }));

    fixture.detectChanges();
    component.searchControl.setValue('ban ui');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(component.results).toEqual([result]);

    component.searchControl.setValue('ban ui ');
    await new Promise((resolve) => setTimeout(resolve, 350));
    fixture.detectChanges();

    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(component.results).toEqual([result]);
    expect(component.hasResults).toBe(true);
  });

});
