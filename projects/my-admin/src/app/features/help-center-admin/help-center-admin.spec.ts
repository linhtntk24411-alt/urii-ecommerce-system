import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HelpCenterAdmin } from './help-center-admin';

describe('HelpCenterAdmin', () => {
  let component: HelpCenterAdmin;
  let fixture: ComponentFixture<HelpCenterAdmin>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HelpCenterAdmin],
    }).compileComponents();

    fixture = TestBed.createComponent(HelpCenterAdmin);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
