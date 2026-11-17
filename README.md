# remult-nested

Nested REST routes for [remult](https://remult.dev) + SvelteKit, on an invoicing example:

```
/api/invoices/:invoicesId/items[/:id]
/api/invoices/:invoicesId/items/:itemsId/discounts[/:id]
```

- `Invoice` has many `InvoiceItem`s (`invoice_items`), the many to many between invoices and the
  `Product` catalog, with a quantity. `unitPrice` is optional on insert: when missing, the
  product's price is copied on the server (a `saving` hook). From then on it's independent of the
  product and only changes by hand.
- Each `InvoiceItem` has its `Discount`s.
- remult doesn't check foreign keys: `Validators.relationExists` on each `toOne` relation answers
  400 when the invoice, product or item doesn't exist.
- The url segment comes from the relation name (`Invoice.items`), not from the table.

Opt in on a `toMany` relation with `nestedApi: true`:

```ts
@Relations.toMany<Invoice, InvoiceItem>(() => InvoiceItem, { field: 'invoiceId', nestedApi: true })
items?: InvoiceItem[]
```

Each nested call checks every parent in the chain (api rules, `apiPrefilter`, that the child
belongs to the parent), then forwards to the flat remult route with the relation scope added:

- the foreign key comes from the url and is forced on `POST`/`PUT` (a child can't be moved out)
- url and body filters can't widen the scope
- `deleteMany`/`updateMany` still require a filter
- the OpenAPI spec gets the nested paths too (`nestedOpenApi`)

To expose an entity only under its parent, add `nestedOnly: true` to its options: the flat
`/api/invoice_items` and `/api/discounts` answer 404 and leave the OpenAPI spec.

```ts
@Entity<Discount>('discounts', { allowApiCrud: true, nestedOnly: true })
```

The nested routes still work, since they call the remult handler directly. Anything else that uses
the flat route does not: `repo(Discount)` from the browser and those entities in
the remult admin.

## Run

```sh
pnpm install
pnpm dev
```

- http://localhost:5173/api/docs: Swagger UI with the nested routes
- http://localhost:5173/api/admin: remult admin
- `db/*.json` comes with sample data (remult's JSON file storage); delete it to start empty

[`docs/nested.rest`](docs/nested.rest) walks through every route, including the cases that must
fail, for the VS Code REST Client extension.

## Files

- [`src/lib/server/remult-nested-api.ts`](src/lib/server/remult-nested-api.ts): `nestedApi` and
  `nestedOpenApi`
- [`src/lib/server/nested-api.check.ts`](src/lib/server/nested-api.check.ts): scope and security
  checks, `pnpm test`
- [`src/lib/entities`](src/lib/entities): `Invoice`, `Product`, `InvoiceItem`,
  `Discount`
- [`src/routes/api/[...remult]/+server.ts`](src/routes/api/[...remult]/+server.ts): plugs
  `nestedApi` in front of remult
- [`src/routes/api/openapi.json/+server.ts`](src/routes/api/openapi.json/+server.ts): spec with
  the nested routes
