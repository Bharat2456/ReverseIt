import { createApiHandler } from '../shared/server/router';

const handler = createApiHandler({ mode: 'cloud', version: '1.0.0', ratePerMinute: 40 });

export default async function (req: any, res: any) {
  const done = await handler(req, res);
  if (!done) { res.statusCode = 404; res.end('Not found'); }
}
