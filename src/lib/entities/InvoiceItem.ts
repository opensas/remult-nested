import { Entity, Fields, Relations, Validators, isBackend } from 'remult';
import { Invoice } from './Invoice.ts';
import { Product } from './Product.ts';
import { Discount } from './Discount.ts';

// A product on an invoice (many to many between invoices and products, with quantity).
// nestedOnly: only reachable as /api/invoices/:invoicesId/items[/:id], /api/invoice_items is 404.
@Entity<InvoiceItem>('invoice_items', {
	allowApiCrud: true,
	nestedOnly: true,
	saving: async (item, e) => {
		// No price on insert: copy the product's (relationExists already checked and loaded it).
		// From then on it's independent: changing the product or its price doesn't touch it.
		if (!isBackend()) return;
		if (e.isNew) item.unitPrice ??= item.product!.price;
		else if (item.unitPrice == null) e.fields.unitPrice.error = 'Should not be empty';
	}
})
export class InvoiceItem {
	@Fields.autoIncrement() id = 0;
	@Fields.integer() invoiceId = 0;
	@Relations.toOne<InvoiceItem, Invoice>(() => Invoice, {
		field: 'invoiceId',
		validate: Validators.relationExists
	})
	invoice?: Invoice;

	@Fields.integer() productId = 0;
	@Relations.toOne<InvoiceItem, Product>(() => Product, {
		field: 'productId',
		validate: Validators.relationExists
	})
	product?: Product;

	@Fields.integer() quantity = 1;
	// No initial value, so the hook can tell "not sent" from 0
	@Fields.number() unitPrice?: number;

	// nestedApi: also exposed as /api/invoices/:invoicesId/items/:itemsId/discounts[/:id]
	@Relations.toMany<InvoiceItem, Discount>(() => Discount, {
		field: 'invoiceItemId',
		nestedApi: true
	})
	discounts?: Discount[];
}
