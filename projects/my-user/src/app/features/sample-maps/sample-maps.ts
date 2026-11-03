import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MapService, SampleMap } from '../../core/services/map.service';

interface SavedMap {
  id: string | number;
  [key: string]: unknown;
}

@Component({
  selector: 'app-sample-maps',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './sample-maps.html',
  styleUrls: ['./sample-maps.css']
})
export class SampleMapsComponent implements OnInit {
  private readonly mapService = inject(MapService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  allMaps: SampleMap[] = [];

  filteredMaps: SampleMap[] = [];
  paginatedMaps: SampleMap[] = [];

  categories = [{ name: 'Tất cả mẫu', count: 0 }];
  readonly pageNumbers: number[] = [];
  
  selectedCategory: string = 'Tất cả mẫu';
  selectedDifficulties: string[] = [];
  currentSort: string = 'default';

  currentPage: number = 1;
  itemsPerPage: number = 6; 
  totalPages: number = 1;
  isLoading = true;
  errorMessage = '';
  savedMapIds = new Set<string>();
  saveMessage = '';

  ngOnInit() {
    if (this.isBrowser) {
      this.loadSavedMaps();
      this.loadMaps();
    }
  }

  loadMaps(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.mapService.getMaps().subscribe({
      next: (maps) => {
        this.allMaps = maps;
        this.updateCategoryCounts();
        this.applyFilters();
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Lỗi tải thư viện map:', error);
        this.allMaps = [];
        this.updateCategoryCounts();
        this.applyFilters();
        this.errorMessage = 'Không thể tải thư viện map. Vui lòng thử lại.';
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  updateCategoryCounts() {
    const categoryCounts = new Map<string, number>();
    this.allMaps.forEach(map => {
      new Set(map.categories).forEach(category => {
        categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      });
    });

    this.categories = [
      { name: 'Tất cả mẫu', count: this.allMaps.length },
      ...[...categoryCounts]
        .sort(([first], [second]) => first.localeCompare(second, 'vi'))
        .map(([name, count]) => ({ name, count })),
    ];
    if (!this.categories.some(category => category.name === this.selectedCategory)) {
      this.selectedCategory = 'Tất cả mẫu';
    }
  }

  selectCategory(categoryName: string) {
    this.selectedCategory = categoryName;
    this.currentPage = 1;
    this.applyFilters();
  }

  onDifficultyChange(difficulty: string, event: any) {
    if (event.target.checked) {
      this.selectedDifficulties.push(difficulty);
    } else {
      this.selectedDifficulties = this.selectedDifficulties.filter(d => d !== difficulty);
    }
    this.currentPage = 1;
    this.applyFilters();
  }

  onSortChange(event: any) {
    this.currentSort = event.target.value;
    this.currentPage = 1;
    this.applyFilters();
  }

  applyFilters() {
    this.filteredMaps = this.allMaps.filter(map => {
      const matchCategory = this.selectedCategory === 'Tất cả mẫu' || map.categories.includes(this.selectedCategory);
      const matchDifficulty = this.selectedDifficulties.length === 0 || this.selectedDifficulties.includes(map.difficulty);
      return matchCategory && matchDifficulty;
    });

    if (this.currentSort === 'name-az') {
      this.filteredMaps.sort((a, b) => a.title.localeCompare(b.title, 'vi'));
    } else if (this.currentSort === 'beads-asc') {
      this.filteredMaps.sort((a, b) => a.totalBeads - b.totalBeads);
    }

    this.updatePagination();
  }

  updatePagination() {
    this.totalPages = Math.max(1, Math.ceil(this.filteredMaps.length / this.itemsPerPage));
    this.currentPage = Math.min(Math.max(this.currentPage, 1), this.totalPages);
    this.pageNumbers.splice(0, this.pageNumbers.length, ...Array.from({ length: this.totalPages }, (_, index) => index + 1));
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    this.paginatedMaps = this.filteredMaps.slice(startIndex, startIndex + this.itemsPerPage);
  }

  changePage(page: number) {
    if (!Number.isInteger(page) || page < 1 || page > this.totalPages || page === this.currentPage) return;

    this.currentPage = page;
    this.updatePagination();
    if (this.isBrowser) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  trackPage(_index: number, page: number): number {
    return page;
  }

  saveMap(map: SampleMap) {
    if (!this.isBrowser) return;

    const savedMaps = this.readSavedMaps();
    if (!savedMaps) return;
    const alreadySaved = savedMaps.some((savedMap) => String(savedMap.id) === map.id);
    const nextSavedMaps = alreadySaved
      ? savedMaps.filter((savedMap) => String(savedMap.id) !== map.id)
      : [...savedMaps, {
        id: map.id,
        title: map.title,
        author: 'Urii Thiết kế',
        image: map.image,
        rating: 5.0,
        liked: true,
      }];

    try {
      localStorage.setItem('savedMaps', JSON.stringify(nextSavedMaps));
      this.savedMapIds = new Set(nextSavedMaps.map((savedMap) => String(savedMap.id)));
      this.saveMessage = alreadySaved
        ? `Đã bỏ lưu "${map.title}".`
        : `Đã lưu "${map.title}" vào bộ sưu tập.`;
    } catch (error: unknown) {
      console.error('Không thể cập nhật bộ sưu tập map:', error);
      this.saveMessage = 'Không thể cập nhật bộ sưu tập. Vui lòng kiểm tra bộ nhớ trình duyệt.';
    }
  }

  isMapSaved(mapId: string): boolean {
    return this.savedMapIds.has(mapId);
  }

  private loadSavedMaps(): void {
    const savedMaps = this.readSavedMaps();
    if (!savedMaps) return;
    this.savedMapIds = new Set(savedMaps.map((map) => String(map.id)));
  }

  private readSavedMaps(): SavedMap[] | null {
    try {
      const stored = localStorage.getItem('savedMaps');
      if (!stored) return [];

      const parsed: unknown = JSON.parse(stored);
      if (!Array.isArray(parsed)) throw new Error('Stored maps collection has an invalid format');
      const savedMaps = parsed.filter((map): map is SavedMap =>
        typeof map === 'object'
        && map !== null
        && 'id' in map
        && (typeof map['id'] === 'string' || typeof map['id'] === 'number'));
      if (savedMaps.length !== parsed.length) throw new Error('Stored maps collection has an invalid format');
      return savedMaps;
    } catch (error: unknown) {
      console.error('Không thể đọc bộ sưu tập map đã lưu:', error);
      this.saveMessage = 'Không thể đọc bộ sưu tập map trên thiết bị này.';
      return null;
    }
  }

  resetFilters() {
    this.selectedCategory = 'Tất cả mẫu';
    this.selectedDifficulties = [];
    this.currentSort = 'default';
    this.currentPage = 1;
    this.applyFilters();
  }
}