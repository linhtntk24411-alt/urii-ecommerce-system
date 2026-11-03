import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { combineLatest, map } from 'rxjs';
import { MapService, SampleMap } from '../../core/services/map.service';

@Component({
  selector: 'app-sample-maps-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './sample-maps-detail.html',
  styleUrls: ['./sample-maps-detail.css']
})
export class SampleMapsDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
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

    const savedMaps = JSON.parse(localStorage.getItem('savedMaps') || '[]');
    const isExist = savedMaps.some((item: { id: string }) => item.id === map.id);

    if (!isExist) {
      savedMaps.push({
        id: map.id,
        title: map.title,
        author: 'Urii Thiết kế',
        image: map.image,
        rating: 5.0,
        liked: true,
      });
      localStorage.setItem('savedMaps', JSON.stringify(savedMaps));
      alert(`Đã lưu "${map.title}" vào danh sách của bạn!`);
    } else {
      alert(`Mẫu "${map.title}" đã tồn tại trong danh sách lưu.`);
    }
  }

  scrollToGuide(): void {
    document.getElementById('guideSection')?.scrollIntoView({ behavior: 'smooth' });
  }
}
