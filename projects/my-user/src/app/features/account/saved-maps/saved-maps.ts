import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ChangeDetectorRef, Component, inject, OnInit, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DialogService } from '../../../core/services/dialog.service';

interface SavedMap {
  id: string;
  mapId: string;
  title: string;
  author: string;
  image: string;
}

@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-saved-maps',
  styleUrl: './saved-maps.css',
  templateUrl: './saved-maps.html',
})
export class SavedMaps implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly dialogService = inject(DialogService);

  maps: SavedMap[] = [];
  isLoading = true;
  requiresLogin = false;
  errorMessage = '';
  actionMessage = '';
  editingMapId: string | null = null;
  editedTitle = '';
  private readonly pendingMapIds = new Set<string>();

  ngOnInit(): void {
    if (!this.isBrowser) return;
    const token = this.getToken();
    if (!token) {
      this.requiresLogin = true;
      this.isLoading = false;
      return;
    }

    this.http.get<unknown>('/api/saved-maps/mine', {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
    }).subscribe({
      next: (response) => {
        if (!Array.isArray(response)) {
          this.errorMessage = 'Dữ liệu map đã lưu nhận được không hợp lệ.';
        } else {
          this.maps = response.flatMap((record): SavedMap[] => {
            if (!this.isRecord(record)) return [];
            const id = this.text(record['id'] ?? record['_id']);
            const mapId = this.text(record['mapId']);
            const title = this.text(record['title']);
            if (!id || !mapId || !title) return [];
            return [{
              id,
              mapId,
              title,
              author: this.text(record['author']),
              image: this.normalizeImage(this.text(record['image'])),
            }];
          });
        }
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => this.handleError(error),
    });
  }

  beginEdit(map: SavedMap): void {
    this.editingMapId = map.id;
    this.editedTitle = map.title;
    this.actionMessage = '';
  }

  cancelEdit(): void {
    this.editingMapId = null;
    this.editedTitle = '';
  }

  saveTitle(map: SavedMap): void {
    const title = this.editedTitle.trim();
    const token = this.getToken();
    if (!token) {
      this.requiresLogin = true;
      return;
    }
    if (!title || title.length > 120) {
      this.actionMessage = 'Tên map phải có từ 1 đến 120 ký tự.';
      return;
    }
    if (this.pendingMapIds.has(map.id)) return;

    this.pendingMapIds.add(map.id);
    this.actionMessage = '';
    this.http.patch<unknown>(`/api/saved-maps/mine/${encodeURIComponent(map.mapId)}`, { title }, {
      headers: this.authorizationHeaders(token),
    }).subscribe({
      next: () => {
        this.maps = this.maps.map((savedMap) => savedMap.id === map.id
          ? { ...savedMap, title }
          : savedMap);
        this.pendingMapIds.delete(map.id);
        this.cancelEdit();
        this.actionMessage = 'Đã cập nhật tên map.';
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => this.handleActionError(error, map.id, 'cập nhật'),
    });
  }

  async removeMap(map: SavedMap): Promise<void> {
    if (!this.isBrowser) return;
    const confirmed = await this.dialogService.confirm(`Bỏ "${map.title}" khỏi kho map đã lưu?`, 'Xác nhận xóa map', 'Xóa bỏ', 'Giữ lại');
    if (!confirmed) return;
    const token = this.getToken();
    if (!token) {
      this.requiresLogin = true;
      return;
    }
    if (this.pendingMapIds.has(map.id)) return;

    this.pendingMapIds.add(map.id);
    this.actionMessage = '';
    this.http.delete<unknown>(`/api/saved-maps/mine/${encodeURIComponent(map.mapId)}`, {
      headers: this.authorizationHeaders(token),
    }).subscribe({
      next: () => {
        this.maps = this.maps.filter((savedMap) => savedMap.id !== map.id);
        this.pendingMapIds.delete(map.id);
        this.actionMessage = `Đã bỏ "${map.title}" khỏi kho map.`;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => this.handleActionError(error, map.id, 'xóa'),
    });
  }

  isPending(mapId: string): boolean {
    return this.pendingMapIds.has(mapId);
  }

  private getToken(): string {
    const token = localStorage.getItem('authToken');
    return localStorage.getItem('isLoggedIn') === 'true' ? token || '' : '';
  }

  private handleError(error: unknown): void {
    console.error('Không thể tải kho map đã lưu:', error);
    this.errorMessage = error instanceof HttpErrorResponse && error.status === 401
      ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
      : 'Không thể tải kho map đã lưu.';
    this.isLoading = false;
    this.changeDetectorRef.markForCheck();
  }

  private handleActionError(error: unknown, mapId: string, action: string): void {
    console.error(`Không thể ${action} map đã lưu:`, error);
    this.pendingMapIds.delete(mapId);
    this.actionMessage = error instanceof HttpErrorResponse && error.status === 401
      ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
      : error instanceof HttpErrorResponse && error.status === 404
        ? 'Map này không còn trong kho đã lưu.'
        : `Không thể ${action} map. Vui lòng thử lại.`;
    this.changeDetectorRef.markForCheck();
  }

  private authorizationHeaders(token: string): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  private text(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  }

  private normalizeImage(value: string): string {
    if (value.startsWith('/images/')) return `/api${value}`;
    if (value.startsWith('images/')) return `/api/${value}`;
    return value;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
