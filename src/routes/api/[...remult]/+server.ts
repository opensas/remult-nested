import { api, entities } from '#lib/server/api.ts';
import { nestedApi } from '#lib/server/remult-nested-api.ts';

// Nested routes are checked and forwarded to `api`; everything else goes straight to `api`
export const { GET, POST, PUT, DELETE } = nestedApi(api, { entities });
