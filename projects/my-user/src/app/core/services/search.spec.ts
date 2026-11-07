import { TestBed } from '@angular/core/testing';
import { lastValueFrom, of, Subject } from 'rxjs';
import { BlogPost, BlogService } from './blog.service';
import { MapService, SampleMap } from './map.service';
import { CatalogProduct, ProductCatalogService } from './product-catalog.service';
import { Search, SearchResponse } from './search';

const products: CatalogProduct[] = [{
  id: 'real-product-id',
  slug: 'ban-ui-mini',
  name: 'Bàn ủi mini làm hạt nhựa',
  description: 'Dụng cụ ủi cho sản phẩm handmade.',
  category: 'Dụng cụ',
  image: '',
  price: 100000,
  variants: [],
}];

const blogs: BlogPost[] = [{
  id: 'real-blog-id',
  slug: 'huong-dan-diy-moc-khoa',
  title: 'Hướng dẫn DIY móc khóa',
  summary: 'Cách làm móc khóa thủ công.',
  excerpt: 'Tự làm móc khóa.',
  content: 'Hướng dẫn từng bước làm móc khóa.',
  author: 'Urii',
  avatar: '',
  date: '',
  image: '',
  category: 'Hướng dẫn DIY',
  categorySlug: 'huong-dan-diy',
  likes: 0,
  comments: 0,
  views: 0,
  isFeatured: false,
  tags: ['móc khóa'],
}];

const maps: SampleMap[] = [{
  id: 'real-map-id',
  slug: 'hoa-tulip-pixel',
  title: 'Hoa tulip pixel',
  category: 'Hoa quả',
  categories: ['Hoa quả', 'Thực vật'],
  image: '',
  difficulty: 'Dễ',
  difficultyClass: 'easy',
  gridSize: '20x20',
  totalBeads: 100,
  time: '',
  isPopular: false,
  isNew: false,
}];

describe('Search', () => {
  let service: Search;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProductCatalogService,
          useValue: {
            getCachedProducts: () => products,
            getProducts: () => of(products),
          },
        },
        { provide: BlogService, useValue: { getBlogs: () => of(blogs) } },
        { provide: MapService, useValue: { getMaps: () => of(maps) } },
      ],
    });
    service = TestBed.inject(Search);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('filters real products and ranks title matches highly', async () => {
    const response = await lastValueFrom(service.search('ban ui', 'products'));

    expect(response.loading).toBe(false);
    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      category: 'products',
      id: 'real-product-id',
      slug: 'ban-ui-mini',
      score: 95,
    });
  });

  it('searches real blog posts and maps and returns their slugs', async () => {
    const blogResponse = await lastValueFrom(service.search('moc khoa', 'blogs'));
    const mapResponse = await lastValueFrom(service.search('hoa tulip', 'maps'));

    expect(blogResponse.results[0]).toMatchObject({
      id: 'real-blog-id',
      slug: 'huong-dan-diy-moc-khoa',
      title: 'Hướng dẫn DIY móc khóa',
    });
    expect(mapResponse.results[0]).toMatchObject({
      id: 'real-map-id',
      slug: 'hoa-tulip-pixel',
      title: 'Hoa tulip pixel',
    });
  });

  it('matches Vietnamese content without requiring accents', async () => {
    const blogResponse = await lastValueFrom(service.search('moc khoa', 'blogs'));
    const mapResponse = await lastValueFrom(service.search('hoa tulip', 'maps'));

    expect(blogResponse.results[0]?.title).toBe('Hướng dẫn DIY móc khóa');
    expect(mapResponse.results[0]?.title).toBe('Hoa tulip pixel');
  });

  it('returns immediately without results for an empty query', async () => {
    const response = await lastValueFrom(service.search('   '));

    expect(response).toEqual({ results: [], loading: false });
  });
});

describe('Search progressive results', () => {
  let service: Search;
  let blogs$: Subject<BlogPost[]>;
  let maps$: Subject<SampleMap[]>;
  const blogResults: BlogPost[] = [{
    ...blogs[0],
    id: 'blog-1',
    slug: 'hoa-tulip',
    title: 'Hoa tulip handmade',
  }];
  const mapResults: SampleMap[] = [{
    ...maps[0],
    id: 'map-1',
    slug: 'hoa-tulip-pixel',
  }];

  beforeEach(() => {
    blogs$ = new Subject<BlogPost[]>();
    maps$ = new Subject<SampleMap[]>();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProductCatalogService,
          useValue: { getCachedProducts: () => [], getProducts: () => of([]) },
        },
        { provide: BlogService, useValue: { getBlogs: () => blogs$ } },
        { provide: MapService, useValue: { getMaps: () => maps$ } },
      ],
    });
    service = TestBed.inject(Search);
  });

  it('emits available category results without waiting for slower APIs', () => {
    const responses: SearchResponse[] = [];
    service.search('hoa', 'all').subscribe((response) => responses.push(response));

    expect(responses[0]).toEqual({ results: [], loading: true });

    maps$.next(mapResults);
    expect(responses.some((response) =>
      response.loading && response.results.some((result) => result.slug === 'hoa-tulip-pixel'),
    )).toBe(true);

    blogs$.next(blogResults);
    blogs$.complete();
    maps$.complete();

    expect(responses.at(-1)?.loading).toBe(false);
  });
});
