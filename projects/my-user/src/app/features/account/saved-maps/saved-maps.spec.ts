import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SavedMaps } from './saved-maps';

describe('SavedMaps', () => {
  let fixture: ComponentFixture<SavedMaps>;
  let component: SavedMaps;
  let httpTestingController: HttpTestingController;

  beforeEach(async () => {
    localStorage.setItem('authToken', 'customer-token');
    localStorage.setItem('isLoggedIn', 'true');
    await TestBed.configureTestingModule({
      imports: [SavedMaps],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(SavedMaps);
    component = fixture.componentInstance;
    httpTestingController = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpTestingController.expectOne('/api/saved-maps/mine').flush([{
      id: 'saved-1',
      mapId: 'M01',
      title: 'Map gốc',
      author: 'Urii',
      image: '',
    }]);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpTestingController.verify();
    localStorage.removeItem('authToken');
    localStorage.removeItem('isLoggedIn');
  });

  it('loads the signed-in customer saved maps from the API', () => {
    expect(component.maps).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('Map gốc');
  });

  it('persists renamed map titles through the customer API', () => {
    component.beginEdit(component.maps[0]);
    component.editedTitle = 'Map cá nhân';
    component.saveTitle(component.maps[0]);

    const request = httpTestingController.expectOne('/api/saved-maps/mine/M01');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ title: 'Map cá nhân' });
    expect(request.request.headers.get('Authorization')).toBe('Bearer customer-token');
    request.flush({ id: 'saved-1', title: 'Map cá nhân' });

    expect(component.maps[0].title).toBe('Map cá nhân');
    expect(component.editingMapId).toBeNull();
  });

  it('removes a map from the signed-in customer collection through the API', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    component.removeMap(component.maps[0]);

    const request = httpTestingController.expectOne('/api/saved-maps/mine/M01');
    expect(request.request.method).toBe('DELETE');
    expect(request.request.headers.get('Authorization')).toBe('Bearer customer-token');
    request.flush({ message: 'Đã bỏ lưu map.' });

    expect(component.maps).toHaveLength(0);
  });
});
