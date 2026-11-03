import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SupportComponent } from './support';

describe('SupportComponent', () => {
  let component: SupportComponent;
  let fixture: ComponentFixture<SupportComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SupportComponent],
      providers: [
        provideRouter([
          { path: 'support', component: SupportComponent },
          { path: 'support/:tab', component: SupportComponent },
        ]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SupportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should toggle an FAQ answer open and closed', () => {
    component.toggleFaq(0);
    expect(component.activeFaqIndex).toBe(0);

    component.toggleFaq(0);
    expect(component.activeFaqIndex).toBeNull();
  });

  it('should update the selected tab after navigating to a support route', async () => {
    const router = TestBed.inject(Router);

    await router.navigateByUrl('/support/faq');
    expect(component.activeTab).toBe('faq');

    await router.navigateByUrl('/support/privacy-policy');
    expect(component.activeTab).toBe('privacy-policy');

    await router.navigateByUrl('/support/terms-of-service');
    expect(component.activeTab).toBe('terms-of-service');
  });
});
