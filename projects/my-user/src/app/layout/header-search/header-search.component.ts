import { CommonModule } from '@angular/common';
import { afterNextRender, Component, ElementRef, HostListener, OnDestroy, OnInit, Pipe, PipeTransform, ViewChild, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Router } from '@angular/router';
import { combineLatest, debounceTime, distinctUntilChanged, map, startWith, Subject, switchMap, takeUntil, tap } from 'rxjs';
import { Search, SearchCategory, SearchResult, SearchResultCategory } from '../../core/services/search';

interface CategoryTab {
  id: SearchCategory;
  label: string;
}

interface SearchGroup {
  category: SearchResultCategory;
  label: string;
  results: SearchResult[];
}

interface HighlightPart {
  text: string;
  match: boolean;
}

@Pipe({ name: 'searchHighlight', standalone: true, pure: true })
export class SearchHighlightPipe implements PipeTransform {
  transform(value: string, query: string): HighlightPart[] {
    const term = query.trim();
    if (!term) return [{ text: value, match: false }];

    const parts: HighlightPart[] = [];
    const sourceOffsets: number[] = [];
    let sourceOffset = 0;
    const normalizedValue = Array.from(value, (character) => {
      const normalizedCharacter = character.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('vi');
      for (let index = 0; index < normalizedCharacter.length; index += 1) {
        sourceOffsets.push(sourceOffset);
      }
      sourceOffset += character.length;
      return normalizedCharacter;
    }).join('');
    const normalizedTerm = term.trim().replace(/\s+/g, ' ').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('vi');
    if (!normalizedTerm) return [{ text: value, match: false }];

    let cursor = 0;
    let matchIndex = normalizedValue.indexOf(normalizedTerm);

    while (matchIndex !== -1) {
      const sourceStart = sourceOffsets[matchIndex];
      const sourceEnd = sourceOffsets[matchIndex + normalizedTerm.length] ?? value.length;
      if (sourceStart > cursor) {
        parts.push({ text: value.slice(cursor, sourceStart), match: false });
      }
      parts.push({ text: value.slice(sourceStart, sourceEnd), match: true });
      cursor = sourceEnd;
      matchIndex = normalizedValue.indexOf(normalizedTerm, matchIndex + normalizedTerm.length);
    }

    if (cursor < value.length) {
      parts.push({ text: value.slice(cursor), match: false });
    }

    return parts.length ? parts : [{ text: value, match: false }];
  }
}

@Component({
  imports: [CommonModule, ReactiveFormsModule, RouterLink, SearchHighlightPipe],
  selector: 'app-header-search',
  styleUrl: './header-search.component.scss',
  templateUrl: './header-search.component.html',
})
export class HeaderSearch implements OnInit, OnDestroy {
  private readonly searchService = inject(Search);
  private readonly router = inject(Router);
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly categoryChanges = new Subject<SearchCategory>();
  private readonly destroy$ = new Subject<void>();

  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly tabs: CategoryTab[] = [
    { id: 'all', label: 'Tất cả' },
    { id: 'products', label: 'Sản phẩm' },
    { id: 'maps', label: 'Thư viện Map' },
    { id: 'blogs', label: 'Blog' },
  ];

  isOpen = false;
  isLoading = false;
  activeCategory: SearchCategory = 'all';
  activeIndex = -1;
  results: SearchResult[] = [];

  constructor() {
    afterNextRender(() => this.syncNativeInput());
  }

  ngOnInit(): void {
    combineLatest([
      this.searchControl.valueChanges.pipe(
        startWith(this.searchControl.value),
        debounceTime(300),
        map((query) => query.trim().replace(/\s+/g, ' ')),
        distinctUntilChanged(),
      ),
      this.categoryChanges.pipe(startWith(this.activeCategory)),
    ]).pipe(
      tap(() => {
        this.isLoading = Boolean(this.searchControl.value.trim());
        this.activeIndex = -1;
        if (!this.searchControl.value.trim()) {
          this.results = [];
        }
      }),
      switchMap(([query, category]) => this.searchService.search(query, category)),
      takeUntil(this.destroy$),
    ).subscribe({
      next: (response) => {
        this.results = response.results;
        this.isLoading = response.loading;
      },
      error: (error: unknown) => {
        console.error('Không thể tải kết quả tìm kiếm:', error);
        this.results = [];
        this.isLoading = false;
      },
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get query(): string {
    return this.searchControl.value;
  }

  onSearchInput(value: string): void {
    this.isOpen = true;
    this.syncSearchValue(value);
  }

  onSearchFocus(value: string): void {
    this.isOpen = true;
    this.syncSearchValue(value);
  }

  private syncNativeInput(): void {
    const input = this.searchInput?.nativeElement;
    if (input) this.syncSearchValue(input.value);
  }

  private syncSearchValue(value: string): void {
    if (value !== this.searchControl.value) {
      this.searchControl.setValue(value);
    }
  }

  get groups(): SearchGroup[] {
    const categories: { id: SearchResultCategory; label: string }[] = [
      { id: 'products', label: 'Sản phẩm' },
      { id: 'blogs', label: 'Bài viết Blog' },
      { id: 'maps', label: 'Thư viện Map mẫu' },
    ];

    return categories.flatMap(({ id, label }) => {
      const results = this.results.filter((result) => result.category === id).slice(0, 4);
      return results.length ? [{ category: id, label, results }] : [];
    });
  }

  get activeOptionId(): string | null {
    return this.activeIndex >= 0 ? `search-result-${this.activeIndex}` : null;
  }

  get hasResults(): boolean {
    return this.groups.length > 0;
  }

  get showEmptyState(): boolean {
    return !this.isLoading && this.query.trim().length > 0 && !this.hasResults;
  }

  get flattenedResults(): SearchResult[] {
    return this.groups.flatMap((group) => group.results);
  }

  setCategory(category: SearchCategory): void {
    this.activeCategory = category;
    this.activeIndex = -1;
    this.categoryChanges.next(category);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.isOpen = true;
      const count = this.flattenedResults.length;
      if (!count) return;

      const direction = event.key === 'ArrowDown' ? 1 : -1;
      this.activeIndex = (this.activeIndex + direction + count) % count;
      return;
    }

    if (event.key === 'Enter' && this.activeIndex >= 0) {
      event.preventDefault();
      const result = this.flattenedResults[this.activeIndex];
      if (result) this.selectResult(result);
    }
  }

  selectResult(result: SearchResult): void {
    void this.router.navigateByUrl(this.resultRoute(result))
      .catch((error: unknown) => console.error('Không thể mở kết quả tìm kiếm:', error));
    this.close();
  }

  resultRoute(result: SearchResult): string {
    switch (result.category) {
      case 'products':
        return `/product-detail/${encodeURIComponent(result.slug)}`;
      case 'blogs':
        return `/blog-detail/${encodeURIComponent(result.slug)}`;
      case 'maps':
        return `/sample-maps-detail/${encodeURIComponent(result.slug)}`;
    }
  }

  close(): void {
    this.isOpen = false;
    this.activeIndex = -1;
  }

  @HostListener('document:click', ['$event'])
  closeWhenClickingOutside(event: MouseEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }

  resultId(index: number): string {
    return `search-result-${index}`;
  }

  badgeClass(category: SearchResultCategory): string {
    return `category-badge category-badge--${category}`;
  }
}
