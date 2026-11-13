import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';
import { Readable, pipeline } from 'node:stream';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';

// Native HTTP CONNECT tunnel. The proxy receives no provider Authorization header;
// HTTPS provider headers and content are sent only after certificate-verified TLS.
export function fetchViaProxy(url, options, proxyUrl) {
  return new Promise((resolve, reject) => {
    const target = new URL(url), proxy = new URL(proxyUrl);
    const hostname = target.hostname.replace(/^\[|\]$/g, '');
    const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
    const authority = `${target.hostname}:${port}`;
    let tunnel, upstreamSocket, outgoing, response, agent, connectRequest;
    let settled = false, stopping = false;
    const detach = () => options.signal?.removeEventListener('abort', abort);
    const stop = error => {
      if (stopping) return;
      stopping = true;
      detach();
      response?.destroy(error);
      outgoing?.destroy(error);
      upstreamSocket?.destroy(error);
      tunnel?.destroy(error);
      connectRequest?.destroy(error);
      agent?.destroy();
      if (!settled) { settled = true; reject(error); }
    };
    const abort = () => stop(new Error('Proxy request aborted'));
    if (options.signal?.aborted) return abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    connectRequest = http.request({
      hostname: proxy.hostname.replace(/^\[|\]$/g, ''), port: Number(proxy.port || 80),
      method: 'CONNECT', path: authority, headers: { Host: authority }, agent: false
    });
    connectRequest.on('error', stop);
    connectRequest.on('connect', (connected, socket, head) => {
      tunnel = socket;
      tunnel.on('error', stop);
      if (connected.statusCode !== 200) return stop(new Error('Proxy CONNECT rejected'));
      if (head.length) socket.unshift(head);
      const secure = target.protocol === 'https:';
      upstreamSocket = secure ? tls.connect({ socket, host: hostname,
        servername: net.isIP(hostname) ? undefined : hostname, rejectUnauthorized: true
      }) : socket;
      upstreamSocket.on('error', stop);
      agent = secure ? new https.Agent({ keepAlive: false }) : new http.Agent({ keepAlive: false });
      agent.createConnection = () => upstreamSocket;
      outgoing = (secure ? https : http).request({
        hostname, port, path: target.pathname + target.search, method: options.method || 'GET',
        headers: { ...options.headers, 'accept-encoding': 'identity' }, agent
      }, incoming => {
        response = incoming;
        if (options.redirect === 'error' && incoming.statusCode >= 300 && incoming.statusCode < 400) {
          return stop(new Error('Redirects are disabled'));
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
          else if (value !== undefined) headers.set(name, value);
        }
        let stream = incoming;
        const encoding = headers.get('content-encoding');
        const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ? createInflate()
          : encoding === 'br' ? createBrotliDecompress() : null;
        if (decoder) {
          pipeline(incoming, decoder, () => {});
          stream = decoder;
          headers.delete('content-encoding');
          headers.delete('content-length');
        }
        stream.on('end', detach);
        stream.on('close', () => { detach(); agent.destroy(); });
        settled = true;
        const body = [204, 205, 304].includes(incoming.statusCode) ? null : Readable.toWeb(stream);
        resolve(new Response(body, { status: incoming.statusCode, headers }));
      });
      outgoing.on('error', stop);
      outgoing.end(options.body);
    });
    connectRequest.end();
  });
}
