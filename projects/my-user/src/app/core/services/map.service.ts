import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

export interface SampleMap {
  id: string;
  slug: string;
  title: string;
  category: string;
  categories: string[];
  image: string;
  difficulty: string;
  difficultyClass: string;
  gridSize: string;
  totalBeads: number;
  time: string;
  isPopular: boolean;
  isNew: boolean;
}

@Injectable({ providedIn: 'root' })
export class MapService {
  private readonly http = inject(HttpClient);

  getMaps(): Observable<SampleMap[]> {
    return this.http.get<unknown>('/api/maps').pipe(
      map((response) => this.parseMaps(response)),
    );
  }

  getMapBySlug(slug: string): Observable<SampleMap | undefined> {
    return this.getMaps().pipe(
      map((maps) => maps.find((sampleMap) => sampleMap.slug === slug)),
    );
  }

  getMapById(id: string): Observable<SampleMap | undefined> {
    return this.getMaps().pipe(
      map((maps) => maps.find((sampleMap) => sampleMap.id === id)),
    );
  }

  private parseMaps(response: unknown): SampleMap[] {
    const records = Array.isArray(response)
      ? response
      : this.isRecord(response)
        ? ['maps', 'samplemaps', 'sampleMaps', 'data']
          .map((key) => response[key])
          .find(Array.isArray) ?? []
        : [];

    return records.flatMap((record): SampleMap[] => {
      if (!this.isRecord(record)) return [];

      const rawId = record['id'] ?? record['_id'] ?? record['map_id'];
      const id = typeof rawId === 'string' || typeof rawId === 'number'
        ? String(rawId)
        : this.isRecord(rawId) && typeof rawId['$oid'] === 'string'
          ? rawId['$oid']
          : null;
      const title = record['title'] ?? record['map_name'] ?? record['name'];
      if (id === null || typeof title !== 'string' || !title.trim()) return [];

      const categories = this.toStringArray(record['categories'] ?? record['category']);
      const difficulty = this.normalizeDifficulty(record['difficulty']);
      const rawImage = record['image'] ?? record['main_image'] ?? record['imageUrl'] ?? record['images'];
      const image = this.normalizeImage(rawImage);

      return [{
        id,
        slug: this.toText(record['slug']) || this.slugify(title),
        title: title.trim(),
        category: categories[0] ?? 'Khác',
        categories: categories.length ? categories : ['Khác'],
        image,
        difficulty,
        difficultyClass: this.toText(record['difficultyClass'] ?? record['difficulty_class'])
          || this.getDifficultyClass(difficulty),
        gridSize: this.toText(record['gridSize'] ?? record['grid_size']) || 'Đang cập nhật',
        totalBeads: this.toNumber(record['totalBeads'] ?? record['total_beads'] ?? record['beadCount']),
        time: this.toText(record['time'] ?? record['estimatedTime'] ?? record['duration']),
        isPopular: record['isPopular'] === true || record['is_popular'] === true,
        isNew: record['isNew'] === true || record['is_new'] === true,
      }];
    });
  }

  private normalizeImage(value: unknown): string {
    const image = typeof value === 'string'
      ? value.trim()
      : Array.isArray(value) && typeof value[0] === 'string'
        ? value[0].trim()
        : '';

    if (!image) return 'assets/gallery_assets/mau-ca-heo.webp';
    if (image.startsWith('images/gallery_assets/')) {
      return `/assets/${image.slice('images/'.length)}`;
    }

    return image;
  }

  private toStringArray(value: unknown): string[] {
    const values = Array.isArray(value) ? value : [value];
    return values.flatMap((item): string[] => {
      const text = this.isRecord(item)
        ? this.toText(item['name'] ?? item['title'])
        : this.toText(item);
      return text ? [text] : [];
    });
  }

  private toText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private toNumber(value: unknown): number {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  private slugify(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private normalizeDifficulty(value: unknown): string {
    const difficulty = this.toText(value);
    const normalized = difficulty.toLocaleLowerCase();
    if (normalized.includes('easy') || normalized.includes('dễ')) return 'Dễ';
    if (normalized.includes('hard') || normalized.includes('khó')) return 'Khó';
    if (normalized.includes('medium') || normalized.includes('trung bình')) return 'Trung bình';
    return difficulty || 'Chưa rõ';
  }

  private getDifficultyClass(difficulty: string): string {
    if (difficulty === 'Dễ') return 'badge-easy';
    if (difficulty === 'Khó') return 'badge-hard';
    return 'badge-medium';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}