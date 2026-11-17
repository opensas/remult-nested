import type { RequestHandler } from '@sveltejs/kit';

// Swagger UI (from a CDN) pointing at /api/openapi.json
export const GET: RequestHandler = () =>
	new Response(
		`<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<title>remult-nested API</title>
		<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css" />
	</head>
	<body>
		<div id="swagger"></div>
		<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
		<script>SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger' })</script>
	</body>
</html>`,
		{ headers: { 'content-type': 'text/html' } }
	);
