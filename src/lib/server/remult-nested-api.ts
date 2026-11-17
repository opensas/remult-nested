// Nested REST routes for remult + SvelteKit, e.g. `/api/invoices/1/items[/11]`.
// Opt in on a toMany relation: `@Relations.toMany(() => Item, { field: 'invoiceId', nestedApi: true })`.
// Each nested call is checked, then forwarded to the flat remult route with the relation scope added.
// `@Entity('discounts', { nestedOnly: true })` hides the flat route: only the nested ones are left.
import type { RequestEvent, RequestHandler } from '@sveltejs/kit';
import {
	Filter,
	Remult,
	repo,
	type ClassType,
	type EntityFilter,
	type EntityMetadata,
	type FindOptionsBase,
	type Repository
} from 'remult';
import { getRelationFieldInfo } from 'remult/internals';
import type { RemultSveltekitServer } from 'remult/remult-sveltekit';

declare module 'remult' {
	interface RelationOptions<
		fromEntity,
		toEntity,
		matchIdEntity,
		optionsType extends FindOptionsBase<toEntity> = FindOptionsBase<toEntity>
	> {
		/** toMany only: also expose the related entity under its parent. */
		nestedApi?: boolean;
	}
	interface EntityOptions<entityType> {
		/** Only reachable through nested routes: the flat `/api/<key>[/:id]` answers 404. */
		nestedOnly?: boolean;
	}
}

const REGEX_NON_WORD = /\W/g;
const REGEX_PATH_PARAM = /:(\w+)/g;

type Step = {
	param: string;
	parentKey: string;
	relationKey: string;
	child: EntityMetadata<any>;
};
type NestedRoute = { root: ClassType<unknown>; path: string; steps: Step[] };

// toMany relations flagged `nestedApi`, recursively, stopping when an entity repeats in the chain.
export function nestedApiRoutes(entities: ClassType<unknown>[]) {
	const result: NestedRoute[] = [];
	for (const root of entities) {
		const meta = new Remult().repo(root).metadata as EntityMetadata<any>;
		if (meta.options.nestedOnly) continue;
		const walk = (
			meta: EntityMetadata<any>,
			path: string,
			steps: Step[],
			chain: unknown[],
			segment: string
		) => {
			// Named after the url segment before it; a prop can repeat along a path.
			let param = segment.replace(REGEX_NON_WORD, '_') + 'Id';
			if (steps.some((s) => s.param === param)) param = param.slice(0, -2) + steps.length + 'Id';
			for (const f of meta.fields.toArray()) {
				const rel = getRelationFieldInfo(f);
				if (rel?.type !== 'toMany' || !(f.options as any).nestedApi) continue;
				const child = rel.toRepo.metadata as EntityMetadata<any>;
				const route: NestedRoute = {
					root,
					path: `${path}/:${param}/${f.key}`,
					steps: [...steps, { param, parentKey: meta.key, relationKey: f.key, child }]
				};
				result.push(route);
				if (!chain.includes(child.entityType))
					walk(child, route.path, route.steps, [...chain, child.entityType], f.key);
			}
		};
		walk(meta, meta.key, [], [root], meta.key);
	}
	return result;
}

// Flat paths of the `nestedOnly` entities, e.g. `/api/discounts`.
function hiddenFlatPaths(entities: ClassType<unknown>[], rootPath: string) {
	return entities
		.map((e) => new Remult().repo(e).metadata)
		.filter((m) => m.options.nestedOnly)
		.map((m) => (rootPath + '/' + m.key).toLowerCase());
}

// The relation filter for `parent.<relationKey>`, plus the equalities it forces on writes.
function relationScope(parentRepo: Repository<any>, parent: any, relationKey: string) {
	const field = parentRepo.metadata.fields.find(relationKey);
	const rel = getRelationFieldInfo(field)!;
	const values: Record<string, unknown> = {};
	for (const [childKey, parentKey] of Object.entries(rel.getFields().fields)) {
		const v = parent[parentKey];
		values[childKey] = v && typeof v === 'object' ? repo(v.constructor).getEntityRef(v).getId() : v;
	}
	let findOptions = (field.options as any).findOptions;
	if (typeof findOptions === 'function') findOptions = findOptions(parent);
	const where: EntityFilter<any> | undefined = findOptions?.where;
	if (where)
		for (const [k, v] of Object.entries(where))
			if (!k.startsWith('$') && (v === null || typeof v !== 'object')) values[k] = v;
	return { filter: { $and: [values, where ?? {}] }, values };
}

async function apiPrefilter(meta: EntityMetadata<any>): Promise<EntityFilter<any>[]> {
	const f = meta.options.apiPrefilter;
	if (!f) return [];
	return [typeof f === 'function' ? await f() : f];
}

class HttpError {
	constructor(
		public status: number,
		public message: string
	) { }
}

// One row by id, under the api rules of its entity and inside `scope`.
async function findForApi(r: Repository<any>, id: string, scope: EntityFilter<any>) {
	const rows = await r.find({
		where: {
			$and: [r.metadata.idMetadata.getIdFilter(id), scope, ...(await apiPrefilter(r.metadata))]
		},
		limit: 2
	});
	if (rows.length !== 1) throw new HttpError(404, 'NotFound');
	return rows[0];
}

function addToJsonFilter(target: Record<string, any>, scope: Record<string, any>) {
	for (const [k, v] of Object.entries(scope))
		target[k] = target[k] === undefined ? v : [target[k], v].flat();
}

export function nestedApi(
	api: RemultSveltekitServer,
	{ entities, rootPath = '/api' }: { entities: ClassType<unknown>[]; rootPath?: string }
) {
	const routes = nestedApiRoutes(entities).map((r) => ({
		...r,
		segments: (rootPath + '/' + r.path).split('/').map((s) => s.toLowerCase())
	}));
	const hidden = hiddenFlatPaths(entities, rootPath);
	const rootLength = rootPath.split('/').length;

	const handler: RequestHandler = async (event) => {
		const segments = event.url.pathname.split('/');
		const method = event.request.method as 'GET' | 'POST' | 'PUT' | 'DELETE';
		const match = (withId: boolean) =>
			routes.find(
				(r) =>
					r.segments.length + (withId ? 1 : 0) === segments.length &&
					r.segments.every((s, i) =>
						s.startsWith(':') ? segments[i] !== '' : s === segments[i].toLowerCase()
					)
			);
		const withId = match(true);
		const route = withId ?? match(false);
		if (!route) {
			const flat = segments
				.slice(0, rootLength + 1)
				.join('/')
				.toLowerCase();
			if (hidden.includes(flat)) return Response.json({ message: 'NotFound' }, { status: 404 });
			return api[method](event);
		}

		try {
			const params: Record<string, string> = {};
			route.segments.forEach((s, i) => {
				if (s.startsWith(':')) params[s.slice(1)] = decodeURIComponent(segments[i]);
			});
			const childId = withId ? decodeURIComponent(segments[segments.length - 1]) : undefined;

			const scope = await api.withRemult(event, async () => {
				let r: Repository<any> = repo(route.root);
				let scope: ReturnType<typeof relationScope> | undefined;
				for (const step of route.steps) {
					if (!r.metadata.apiReadAllowed) throw new HttpError(403, 'Forbidden');
					const parent = await findForApi(r, params[step.param.toLowerCase()], scope?.filter ?? {});
					scope = relationScope(r, parent, step.relationKey);
					r = repo(step.child.entityType);
				}
				if (childId !== undefined) await findForApi(r, childId, scope!.filter);
				return scope!;
			});

			const child = route.steps[route.steps.length - 1].child;
			const json = Filter.entityFilterToJson(child, scope.filter);
			const url = new URL(event.url);
			url.pathname =
				rootPath +
				'/' +
				child.key +
				(childId !== undefined ? '/' + encodeURIComponent(childId) : '');
			const action = url.searchParams.get('__action');
			if (childId === undefined) {
				// Like the flat route: no implicit "delete / update everything".
				const hasFilter = [...url.searchParams.keys()].some((k) => !k.startsWith('_'));
				if ((method === 'DELETE' || (method === 'PUT' && !action)) && !hasFilter)
					throw new HttpError(
						400,
						`${method === 'DELETE' ? 'deleteMany' : 'updateMany'} requires a filter`
					);
				if (action === 'emptyId') throw new HttpError(400, 'Not supported on nested routes');
				for (const [k, v] of Object.entries(json))
					for (const x of [v].flat())
						url.searchParams.append(k, typeof x === 'string' ? x : JSON.stringify(x));
			}

			let body: unknown;
			if (method === 'POST' || method === 'PUT') {
				body = await event.request.json();
				const force = (row: any) =>
					row && typeof row === 'object' && Object.assign(row, scope.values);
				const inWhere = (b: any) => {
					if (
						(action === 'deleteMany' || action === 'updateMany') &&
						b.where !== 'all' &&
						!Object.keys(b.where ?? {}).length
					)
						throw new HttpError(400, `${action} requires a filter`);
					// `all` would drop the url filter, so the scope becomes the where.
					if (b.where === 'all' || b.where === undefined) b.where = {};
					addToJsonFilter(b.where, json);
				};
				if (method === 'PUT') force(body);
				else if (!action) [body].flat().forEach(force);
				else if (action === 'upsertMany')
					for (const item of body as any[]) {
						inWhere(item);
						force(item.where);
						force(item.set);
					}
				else if (action === 'updateMany') {
					inWhere(body);
					force((body as any).set);
				} else if (action !== 'endLiveQuery') inWhere(body);
			}

			const request = new Request(url, {
				method,
				headers: event.request.headers,
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			return api[method]({ ...event, request, url } as RequestEvent);
		} catch (e) {
			if (e instanceof HttpError)
				return Response.json({ message: e.message }, { status: e.status });
			throw e;
		}
	};
	return { GET: handler, POST: handler, PUT: handler, DELETE: handler };
}

// Adds the nested paths to `api.openApiDoc()`, without the fields the url sets.
export function nestedOpenApi(
	spec: any,
	{ entities, rootPath = '/api' }: { entities: ClassType<unknown>[]; rootPath?: string }
) {
	for (const route of nestedApiRoutes(entities)) {
		const last = route.steps[route.steps.length - 1];
		const child = last.child;
		const flat = rootPath + '/' + child.key;
		if (!spec.paths[flat]) continue;
		const parentRepo = new Remult().repo(
			route.steps.length > 1 ? route.steps[route.steps.length - 2].child.entityType : route.root
		);
		const field = parentRepo.metadata.fields.find(last.relationKey);
		const scoped = Object.keys(getRelationFieldInfo(field)!.getFields().fields);
		const where = (field.options as any).findOptions?.where;
		if (where && typeof (field.options as any).findOptions !== 'function')
			scoped.push(...Object.keys(where).filter((k) => !k.startsWith('$')));

		const pathParams = route.steps.map((s) => ({
			name: s.param,
			in: 'path',
			required: true,
			description: 'id of ' + s.parentKey,
			schema: { type: 'string' }
		}));
		const mutationKey = `${last.parentKey}_${last.relationKey}Mutation`;
		const flatSchema =
			spec.components.schemas[child.key + 'Mutation'] ?? spec.components.schemas[child.key];
		const properties = { ...flatSchema.properties };
		for (const k of scoped) delete properties[k];
		spec.components.schemas[mutationKey] = { type: 'object', properties };

		const path = rootPath + '/' + route.path.replace(REGEX_PATH_PARAM, '{$1}');
		for (const [suffix, source] of [
			['', spec.paths[flat]],
			['/{id}', spec.paths[flat + '/{id}']]
		]) {
			const copy = structuredClone(source);
			for (const op of Object.values<any>(copy)) {
				op.parameters = [
					...pathParams,
					...(op.parameters ?? []).filter(
						(p: any) => !(p.in === 'query' && scoped.includes(p.name))
					)
				];
				const schema = op.requestBody?.content?.['application/json']?.schema;
				if (schema?.$ref) schema.$ref = '#/components/schemas/' + mutationKey;
			}
			spec.paths[path + suffix] = copy;
		}
	}
	for (const flat of hiddenFlatPaths(entities, rootPath))
		for (const path of Object.keys(spec.paths))
			if (path.toLowerCase() === flat || path.toLowerCase() === flat + '/{id}')
				delete spec.paths[path];
	return spec;
}
