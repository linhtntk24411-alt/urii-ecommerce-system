import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

export interface AddressArea {
  code: number;
  name: string;
}

@Injectable({ providedIn: 'root' })
export class AddressLookupService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = 'https://provinces.open-api.vn/api/v2';

  getProvinces(): Observable<AddressArea[]> {
    return this.http.get<unknown>(`${this.apiBase}/p/`).pipe(
      map((response) => this.parseAreas(response)),
    );
  }

  getWards(provinceCode: number): Observable<AddressArea[]> {
    return this.http.get<unknown>(`${this.apiBase}/p/${provinceCode}?depth=2`).pipe(
      map((response) => {
        if (!this.isRecord(response) || !Array.isArray(response['wards'])) {
          throw new Error('Dữ liệu phường/xã trả về không hợp lệ.');
        }
        return this.parseAreas(response['wards']);
      }),
    );
  }

  private parseAreas(response: unknown): AddressArea[] {
    if (!Array.isArray(response)) {
      throw new Error('Danh sách địa chỉ trả về không hợp lệ.');
    }

    return response.flatMap((entry): AddressArea[] => {
      if (!this.isRecord(entry)) return [];
      const code = Number(entry['code']);
      const name = entry['name'];
      return Number.isInteger(code) && typeof name === 'string'
        ? [{ code, name }]
        : [];
    });
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
