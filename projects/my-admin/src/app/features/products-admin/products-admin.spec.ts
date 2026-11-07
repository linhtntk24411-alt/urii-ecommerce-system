import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProductsAdmin } from './products-admin';

describe('ProductsAdmin', () => {
  let component: ProductsAdmin;
  let fixture: ComponentFixture<ProductsAdmin>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductsAdmin]
    })
      .compileComponents();

    fixture = TestBed.createComponent(ProductsAdmin);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
