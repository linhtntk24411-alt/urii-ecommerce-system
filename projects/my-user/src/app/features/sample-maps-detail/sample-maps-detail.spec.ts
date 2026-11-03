import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SampleMapsDetail } from './sample-maps-detail';

describe('SampleMapsDetail', () => {
  let component: SampleMapsDetail;
  let fixture: ComponentFixture<SampleMapsDetail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SampleMapsDetail],
    }).compileComponents();

    fixture = TestBed.createComponent(SampleMapsDetail);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
