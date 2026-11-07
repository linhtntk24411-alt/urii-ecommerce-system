import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MapService, SampleMap } from '../../core/services/map.service';

@Component({
  selector: 'app-sample-maps',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './sample-maps.html',
  styleUrls: ['./sample-maps.css']
})
export class SampleMapsComponent implements OnInit {
  private readonly mapService = inject(MapService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
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
  searchTerm = '';
  totalPages: number = 1;
  isLoading = true;
  errorMessage = '';
  savedMapIds = new Set<string>();
  saveMessage = '';
  private readonly pendingSaveIds = new Set<string>();

  ngOnInit() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.searchTerm = params.get('search')?.trim() ?? '';
      this.currentPage = 1;
      this.applyFilters();
    });

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
    const searchTerm = this.normalize(this.searchTerm);
    this.filteredMaps = this.allMaps.filter(map => {
      const matchCategory = this.selectedCategory === 'Tất cả mẫu' || map.categories.includes(this.selectedCategory);
      const matchDifficulty = this.selectedDifficulties.length === 0 || this.selectedDifficulties.includes(map.difficulty);
      const matchSearch = !searchTerm
        || [map.title, map.category, ...map.categories].some((value) => this.normalize(value).includes(searchTerm));
      return matchCategory && matchDifficulty && matchSearch;
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
    const token = this.getToken();
    if (!token) {
      this.saveMessage = 'Vui lòng đăng nhập để lưu map.';
      void this.router.navigate(['/login'], { queryParams: { returnUrl: '/sample-maps' } });
      return;
    }
    if (this.pendingSaveIds.has(map.id)) return;

    const alreadySaved = this.isMapSaved(map.id);
    this.pendingSaveIds.add(map.id);
    const request = alreadySaved
      ? this.mapService.removeMySavedMap(token, map.id)
      : this.mapService.saveMyMap(token, map.id);
    request.subscribe({
      next: () => {
        if (alreadySaved) this.savedMapIds.delete(map.id);
        else this.savedMapIds.add(map.id);
        this.saveMessage = alreadySaved
          ? `Đã bỏ lưu "${map.title}".`
          : `Đã lưu "${map.title}" vào bộ sưu tập.`;
        this.pendingSaveIds.delete(map.id);
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Không thể cập nhật bộ sưu tập map:', error);
        this.saveMessage = error instanceof HttpErrorResponse && error.status === 401
          ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
          : 'Không thể cập nhật bộ sưu tập map. Vui lòng thử lại.';
        this.pendingSaveIds.delete(map.id);
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  isMapSaved(mapId: string): boolean {
    return this.savedMapIds.has(mapId);
  }

  private loadSavedMaps(): void {
    const token = this.getToken();
    if (!token) return;
    this.mapService.getMySavedMaps(token).subscribe({
      next: (response: unknown) => {
        if (!Array.isArray(response)) {
          this.saveMessage = 'Dữ liệu map đã lưu nhận được không hợp lệ.';
          this.changeDetectorRef.markForCheck();
          return;
        }
        this.savedMapIds = new Set(response.flatMap((record): string[] => {
          if (typeof record !== 'object' || record === null || !('mapId' in record)) return [];
          const mapId = record['mapId'];
          return typeof mapId === 'string' ? [mapId] : [];
        }));
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Không thể tải map đã lưu:', error);
        this.saveMessage = 'Không thể tải trạng thái map đã lưu.';
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  private getToken(): string {
    const token = localStorage.getItem('authToken');
    return localStorage.getItem('isLoggedIn') === 'true' ? token || '' : '';
  }

  resetFilters() {
    this.selectedCategory = 'Tất cả mẫu';
    this.selectedDifficulties = [];
    this.currentSort = 'default';
    this.currentPage = 1;
    this.applyFilters();
  }

  private normalize(value: string): string {
    return value.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('vi');
  }
}