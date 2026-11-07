import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MapAdmin } from './map-admin';

describe('MapAdmin', () => {
  let component: MapAdmin;
  let fixture: ComponentFixture<MapAdmin>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapAdmin],
    }).compileComponents();

    fixture = TestBed.createComponent(MapAdmin);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
