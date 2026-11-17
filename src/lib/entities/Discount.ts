import { Entity, Fields, Relations, Validators } from 'remult';
import { InvoiceItem } from './InvoiceItem.ts';

// nestedOnly: only reachable as /api/invoices/:invoicesId/items/:itemsId/discounts[/:id]
@Entity<Discount>('discounts', { allowApiCrud: true, nestedOnly: true })
export class Discount {
	@Fields.autoIncrement() id = 0;
	@Fields.integer() invoiceItemId = 0;
	@Relations.toOne<Discount, InvoiceItem>(() => InvoiceItem, {
		field: 'invoiceItemId',
		validate: Validators.relationExists
	})
	invoiceItem?: InvoiceItem;

	@Fields.string() description = '';
	@Fields.number() percent = 0;
}
