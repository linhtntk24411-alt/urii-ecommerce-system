import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MapService, SampleMap } from './map.service';

describe('MapService', () => {
  let service: MapService;
  let httpTestingController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MapService);
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTestingController.verify());

  it('reads maps from the shared API and resolves their backend images', () => {
    let result: SampleMap[] = [];

    service.getMaps().subscribe((maps) => {
      result = maps;
    });

    const request = httpTestingController.expectOne('/api/maps');
    expect(request.request.method).toBe('GET');
    request.flush([{
      _id: 'map-1',
      slug: 'mau-moi',
      title: 'Mẫu mới',
      image: 'images/gallery_assets/map.webp',
    }]);

    expect(result[0].slug).toBe('mau-moi');
    expect(result[0].image).toBe('/api/images/gallery_assets/map.webp');
  });

  it('uses the Gallery map_id rather than Mongo document _id for saved-map actions', () => {
    let result: SampleMap[] = [];

    service.getMaps().subscribe((maps) => {
      result = maps;
    });

    httpTestingController.expectOne('/api/maps').flush([{
      _id: 'mongodb-document-id',
      map_id: 'M01',
      map_name: 'Map thử nghiệm',
      main_image: 'images/gallery_assets/map.webp',
    }]);

    expect(result[0].id).toBe('M01');
  });
});
