import assert from 'node:assert/strict';
import type { RequestEvent } from '@sveltejs/kit';
import { Entity, Fields, InMemoryDataProvider, Relations, Remult, remult } from 'remult';
import { remultApi } from 'remult/remult-sveltekit';
import { nestedApi, nestedOpenApi } from './remult-nested-api.js'; // run: npx tsx nested-api.check.ts

let invoicesReadable = true;

@Entity<Invoice>('invoices', {
	allowApiCrud: true,
	allowApiRead: () => invoicesReadable,
	apiPrefilter: () => ({ owner: remult.user?.id ?? '-' })
})
class Invoice {
	@Fields.integer() id = 0;
	@Fields.string() owner = '';
	@Relations.toMany<Invoice, Item>(() => Item, {
		field: 'invoiceId',
		nestedApi: true,
		findOptions: { where: { archived: false } }
	})
	items?: Item[];
	@Relations.toMany<Invoice, Item>(() => Item, 'invoiceId')
	notExposed?: Item[];
}

@Entity<Item>('items', { allowApiCrud: true })
class Item {
	@Fields.integer() id = 0;
	@Fields.integer() invoiceId = 0;
	@Fields.string() name = '';
	@Fields.boolean() archived = false;
	@Relations.toMany<Item, Discount>(() => Discount, {
		field: 'itemId',
		nestedApi: true
	})
	discounts?: Discount[];
}

@Entity<Discount>('discounts', { allowApiCrud: true, nestedOnly: true })
class Discount {
	@Fields.integer() id = 0;
	@Fields.integer() itemId = 0;
	@Fields.number() percent = 0;
}

@Entity<Category>('categories', { allowApiCrud: true })
class Category {
	@Fields.integer() id = 0;
	@Fields.integer() parentId = 0;
	@Relations.toMany<Category, Category>(() => Category, {
		field: 'parentId',
		nestedApi: true
	})
	children?: Category[];
}

@Entity<Line>('order-lines', { allowApiCrud: true, id: ['orderNo', 'lineNo'] })
class Line {
	@Fields.string() orderNo = '';
	@Fields.integer() lineNo = 0;
	@Relations.toMany<Line, LineNote>(() => LineNote, {
		fields: { orderNo: 'orderNo', lineNo: 'lineNo' },
		nestedApi: true
	})
	notes?: LineNote[];
}

@Entity<LineNote>('lineNotes', { allowApiCrud: true })
class LineNote {
	@Fields.integer() id = 0;
	@Fields.string() orderNo = '';
	@Fields.integer() lineNo = 0;
	@Fields.string() text = '';
}

const entities = [Invoice, Item, Discount, Category, Line, LineNote];
let db: InMemoryDataProvider;
let handlers: ReturnType<typeof nestedApi>;
let api!: ReturnType<typeof remultApi>;

async function reset() {
	invoicesReadable = true;
	db = new InMemoryDataProvider();
	const r = new Remult(db);
	await r.repo(Invoice).insert([
		{ id: 1, owner: 'a' },
		{ id: 2, owner: 'a' },
		{ id: 3, owner: 'b' }
	]);
	await r.repo(Item).insert([
		{ id: 11, invoiceId: 1, name: 'i11' },
		{ id: 12, invoiceId: 1, name: 'i12' },
		{ id: 13, invoiceId: 1, name: 'i13', archived: true },
		{ id: 21, invoiceId: 2, name: 'i21' },
		{ id: 31, invoiceId: 3, name: 'i31' }
	]);
	await r.repo(Discount).insert([
		{ id: 111, itemId: 11, percent: 10 },
		{ id: 211, itemId: 21, percent: 20 }
	]);
	await r.repo(Category).insert([
		{ id: 1, parentId: 0 },
		{ id: 2, parentId: 1 }
	]);
	await r.repo(Line).insert([{ orderNo: 'A', lineNo: 1 }]);
	await r.repo(LineNote).insert([
		{ id: 1, orderNo: 'A', lineNo: 1, text: 'n1' },
		{ id: 2, orderNo: 'A', lineNo: 2, text: 'n2' }
	]);
	api = remultApi({
		entities,
		dataProvider: db,
		logApiEndPoints: false,
		getUser: async (e) => {
			const id = e.request.headers.get('x-user');
			return id ? { id } : undefined;
		}
	});
	handlers = nestedApi(api, { entities });
}

async function call(method: string, path: string, body?: unknown, user = 'a') {
	const url = new URL('http://localhost' + path);
	const request = new Request(url, {
		method,
		headers: { 'x-user': user, 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const event = {
		request,
		url,
		locals: {},
		params: {}
	} as unknown as RequestEvent;
	const res = await (handlers as any)[method](event);
	const text = await res.text();
	let data: any = text;
	try {
		data = text ? JSON.parse(text) : undefined;
	} catch {}
	return { status: res.status as number, data };
}
const names = (d: any[]) => d.map((x) => x.name);
const items = async () => new Remult(db).repo(Item).find();

const cases: [string, () => Promise<void>][] = [
	[
		'list in scope, relation findOptions applied',
		async () => {
			const r = await call('GET', '/api/invoices/1/items');
			assert.deepEqual(names(r.data), ['i11', 'i12']);
		}
	],
	[
		'url filters on top of scope',
		async () => {
			assert.deepEqual(names((await call('GET', '/api/invoices/1/items?name=i12')).data), ['i12']);
			assert.deepEqual((await call('GET', '/api/invoices/1/items?name=i21')).data, []);
		}
	],
	[
		'url filter cannot widen the scope',
		async () => {
			assert.deepEqual((await call('GET', '/api/invoices/1/items?invoiceId=2')).data, []);
			assert.deepEqual((await call('GET', '/api/invoices/1/items?archived=true')).data, []);
		}
	],
	[
		'count in scope',
		async () => {
			assert.deepEqual((await call('GET', '/api/invoices/1/items?__action=count')).data, {
				count: 2
			});
		}
	],
	[
		'POST __action=get: body where cannot widen the scope',
		async () => {
			const r = await call('POST', '/api/invoices/1/items?__action=get', {
				where: { invoiceId: 2 }
			});
			assert.deepEqual(r.data, []);
		}
	],
	[
		'get by id only within parent',
		async () => {
			assert.equal((await call('GET', '/api/invoices/1/items/11')).data.name, 'i11');
			assert.equal((await call('GET', '/api/invoices/1/items/21')).status, 404);
			assert.equal((await call('GET', '/api/invoices/1/items/13')).status, 404);
		}
	],
	[
		'parent hidden by apiPrefilter -> 404',
		async () => {
			assert.equal((await call('GET', '/api/invoices/3/items')).status, 404);
			assert.equal((await call('GET', '/api/invoices/3/items/31')).status, 404);
			assert.equal((await call('GET', '/api/invoices/99/items')).status, 404);
		}
	],
	[
		'parent not readable -> 403',
		async () => {
			invoicesReadable = false;
			assert.equal((await call('GET', '/api/invoices/1/items')).status, 403);
		}
	],
	[
		'POST forces fk (single + array)',
		async () => {
			const r = await call('POST', '/api/invoices/1/items', {
				id: 14,
				name: 'i14',
				invoiceId: 2
			});
			assert.equal(r.status, 201);
			assert.equal(r.data.invoiceId, 1);
			const r2 = await call('POST', '/api/invoices/1/items', [
				{ id: 15, name: 'i15', invoiceId: 3 }
			]);
			assert.equal(r2.data[0].invoiceId, 1);
		}
	],
	[
		'POST under hidden parent -> 404, nothing inserted',
		async () => {
			assert.equal((await call('POST', '/api/invoices/3/items', { id: 99 })).status, 404);
			assert.equal(
				(await items()).find((x) => x.id === 99),
				undefined
			);
		}
	],
	[
		'PUT cannot move a child out of its parent',
		async () => {
			const r = await call('PUT', '/api/invoices/1/items/11', {
				name: 'x',
				invoiceId: 2
			});
			assert.equal(r.data.invoiceId, 1);
			assert.equal((await call('PUT', '/api/invoices/1/items/21', { name: 'x' })).status, 404);
		}
	],
	[
		'DELETE only within parent',
		async () => {
			assert.equal((await call('DELETE', '/api/invoices/1/items/21')).status, 404);
			assert.equal((await call('DELETE', '/api/invoices/1/items/11')).status, 204);
		}
	],
	[
		'deleteMany needs a filter, then stays in scope',
		async () => {
			assert.equal((await call('DELETE', '/api/invoices/1/items')).status, 400);
			assert.deepEqual((await call('DELETE', '/api/invoices/1/items?name.ne=zzz')).data, {
				deleted: 2
			});
			assert.equal((await items()).length, 3);
		}
	],
	[
		'deleteMany where "all" stays in scope',
		async () => {
			const r = await call('POST', '/api/invoices/1/items?__action=deleteMany', { where: 'all' });
			assert.deepEqual(r.data, { deleted: 2 });
			assert.equal((await items()).length, 3);
		}
	],
	[
		'updateMany stays in scope and cannot move rows',
		async () => {
			const r = await call('PUT', '/api/invoices/1/items?name.ne=zzz', {
				name: 'u',
				invoiceId: 2
			});
			assert.deepEqual(r.data, { updated: 2 });
			const all = await items();
			assert.equal(all.filter((x) => x.name === 'u' && x.invoiceId === 1).length, 2);
		}
	],
	[
		'updateMany action: body where cannot widen the scope',
		async () => {
			const r = await call('POST', '/api/invoices/1/items?__action=updateMany', {
				where: { invoiceId: 2 },
				set: { name: 'hacked' }
			});
			assert.deepEqual(r.data, { updated: 0 });
		}
	],
	[
		'second level checks every parent',
		async () => {
			assert.equal((await call('GET', '/api/invoices/1/items/11/discounts')).data[0].id, 111);
			assert.equal((await call('GET', '/api/invoices/1/items/21/discounts')).status, 404);
			assert.equal((await call('GET', '/api/invoices/1/items/13/discounts')).status, 404);
			assert.equal((await call('GET', '/api/invoices/2/items/21/discounts/211')).data.percent, 20);
			assert.equal(
				(await call('GET', '/api/invoices/2/items/21/discounts/211', undefined, 'b')).status,
				404
			);
		}
	],
	[
		'self relation stops at first repeat',
		async () => {
			assert.equal((await call('GET', '/api/categories/1/children')).data[0].id, 2);
			assert.equal((await call('GET', '/api/categories/1/children/2/children')).status, 404);
		}
	],
	[
		'relation without nestedApi is not exposed',
		async () => {
			assert.equal((await call('GET', '/api/invoices/1/notExposed')).status, 404);
		}
	],
	[
		'compound id parent',
		async () => {
			const r = await call('GET', '/api/order-lines/A,1/notes');
			assert.deepEqual(
				r.data.map((x: any) => x.text),
				['n1']
			);
		}
	],
	[
		'flat routes untouched',
		async () => {
			assert.equal((await call('GET', '/api/items')).data.length, 5);
			assert.equal((await call('GET', '/api/items/21')).data.name, 'i21');
		}
	],
	[
		'nestedOnly: flat route is 404, nested ones still work',
		async () => {
			assert.equal((await call('GET', '/api/discounts')).status, 404);
			assert.equal((await call('GET', '/api/discounts/111')).status, 404);
			assert.equal((await call('GET', '/api/Discounts/111')).status, 404);
			assert.equal((await call('POST', '/api/discounts', { id: 1, itemId: 31 })).status, 404);
			assert.equal((await call('PUT', '/api/discounts/111', { percent: 0 })).status, 404);
			assert.equal((await call('DELETE', '/api/discounts/111')).status, 404);
			assert.equal((await call('GET', '/api/invoices/1/items/11/discounts/111')).data.percent, 10);
			assert.equal((await call('GET', '/api/items/11/discounts')).data.length, 1);
			const r = await call('POST', '/api/invoices/1/items/11/discounts', { id: 112, percent: 5 });
			assert.equal(r.status, 201);
			assert.equal(r.data.itemId, 11);
		}
	],
	[
		'nestedOnly: no flat paths in the OpenAPI spec',
		async () => {
			const paths = Object.keys(nestedOpenApi(api.openApiDoc({ title: 't' }), { entities }).paths);
			assert.ok(!paths.includes('/api/discounts'));
			assert.ok(!paths.includes('/api/discounts/{id}'));
			assert.ok(paths.includes('/api/invoices/{invoicesId}/items/{itemsId}/discounts/{id}'));
		}
	],
	[
		'live query keeps the scope',
		async () => {
			const r = await call('GET', '/api/invoices/1/items?__action=liveQuery-q1');
			assert.deepEqual(names(r.data), ['i11', 'i12']);
		}
	]
];

let failed = 0;
for (const [name, run] of cases) {
	await reset();
	try {
		await run();
		console.log('ok  ', name);
	} catch (e: any) {
		failed++;
		console.log('FAIL', name, '\n     ', e.message.split('\n').slice(0, 6).join('\n      '));
	}
}

await reset();
const spec = nestedOpenApi(api.openApiDoc({ title: 't' }), { entities });
console.log('\nOpenAPI nested paths:');
for (const p of Object.keys(spec.paths).filter(
	(p) => (p.split('{').length > 1 && !p.endsWith('/{id}')) || p.split('{').length > 2
))
	console.log('  ' + p);
const nested = spec.paths['/api/invoices/{invoicesId}/items'];
console.log(
	'nested POST body:',
	Object.keys(spec.components.schemas.invoices_itemsMutation.properties)
);
console.log(
	'nested GET params:',
	nested.get.parameters.map((p: any) => p.name).filter((n: string) => !n.startsWith('_'))
);
process.exit(failed ? 1 : 0);
