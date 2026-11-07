import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { combineLatest, map } from 'rxjs';
import { MapService, SampleMap } from '../../core/services/map.service';
import { HttpErrorResponse } from '@angular/common/http';
import { DialogService } from '../../core/services/dialog.service';

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
  private readonly dialogService = inject(DialogService);

  mapDetail: SampleMap | null = null;
  isSaved = false;
  pendingSave = false;
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
        if (this.mapDetail) {
          this.checkSavedStatus();
        }
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

  downloadPdf(): void {
    const map = this.mapDetail;
    if (!map) return;

    if (typeof window === 'undefined') return;
    const html2pdf = (window as any).html2pdf;
    if (!html2pdf) {
      this.dialogService.alert('Thư viện tạo PDF đang tải, vui lòng thử lại sau vài giây.', 'Đang chuẩn bị', 'info');
      return;
    }

    // Convert image to base64 to avoid CORS issues in html2canvas
    const imageUrl = map.image || '';
    this.loadImageAsBase64(imageUrl).then(base64Image => {
      this.generateAndSavePdf(html2pdf, map, base64Image);
    }).catch(() => {
      // If image load fails, generate PDF without image
      this.generateAndSavePdf(html2pdf, map, '');
    });
  }

  private loadImageAsBase64(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!url) { reject('no url'); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || 400;
          canvas.height = img.naturalHeight || 400;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject('no ctx'); return; }
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject('load error');
      img.src = url;
    });
  }

  private generateAndSavePdf(html2pdf: any, map: SampleMap, base64Image: string): void {
    const steps = [
      {
        number: 1,
        title: 'Chuẩn bị bảng pegboard và nguyên liệu',
        text: `Chuẩn bị bàn ủi hạt pegboard kích thước ${map.gridSize || '32 x 32 ô'}, giấy nến chịu nhiệt chuyên dụng và khoảng ${map.totalBeads || '200-300'} hạt nhựa màu sắc tương ứng.`,
        tip: 'Nên dùng nhíp gắp chuyên dụng để xếp các chi tiết nhỏ chuẩn xác và nhanh hơn.'
      },
      {
        number: 2,
        title: 'Xếp hạt nhựa theo sơ đồ mẫu',
        text: 'Đặt các hạt nhựa theo đúng vị trí trên sơ đồ mẫu hạt nhựa ủi bên cạnh, xếp từ các đường viền ngoài vào trong để cố định hình dạng tác phẩm chắc chắn.',
        tip: 'Kiểm tra kỹ các góc viền và sự đồng đều màu trước khi bắt đầu ủi nhiệt.'
      },
      {
        number: 3,
        title: 'Ủi nhiệt định hình tác phẩm',
        text: 'Đặt giấy nến lên trên mặt tranh, sử dụng bàn ủi nhiệt độ vừa (khoảng 140-160°C), di chuyển tròn đều tay từ 15-25 giây cho đến khi các hạt dính liền đều nhau.',
        tip: 'Không đè bàn ủi quá mạnh để hạt giữ được độ tròn đều và lỗ thoát khí đẹp mắt.'
      },
      {
        number: 4,
        title: 'Làm nguội và hoàn thiện',
        text: 'Để nguội 2-3 phút dưới vật nặng phẳng để tranh không bị cong vênh. Sau đó lật mặt sau ủi nhẹ thêm 10 giây để tăng độ bền chắc tối đa.',
        tip: 'Tác phẩm sau khi nguội có thể gắn thêm móc khóa, nam châm hoặc chân đế trưng bày.'
      }
    ];

    let stepsHtml = '';
    steps.forEach(step => {
      const tipText = step.tip ? `<br><span style="color: #666; font-size: 11px; font-style: italic;">* Mẹo: ${step.tip}</span>` : '';
      stepsHtml += `
        <div style="margin-bottom: 8px;">
          <h4 style="color: #000000; margin: 2px 0; font-size: 13px; font-weight: bold;">Bước ${step.number}: ${step.title}</h4>
          <p style="margin: 2px 0; color: #333333; font-size: 12px; line-height: 1.4;">
            ${step.text}${tipText}
          </p>
        </div>`;
    });

    const imgTag = base64Image
      ? `<img src="${base64Image}" style="width: 200px; height: 200px; object-fit: contain; border-radius: 8px; border: 2px solid #f0f0f0; display: inline-block;" />`
      : `<div style="width:200px;height:200px;background:#f5f5f5;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;font-size:12px;color:#999;">Không tải được ảnh</div>`;

    const pdfContent = document.createElement('div');
    pdfContent.style.width = '190mm';
    pdfContent.style.padding = '15px';
    pdfContent.style.fontFamily = '"Times New Roman", Times, serif';
    pdfContent.style.fontSize = '13px';
    pdfContent.style.boxSizing = 'border-box';
    pdfContent.style.background = '#ffffff';

    pdfContent.innerHTML = `
      <div style="text-align:center;border-bottom:2px solid #ff2222;padding-bottom:6px;margin-bottom:12px;">
        <p style="margin:0;font-size:22px;font-weight:900;color:#840001;letter-spacing:2px;">URII HANDMADE</p>
        <p style="margin:3px 0 0 0;font-size:11px;color:#333;letter-spacing:1.5px;font-weight:600;">HƯỚNG DẪN LÀM MAP HẠT ỦI CHUẨN</p>
      </div>

      <h2 style="color:#000;text-align:center;margin:4px 0 6px 0;font-size:17px;font-weight:bold;">Map mẫu: ${map.title}</h2>
      <p style="text-align:center;color:#555;font-size:11px;margin:0 0 12px 0;">
        Thời gian: ${map.time || '15-20 phút'} &nbsp;|&nbsp; Cấp độ: ${map.difficulty || 'Dễ'} &nbsp;|&nbsp; Lưới: ${map.gridSize || '32 x 32 ô'} &nbsp;|&nbsp; Tổng hạt: ${map.totalBeads || '200-300'} hạt
      </p>

      <table style="width:100%;border-collapse:collapse;border:none;">
        <tr>
          <td style="width:42%;vertical-align:top;padding-right:12px;text-align:center;">
            <p style="font-weight:bold;color:#cc0000;font-size:11px;margin:0 0 8px 0;text-transform:uppercase;letter-spacing:0.5px;">MAP MẪU (IMAGE MAP)</p>
            ${imgTag}
          </td>
          <td style="width:58%;vertical-align:top;border-left:2px dashed #ddd;padding-left:14px;text-align:left;">
            <h3 style="color:#cc0000;border-left:3px solid #cc0000;padding-left:6px;margin:0 0 10px 0;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">CÁC BƯỚC THỰC HIỆN CHI TIẾT</h3>
            ${stepsHtml}
          </td>
        </tr>
      </table>
    `;

    const cleanTitle = this.cleanPdfFileName(map.title);
    const options = {
      margin: 10,
      filename: `Urii-Map-${cleanTitle}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        scrollX: 0,
        scrollY: 0,
        backgroundColor: '#ffffff'
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(options).from(pdfContent).save();
  }

  private cleanPdfFileName(title: string): string {
    return (title || 'Huong-Dan-Map')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  saveMap(): void {
    const map = this.mapDetail;
    if (!map) return;
    const token = this.getToken();
    if (!token) {
      void this.router.navigate(['/login'], {
        queryParams: { returnUrl: `/sample-maps-detail/${encodeURIComponent(map.slug)}` },
      });
      return;
    }
    if (this.pendingSave) return;

    this.pendingSave = true;
    const alreadySaved = this.isSaved;
    const request = alreadySaved
      ? this.mapService.removeMySavedMap(token, map.id)
      : this.mapService.saveMyMap(token, map.id);

    request.subscribe({
      next: () => {
        this.isSaved = !alreadySaved;
        this.pendingSave = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Không thể cập nhật bộ sưu tập map:', error);
        this.pendingSave = false;
        if (error instanceof HttpErrorResponse && error.status === 401) {
          void this.router.navigate(['/login'], {
            queryParams: { returnUrl: `/sample-maps-detail/${encodeURIComponent(map.slug)}` },
          });
        }
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  private checkSavedStatus(): void {
    if (!this.mapDetail) return;
    const token = this.getToken();
    if (!token) {
      this.isSaved = false;
      this.changeDetectorRef.markForCheck();
      return;
    }

    this.mapService.getMySavedMaps(token).subscribe({
      next: (response: unknown) => {
        if (!Array.isArray(response)) return;
        const currentId = this.mapDetail?.id;
        const currentSlug = this.mapDetail?.slug;
        this.isSaved = response.some((record) => {
          if (typeof record !== 'object' || record === null || !('mapId' in record)) return false;
          const mapId = record['mapId'];
          return mapId === currentId || mapId === currentSlug;
        });
        this.changeDetectorRef.markForCheck();
      },
      error: () => {
        this.isSaved = false;
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  private getToken(): string {
    if (typeof window === 'undefined') return '';
    const token = localStorage.getItem('authToken');
    return localStorage.getItem('isLoggedIn') === 'true' ? token || '' : '';
  }

  scrollToGuide(): void {
    document.getElementById('guideSection')?.scrollIntoView({ behavior: 'smooth' });
  }
}
