import type { RequestHandler } from '@sveltejs/kit';
import { api, entities } from '#lib/server/api.ts';
import { nestedOpenApi } from '#lib/server/remult-nested-api.ts';

// remult's OpenAPI spec, plus the nested routes
export const GET: RequestHandler = () =>
	Response.json(nestedOpenApi(api.openApiDoc({ title: 'remult-nested' }), { entities }));
