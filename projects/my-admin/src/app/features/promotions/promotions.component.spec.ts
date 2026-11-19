import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { NEVER, of, Subject } from 'rxjs';
import { AdminApiService } from '../../core/services/admin-api.service';
import { AdminSocketService } from '../../core/services/admin-socket.service';
import { PromotionsComponent } from './promotions.component';

describe('PromotionsComponent voucher usage', () => {
  it('refreshes the displayed used count after a socket update', async () => {
    const changes = new Subject<void>();
    const voucher = { _id: 'fixture', code: 'TEST', name: 'Test', quantity: 3, used: 0 };
    const getPromotions = vi.fn().mockResolvedValue([voucher]);
    TestBed.configureTestingModule({
      imports: [PromotionsComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: AdminApiService, useValue: { getInitialPromotions: () => [voucher], getPromotions } },
        { provide: AdminSocketService, useValue: { onCrudChange: (resource: string) => resource === 'voucherUsage' ? changes : NEVER } },
      ],
    });
    const fixture = TestBed.createComponent(PromotionsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('0/3');

    getPromotions.mockResolvedValue([{ ...voucher, used: 1 }]);
    changes.next();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('1/3');
    });
  });
});
