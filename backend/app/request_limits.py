"""ASGI-level request limit, including chunked bodies with no Content-Length."""
import json


class BodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        limit = 5 * 1024 * 1024 if scope.get('path') == '/api/photos' else 1024 * 1024
        # Buffer a bounded body before application validation to catch chunked uploads.
        body = bytearray()
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            body.extend(message.get('body', b''))
            if len(body) > limit:
                payload = json.dumps({'detail': 'Request body is too large'}).encode()
                await send({'type':'http.response.start','status':413,'headers':[(b'content-type',b'application/json'),(b'cache-control',b'no-store')]})
                await send({'type':'http.response.body','body':payload})
                return
            if not message.get('more_body', False):
                break
        sent = False
        async def bounded_receive():
            nonlocal sent
            if not sent:
                sent = True
                return {'type':'http.request','body':bytes(body),'more_body':False}
            return await receive()
        await self.app(scope, bounded_receive, send)
