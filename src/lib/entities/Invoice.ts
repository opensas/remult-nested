import { Entity, Fields, Relations } from 'remult';
import { InvoiceItem } from './InvoiceItem.ts';

@Entity<Invoice>('invoices', { allowApiCrud: true })
export class Invoice {
	@Fields.autoIncrement() id = 0;
	@Fields.string() customer = '';
	@Fields.dateOnly() date = new Date();
	@Fields.literal(() => ['draft', 'approved'] as const) status: 'draft' | 'approved' = 'draft';
	@Fields.createdAt() createdAt?: Date;

	// nestedApi: also exposed as /api/invoices/:invoicesId/items[/:id]
	@Relations.toMany<Invoice, InvoiceItem>(() => InvoiceItem, {
		field: 'invoiceId',
		nestedApi: true
	})
	items?: InvoiceItem[];
}
