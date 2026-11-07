import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SupportAdmin } from './support-admin';

describe('SupportAdmin', () => {
  let component: SupportAdmin;
  let fixture: ComponentFixture<SupportAdmin>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SupportAdmin],
    }).compileComponents();

    fixture = TestBed.createComponent(SupportAdmin);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
