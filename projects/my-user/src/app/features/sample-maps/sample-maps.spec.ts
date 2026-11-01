import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SampleMaps } from './sample-maps';

describe('SampleMaps', () => {
  let component: SampleMaps;
  let fixture: ComponentFixture<SampleMaps>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SampleMaps],
    }).compileComponents();

    fixture = TestBed.createComponent(SampleMaps);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
