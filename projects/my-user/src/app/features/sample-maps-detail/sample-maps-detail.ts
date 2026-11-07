import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { combineLatest, map } from 'rxjs';
import { MapService, SampleMap } from '../../core/services/map.service';
import { HttpErrorResponse } from '@angular/common/http';

@Component({
  selector: 'app-sample-maps-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './sample-maps-detail.html',
  styleUrls: ['./sample-maps-detail.css']
})
export class SampleMapsDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly mapService = inject(MapService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  mapDetail: SampleMap | null = null;
  isLoading = true;
  errorMessage = '';

  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.route.queryParamMap]).pipe(
      map(([pathParams, queryParams]) => ({
        slug: pathParams.get('slug')?.trim(),
        id: queryParams.get('id')?.trim(),
      })),
    ).subscribe(({ slug, id }) => {
      if (slug) {
        this.loadMap(this.mapService.getMapBySlug(slug));
      } else if (id) {
        this.loadMap(this.mapService.getMapById(id));
      } else {
        this.mapDetail = null;
        this.isLoading = false;
        this.errorMessage = 'Không tìm thấy mã map.';
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  private loadMap(request: ReturnType<MapService['getMapBySlug']>): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.mapDetail = null;

    request.subscribe({
      next: (sampleMap) => {
        this.mapDetail = sampleMap ?? null;
        this.errorMessage = sampleMap ? '' : 'Không tìm thấy map này.';
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Lỗi tải chi tiết map:', error);
        this.errorMessage = 'Không thể tải map. Vui lòng thử lại.';
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  saveMap(): void {
    const map = this.mapDetail;
    if (!map) return;
    const token = localStorage.getItem('isLoggedIn') === 'true'
      ? localStorage.getItem('authToken') || ''
      : '';
    if (!token) {
      void this.router.navigate(['/login'], {
        queryParams: { returnUrl: `/sample-maps-detail/${encodeURIComponent(map.slug)}` },
      });
      return;
    }

    this.mapService.saveMyMap(token, map.id).subscribe({
      next: () => window.alert(`Đã lưu "${map.title}" vào kho map.`),
      error: (error: unknown) => {
        console.error('Không thể lưu map:', error);
        window.alert(error instanceof HttpErrorResponse && error.status === 409
          ? `Map "${map.title}" đã có trong kho của bạn.`
          : 'Không thể lưu map. Vui lòng thử lại.');
      },
    });
  }

  scrollToGuide(): void {
    document.getElementById('guideSection')?.scrollIntoView({ behavior: 'smooth' });
  }
}
