import { Injectable } from '@angular/core';
import { BlogPost, BlogService } from './blog.service';
import { MapService, SampleMap } from './map.service';
import { CatalogProduct, ProductCatalogService } from './product-catalog.service';
import { catchError, concatWith, map, merge, Observable, of, scan, shareReplay, startWith, throwError } from 'rxjs';

export type SearchCategory = 'all' | 'products' | 'maps' | 'blogs';
export type SearchResultCategory = Exclude<SearchCategory, 'all'>;

export interface SearchResult {
  id: string;
  title: string;
  description: string;
  category: SearchResultCategory;
  slug: string;
  score: number;
}

export interface SearchResponse {
  results: SearchResult[];
  loading: boolean;
}

interface SearchUpdate {
  category: SearchResultCategory;
  results?: SearchResult[];
  done?: boolean;
}

interface SearchState {
  resultsByCategory: Partial<Record<SearchResultCategory, SearchResult[]>>;
  pendingCategories: Set<SearchResultCategory>;
}

@Injectable({ providedIn: 'root' })
export class Search {
  private products$?: Observable<CatalogProduct[]>;
  private blogs$?: Observable<BlogPost[]>;
  private maps$?: Observable<SampleMap[]>;

  constructor(
    private readonly productCatalog: ProductCatalogService,
    private readonly blogService: BlogService,
    private readonly mapService: MapService,
  ) {}

  search(query: string, category: SearchCategory = 'all'): Observable<SearchResponse> {
    const normalizedQuery = this.normalize(query.trim());
    if (!normalizedQuery) return of({ results: [], loading: false });

    const sources: Observable<SearchUpdate>[] = [];
    const categories: SearchResultCategory[] = [];
    if (category === 'all' || category === 'products') {
      categories.push('products');
      const cached = this.filterProducts(this.productCatalog.getCachedProducts(), normalizedQuery);
      const products$ = this.loadProducts().pipe(
        map((products) => this.filterProducts(products, normalizedQuery)),
      );
      const updates$ = this.categoryUpdates(
        'products',
        cached.length ? products$.pipe(startWith(cached)) : products$,
        'Không thể tải sản phẩm cho gợi ý tìm kiếm:',
        cached,
      );
      sources.push(updates$);
    }
    if (category === 'all' || category === 'blogs') {
      categories.push('blogs');
      sources.push(this.categoryUpdates(
        'blogs',
        this.loadBlogs().pipe(map((blogs) => this.filterBlogs(blogs, normalizedQuery))),
        'Không thể tải bài viết cho gợi ý tìm kiếm:',
      ));
    }
    if (category === 'all' || category === 'maps') {
      categories.push('maps');
      sources.push(this.categoryUpdates(
        'maps',
        this.loadMaps().pipe(map((maps) => this.filterMaps(maps, normalizedQuery))),
        'Không thể tải map cho gợi ý tìm kiếm:',
      ));
    }

    const initialState: SearchState = {
      resultsByCategory: {},
      pendingCategories: new Set(categories),
    };

    return merge(...sources).pipe(
      scan((state, update): SearchState => {
        const resultsByCategory = { ...state.resultsByCategory };
        const pendingCategories = new Set(state.pendingCategories);
        if (update.done) {
          pendingCategories.delete(update.category);
        } else {
          resultsByCategory[update.category] = update.results ?? [];
        }
        return { resultsByCategory, pendingCategories };
      }, initialState),
      startWith(initialState),
      map((state): SearchResponse => ({
        results: Object.values(state.resultsByCategory)
          .flatMap((results) => results ?? [])
          .sort((left, right) => right.score - left.score),
        loading: state.pendingCategories.size > 0,
      })),
    );
  }

  private categoryUpdates(
    category: SearchResultCategory,
    source: Observable<SearchResult[]>,
    errorMessage: string,
    fallback: SearchResult[] = [],
  ): Observable<SearchUpdate> {
    return source.pipe(
      catchError((error: unknown) => {
        console.error(errorMessage, error);
        return of(fallback);
      }),
      map((results): SearchUpdate => ({ category, results })),
      concatWith(of({ category, done: true })),
    );
  }

  private loadProducts(): Observable<CatalogProduct[]> {
    if (!this.products$) {
      this.products$ = this.productCatalog.getProducts().pipe(
        catchError((error: unknown) => {
          this.products$ = undefined;
          return throwError(() => error);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }

    return this.products$;
  }

  private loadBlogs(): Observable<BlogPost[]> {
    if (!this.blogs$) {
      this.blogs$ = this.blogService.getBlogs().pipe(
        catchError((error: unknown) => {
          this.blogs$ = undefined;
          return throwError(() => error);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.blogs$;
  }

  private loadMaps(): Observable<SampleMap[]> {
    if (!this.maps$) {
      this.maps$ = this.mapService.getMaps().pipe(
        catchError((error: unknown) => {
          this.maps$ = undefined;
          return throwError(() => error);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.maps$;
  }

  private filterProducts(products: CatalogProduct[], query: string): SearchResult[] {
    return products.flatMap((product): SearchResult[] => {
      const title = this.normalize(product.name);
      const score = this.matchScore(query, title, [
        product.description,
        product.category,
      ].map((value) => this.normalize(value)).join(' '));
      return score === null ? [] : [{
        id: product.id,
        slug: product.slug,
        title: product.name,
        description: product.description || product.category || 'Sản phẩm Urii',
        category: 'products',
        score,
      }];
    }).sort((left, right) => right.score - left.score);
  }

  private filterBlogs(blogs: BlogPost[], query: string): SearchResult[] {
    return blogs.flatMap((blog): SearchResult[] => {
      const description = [blog.summary, blog.excerpt, blog.content, blog.category, ...blog.tags]
        .map((value) => this.normalize(value))
        .join(' ');
      const score = this.matchScore(query, this.normalize(blog.title), description);
      return score === null ? [] : [{
        id: String(blog.id),
        slug: blog.slug,
        title: blog.title,
        description: blog.summary || blog.excerpt || blog.category || 'Bài viết Blog Urii',
        category: 'blogs',
        score,
      }];
    }).sort((left, right) => right.score - left.score);
  }

  private filterMaps(maps: SampleMap[], query: string): SearchResult[] {
    return maps.flatMap((sampleMap): SearchResult[] => {
      const description = [
        sampleMap.category,
        ...sampleMap.categories,
        sampleMap.difficulty,
        'map mẫu',
      ].map((value) => this.normalize(value)).join(' ');
      const score = this.matchScore(query, this.normalize(sampleMap.title), description);
      return score === null ? [] : [{
        id: sampleMap.id,
        slug: sampleMap.slug,
        title: sampleMap.title,
        description: `${sampleMap.category} · ${sampleMap.difficulty}`,
        category: 'maps',
        score,
      }];
    }).sort((left, right) => right.score - left.score);
  }

  private matchScore(query: string, title: string, description: string): number | null {
    const queryWords = query.split(/\s+/).filter(Boolean);
    const searchable = `${title} ${description}`;
    if (queryWords.some((word) => !searchable.includes(word))) return null;
    if (title === query) return 100;
    if (title.startsWith(query)) return 95;
    if (title.includes(query)) return 90;
    if (queryWords.every((word) => title.includes(word))) return 88;
    return queryWords.some((word) => title.includes(word)) ? 75 : 65;
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLocaleLowerCase('vi');
  }
}
