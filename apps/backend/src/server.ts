import { createServer } from 'node:http';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3333);

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(port, host, () => {
  console.log(`pollo backend listening on http://localhost:${port}`);
});
