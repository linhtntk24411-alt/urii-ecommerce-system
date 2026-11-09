import '@angular/compiler';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MyVouchers } from './my-vouchers';

describe('MyVouchers', () => {
  let fixture: ComponentFixture<MyVouchers>;
  let component: MyVouchers;
  let httpTestingController: HttpTestingController;

  const mockVouchers = [
    {
      _id: 'uv-1',
      voucherId: 'FREESHIP',
      code: 'FREESHIP',
      isUsed: false,
      claimedAt: '2026-05-10T08:30:00.000Z',
      voucher: {
        id: 'FREESHIP',
        code: 'FREESHIP',
        name: 'Miễn phí vận chuyển',
        description: 'Giảm tối đa 30.000đ phí vận chuyển',
        type: 'shipping' as const,
        discountValue: 30000,
        minOrder: 100000,
        maxDiscount: 30000,
        endDate: '31/12/2026',
        isActive: true,
      },
    },
    {
      _id: 'uv-2',
      voucherId: 'GIAM10K',
      code: 'GIAM10K',
      isUsed: true,
      claimedAt: '2026-05-10T08:32:00.000Z',
      voucher: {
        id: 'GIAM10K',
        code: 'GIAM10K',
        name: 'Giảm ngay 10.000đ',
        description: 'Giảm 10.000đ cho đơn từ 50.000đ',
        type: 'fixed' as const,
        discountValue: 10000,
        minOrder: 50000,
        endDate: '31/12/2026',
        isActive: true,
      },
    },
  ];

  beforeEach(async () => {
    localStorage.setItem('authToken', 'customer-token');
    localStorage.setItem('isLoggedIn', 'true');

    await TestBed.configureTestingModule({
      imports: [MyVouchers],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(MyVouchers);
    component = fixture.componentInstance;
    httpTestingController = TestBed.inject(HttpTestingController);

    fixture.detectChanges();

    const mineReq = httpTestingController.expectOne('/api/user-vouchers/mine');
    expect(mineReq.request.headers.get('Authorization')).toBe('Bearer customer-token');
    mineReq.flush(mockVouchers);

    const availableReq = httpTestingController.expectOne('/api/user-vouchers/available');
    availableReq.flush({
      isLoggedIn: true,
      totalActive: 4,
      claimedCount: 2,
      vouchers: [{ id: 'SALE15', code: 'SALE15', name: 'Sale 15%', discountValue: 15, type: 'percent' }],
    });

    fixture.detectChanges();
  });

  afterEach(() => {
    httpTestingController.verify();
    localStorage.removeItem('authToken');
    localStorage.removeItem('isLoggedIn');
  });

  it('loads customer vouchers and unclaimed voucher count', () => {
    expect(component.vouchers).toHaveLength(2);
    expect(component.unclaimedCount).toBe(1);
    expect(component.totalCount).toBe(2);
    expect(component.availableCount).toBe(1);
    expect(component.usedCount).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Miễn phí vận chuyển');
    expect(fixture.nativeElement.textContent).toContain('FREESHIP');
  });

  it('filters vouchers by tabs and type', () => {
    component.activeTab = 'available';
    expect(component.filteredVouchers).toHaveLength(1);
    expect(component.filteredVouchers[0].code).toBe('FREESHIP');

    component.activeTab = 'used';
    expect(component.filteredVouchers).toHaveLength(1);
    expect(component.filteredVouchers[0].code).toBe('GIAM10K');

    component.activeTab = 'all';
    component.typeFilter = 'shipping';
    expect(component.filteredVouchers).toHaveLength(1);
    expect(component.filteredVouchers[0].code).toBe('FREESHIP');
  });

  it('searches vouchers by keyword', () => {
    component.searchQuery = '10k';
    expect(component.filteredVouchers).toHaveLength(1);
    expect(component.filteredVouchers[0].code).toBe('GIAM10K');

    component.searchQuery = 'nonexistent';
    expect(component.filteredVouchers).toHaveLength(0);
  });

  it('checks voucher validity against MongoDB (valid code - pop success)', () => {
    component.inputVoucherCode = 'FREESHIP';
    component.checkVoucherCode();

    const checkReq = httpTestingController.expectOne('/api/vouchers/check/FREESHIP');
    expect(checkReq.request.method).toBe('GET');
    checkReq.flush({
      valid: true,
      code: 'FREESHIP',
      message: 'Mã voucher "FREESHIP" hoàn toàn hợp lệ và sẵn sàng sử dụng!',
      voucher: {
        id: 'FREESHIP',
        code: 'FREESHIP',
        name: 'Miễn phí vận chuyển',
        discountValue: 30000,
        type: 'shipping',
        endDate: '31/12/2026',
        isActive: true,
      },
    });

    expect(component.showResultModal).toBe(true);
    expect(component.checkResult?.valid).toBe(true);
    expect(component.checkResult?.code).toBe('FREESHIP');
  });

  it('checks voucher validity against MongoDB (invalid code - pop failure)', () => {
    component.inputVoucherCode = 'INVALID99';
    component.checkVoucherCode();

    const checkReq = httpTestingController.expectOne('/api/vouchers/check/INVALID99');
    expect(checkReq.request.method).toBe('GET');
    checkReq.flush({
      valid: false,
      code: 'INVALID99',
      reason: 'NOT_FOUND',
      message: 'Tiếc quá, chúng tớ không tìm thấy, cậu hãy nhập lại nữa nhé',
    });

    expect(component.showResultModal).toBe(true);
    expect(component.checkResult?.valid).toBe(false);
    expect(component.checkResult?.reason).toBe('NOT_FOUND');
  });

  it('claims a voucher when input code submitted', () => {
    component.inputVoucherCode = 'SALE15';
    component.claimInputCode();

    const claimReq = httpTestingController.expectOne('/api/user-vouchers/claim');
    expect(claimReq.request.method).toBe('POST');
    expect(claimReq.request.body).toEqual({ voucherId: 'SALE15' });
    claimReq.flush({ message: 'Nhận voucher thành công!' });

    // Expect refetches
    const refreshReq = httpTestingController.expectOne('/api/user-vouchers/mine');
    refreshReq.flush([...mockVouchers, {
      _id: 'uv-3',
      voucherId: 'SALE15',
      code: 'SALE15',
      isUsed: false,
      voucher: { id: 'SALE15', code: 'SALE15', name: 'Sale 15%', discountValue: 15, type: 'percent', endDate: '31/12/2026' }
    }]);

    const availRefresh = httpTestingController.expectOne('/api/user-vouchers/available');
    availRefresh.flush({ isLoggedIn: true, totalActive: 4, claimedCount: 3, vouchers: [] });

    expect(component.inputVoucherCode).toBe('');
    expect(component.vouchers).toHaveLength(3);
  });
});
