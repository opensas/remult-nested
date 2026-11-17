import { Entity, Fields } from 'remult';

// Product catalog
@Entity<Product>('products', { allowApiCrud: true })
export class Product {
	@Fields.autoIncrement() id = 0;
	@Fields.string() name = '';
	@Fields.number() price = 0;
}
