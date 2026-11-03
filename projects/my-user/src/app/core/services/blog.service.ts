import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

export interface BlogPost {
  id: string | number;
  slug: string;
  title: string;
  summary: string;
  excerpt: string;
  content: string;
  author: string;
  avatar: string;
  date: string;
  image: string;
  category: string;
  categorySlug: string;
  likes: number;
  comments: number;
  views: number;
  isFeatured: boolean;
  tags: string[];
}

export interface BlogComment {
  id: string | number;
  blogId: string | number;
  author: string;
  avatar: string;
  content: string;
  createdAt: string;
  time: string;
}

export interface CreateBlogPost {
  title: string;
  slug: string;
  summary: string;
  excerpt: string;
  content: string;
  author: string;
  avatar: string;
  date: string;
  image: string;
  category: string;
  categorySlug: string;
  likes: number;
  comments: number;
  views: number;
  isFeatured: boolean;
  tags: string[];
  seoTitle: string;
  seoDesc: string;
}

@Injectable({ providedIn: 'root' })
export class BlogService {
  private readonly http = inject(HttpClient);

  createBlog(blog: CreateBlogPost): Observable<unknown> {
    return this.http.post<unknown>('/api/blogs', blog);
  }

  getBlogComments(blogId: string | number): Observable<BlogComment[]> {
    return this.http.get<unknown>(`/api/blogs/${encodeURIComponent(String(blogId))}/comments`).pipe(
      map((response) => this.parseComments(response)),
    );
  }

  getBlogs(): Observable<BlogPost[]> {
    return this.http.get<unknown>('/api/blogs').pipe(
      map((response) => this.parseBlogs(response)),
    );
  }

  getBlogBySlug(slug: string): Observable<BlogPost | undefined> {
    return this.getBlogs().pipe(
      map((blogs) => blogs.find((blog) => blog.slug === slug)),
    );
  }

  private parseBlogs(response: unknown): BlogPost[] {
    const records = Array.isArray(response)
      ? response
      : this.isRecord(response)
        ? [response['blogs'], response['data']].find(Array.isArray) ?? []
        : [];

    return records.flatMap((record): BlogPost[] => {
      if (!this.isRecord(record)) return [];

      const title = this.toText(record['title']);
      if (!title) return [];

      const slug = this.toText(record['slug']) || this.slugify(title);
      const rawId = record['id'] ?? record['_id'];
      const id = typeof rawId === 'string' || typeof rawId === 'number'
        ? rawId
        : this.isRecord(rawId) && typeof rawId['$oid'] === 'string'
          ? rawId['$oid']
          : slug;
      const categoryValue = record['category'];
      const category = this.isRecord(categoryValue)
        ? this.toText(categoryValue['name'] ?? categoryValue['title'])
        : this.toText(categoryValue);
      const summary = this.toText(record['summary'] ?? record['excerpt']);
      const date = this.toText(record['date'] ?? record['createdAt'] ?? record['updatedAt']);

      return [{
        id,
        slug,
        title,
        summary,
        excerpt: this.toText(record['excerpt'] ?? record['summary']),
        content: this.normalizeContent(record['content']),
        author: this.toText(record['author']) || 'Urii',
        avatar: this.normalizeImagePath(record['avatar']) || 'assets/gallery_assets/mau-ca-heo.webp',
        date,
        image: this.normalizeImagePath(record['image'] ?? record['coverImage']) || 'assets/gallery_assets/mau-ca-heo.webp',
        category: category || 'Khác',
        categorySlug: this.toText(record['categorySlug'] ?? record['category_slug']) || this.slugify(category || 'Khác'),
        likes: this.toNumber(record['likes']),
        comments: this.toNumber(record['comments']),
        views: this.toNumber(record['views']),
        isFeatured: record['isFeatured'] === true || record['is_featured'] === true,
        tags: this.toStringArray(record['tags']),
      }];
    });
  }

  private parseComments(response: unknown): BlogComment[] {
    const records = Array.isArray(response)
      ? response
      : this.isRecord(response) && Array.isArray(response['comments'])
        ? response['comments']
        : [];

    return records.flatMap((record): BlogComment[] => {
      if (!this.isRecord(record)) return [];

      const content = this.toText(record['content']);
      if (!content) return [];

      const rawId = record['id'] ?? record['_id'];
      const id = typeof rawId === 'string' || typeof rawId === 'number'
        ? rawId
        : this.isRecord(rawId) && typeof rawId['$oid'] === 'string'
          ? rawId['$oid']
          : '';
      const rawBlogId = record['blogId'] ?? record['blog_id'];
      const blogId = typeof rawBlogId === 'string' || typeof rawBlogId === 'number'
        ? rawBlogId
        : '';
      const createdAtValue = record['createdAt'] ?? record['updatedAt'];
      const createdAt = createdAtValue instanceof Date
        ? createdAtValue.toISOString()
        : this.toText(createdAtValue);
      const avatar = this.normalizeImagePath(record['avatar']);

      return [{
        id: id || `${blogId}-${createdAt}-${content.slice(0, 20)}`,
        blogId,
        author: this.toText(record['author']) || 'Khách hàng',
        avatar: avatar || 'assets/avatar-non.jpg',
        content,
        createdAt,
        time: this.toText(record['time']),
      }];
    });
  }

  private normalizeImagePath(value: unknown): string {
    const path = this.toText(value);
    if (path.startsWith('images/')) return `/assets/${path.slice('images/'.length)}`;
    if (path.startsWith('/images/')) return `/assets/${path.slice('/images/'.length)}`;
    return path;
  }

  private normalizeContent(value: unknown): string {
    return this.toText(value).replace(/(["'])\/?images\//g, '$1/assets/');
  }

  private toStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}