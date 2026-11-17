import { Invoice } from '#lib/entities/Invoice.ts';
import { Product } from '#lib/entities/Product.ts';
import { InvoiceItem } from '#lib/entities/InvoiceItem.ts';
import { Discount } from '#lib/entities/Discount.ts';
import { remultApi } from 'remult/remult-sveltekit';

export const entities = [Invoice, Product, InvoiceItem, Discount];

// No dataProvider: remult stores each entity as a JSON file in ./db
export const api = remultApi({
	entities,
	admin: true
});
